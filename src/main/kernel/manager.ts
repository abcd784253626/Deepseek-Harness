/**
 * DSH 内核子进程管理器
 *
 * 以 `dsh --profile web --host 127.0.0.1 --port <port>` 方式后台运行官方内核，
 * 完整保留官方 Cordis 插件体系、模型接入、工具调用、沙箱执行能力。
 *
 * 职责：
 *  - 进程生命周期：启动 / 优雅停止 / 异常崩溃自动恢复（指数退避）
 *  - 工作区绑定：每个工作区独立 cwd 与可选独立 DSH_HOME
 *  - 就绪探测：HTTP 轮询官方 Web UI 端口
 *  - 日志环形缓冲：stdout/stderr 解析为结构化日志供渲染进程展示
 */
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { get } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { KernelLogLevel, KernelLogLine, KernelState, KernelStatus, WorkspaceInfo } from '@shared/types'
import { getSettings, getWorkspace } from '../store/database'
import { resolveDsh, resolveSystemNode } from './resolver'

const MAX_LOG_LINES = 2000
const READY_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 350
const RESTART_BACKOFF = [1000, 2000, 5000, 10_000, 20_000]

const ANSI_RE = /\u001b\[[0-9;]*m/g

export class KernelManager extends EventEmitter {
  private child: ChildProcess | null = null
  private status: KernelStatus = 'stopped'
  private port: number | null = null
  private workspaceId: string | null = null
  private startedAt: number | null = null
  private lastError: string | null = null
  private logs: KernelLogLine[] = []
  private stopping = false
  private restartAttempt = 0
  private restartTimer: NodeJS.Timeout | null = null
  private readyTimer: NodeJS.Timeout | null = null
  private probeTimer: NodeJS.Timeout | null = null
  private stopTimer: NodeJS.Timeout | null = null

  getState(): KernelState {
    return {
      status: this.status,
      url: this.port ? `http://127.0.0.1:${this.port}` : null,
      pid: this.child?.pid ?? null,
      port: this.port,
      workspaceId: this.workspaceId,
      startedAt: this.startedAt,
      lastError: this.lastError
    }
  }

  getLogs(): KernelLogLine[] {
    return [...this.logs]
  }

  private log(level: KernelLogLevel, text: string): void {
    const line: KernelLogLine = { time: Date.now(), level, text }
    this.logs.push(line)
    if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES)
    this.emit('log', line)
  }

  private setStatus(status: KernelStatus): void {
    this.status = status
    this.emit('state', this.getState())
  }

  /** 解析 stdout/stderr 行：剥离 ANSI、启发式分级；识别官方"dsh web:"就绪行 */
  private feedLine(raw: string): void {
    const text = raw.replace(ANSI_RE, '').trimEnd()
    if (!text) return
    // 官方就绪信号：dsh web: http://127.0.0.1:<port>
    const urlMatch = text.match(/dsh web:\s*https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/)
    if (urlMatch) {
      const parsedPort = Number(urlMatch[1])
      if (parsedPort > 0) {
        this.port = parsedPort
        this.log('info', `官方内核报告 Web UI 端口: ${parsedPort}`)
      }
    }
    const lower = text.toLowerCase()
    let level: KernelLogLevel = 'info'
    if (/error|fatal|exception|✗|failed:/i.test(lower)) level = 'error'
    else if (/warn|warning|⚠/i.test(lower)) level = 'warn'
    else if (/debug|trace/i.test(lower)) level = 'debug'
    this.log(level, text)
  }

  private pickFreePort(preferred: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer()
      server.once('error', (err) => {
        if (preferred) {
          // 端口被占用 → 放弃偏好，交给 OS 分配
          const s2 = createServer()
          s2.once('error', reject)
          s2.listen(0, '127.0.0.1', () => {
            const p = (s2.address() as { port: number }).port
            s2.close(() => resolve(p))
          })
        } else {
          reject(err)
        }
      })
      server.listen(preferred || 0, '127.0.0.1', () => {
        const p = (server.address() as { port: number }).port
        server.close(() => resolve(p))
      })
    })
  }

  private probeReady(port: number): Promise<void> {
    return new Promise((resolve) => {
      const deadline = Date.now() + READY_TIMEOUT_MS
      const tick = (): void => {
        if (this.stopping) return resolve()
        const req = get(
          { host: '127.0.0.1', port, path: '/', timeout: 1200 },
          (res) => {
            res.resume()
            // 任意 HTTP 响应即视为就绪（404 说明路由已挂载）
            resolve()
          }
        )
        req.on('timeout', () => req.destroy())
        req.on('error', () => {
          if (Date.now() > deadline) {
            this.lastError = `内核启动超时（${READY_TIMEOUT_MS / 1000}s 内未响应）`
            resolve()
            return
          }
          this.probeTimer = setTimeout(tick, POLL_INTERVAL_MS)
        })
      }
      tick()
    })
  }

  /** 切换运行模式：写官方 settings.yaml 的 agent-presets.default 后重启内核 */
  applyModeToSettings(mode: string, dshHome: string): { ok: boolean; message: string } {
    try {
      const settingsPath = join(dshHome, 'settings.yaml')
      const { existsSync, readFileSync, writeFileSync } = require('node:fs') as typeof import('node:fs')
      let yaml: Record<string, unknown> = {}
      if (existsSync(settingsPath)) {
        const yamlLib = require('js-yaml') as typeof import('js-yaml')
        const parsed = yamlLib.load(readFileSync(settingsPath, 'utf-8'))
        if (parsed && typeof parsed === 'object') yaml = parsed as Record<string, unknown>
      }
      const presets = (yaml['agent-presets'] as Record<string, unknown>) ?? {}
      presets['default'] = mode
      yaml['agent-presets'] = presets
      const yamlLib = require('js-yaml') as typeof import('js-yaml')
      writeFileSync(settingsPath, yamlLib.dump(yaml, { noRefs: true }), 'utf-8')
      return { ok: true, message: `运行模式已写入 ${settingsPath}` }
    } catch (err) {
      return { ok: false, message: `写入 settings.yaml 失败: ${(err as Error).message}` }
    }
  }

  async start(workspaceId: string | null): Promise<KernelState> {
    if (this.child) {
      this.log('warn', '内核已在运行，忽略重复启动请求')
      return this.getState()
    }
    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
    const settings = getSettings()
    const binary = resolveDsh(settings.dshPathOverride)
    if (!binary) {
      this.lastError = '未找到 dsh CLI。请安装 @deepseek-ai/dsh（npm install -g @deepseek-ai/dsh）或在设置中指定路径。'
      this.setStatus('error')
      return this.getState()
    }
    const nodePath = resolveSystemNode()
    if (!nodePath) {
      this.lastError = '未找到系统 Node.js 运行时。DSH 内核需要 Node.js 18+。'
      this.setStatus('error')
      return this.getState()
    }

    const workspace: WorkspaceInfo | null = workspaceId ? getWorkspace(workspaceId) : null
    this.workspaceId = workspace?.id ?? null
    const cwd = workspace?.path ?? process.cwd()
    const dshHome =
      workspace?.dshHome || settings.dshHomeOverride || join(homedir(), '.dsh')

    // 先应用当前模式（settings.yaml 由官方读取）
    this.applyModeToSettings(settings.lastMode, dshHome)

    let port: number
    try {
      port = await this.pickFreePort(settings.kernelPort)
    } catch (err) {
      this.lastError = `无法分配端口: ${(err as Error).message}`
      this.setStatus('error')
      return this.getState()
    }
    this.port = port
    this.lastError = null
    this.stopping = false
    this.setStatus('starting')

    this.log('info', `启动 DSH 内核 v${binary.version ?? '?'} (${binary.path})`)
    this.log('info', `工作区: ${cwd}`)
    this.log('info', `DSH_HOME: ${dshHome}`)

    // 系统 Node + bin.js：与官方 CLI 运行方式完全一致
    const child = spawn(
      binary.viaPath ? binary.path : nodePath,
      binary.viaPath ? ['--profile', 'web', '--host', '127.0.0.1', '--port', String(port)] : [binary.path, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port)],
      {
        cwd,
        env: {
          ...process.env,
          DSH_HOME: dshHome,
          FORCE_COLOR: '0',
          NO_COLOR: '1'
        },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(binary.viaPath ? { shell: true } : {})
      }
    )
    this.child = child

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split(/\r?\n/)) this.feedLine(line)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split(/\r?\n/)) this.feedLine(line)
    })

    child.on('error', (err) => {
      this.lastError = `内核进程错误: ${err.message}`
      this.log('error', this.lastError)
      this.setStatus('error')
    })

    child.on('exit', (code, signal) => {
      // 只处理当前代进程的退出（防止旧代进程的迟到的 exit 误伤新内核）
      if (this.child !== child) return
      this.log('warn', `内核进程退出 (code=${code}, signal=${signal ?? 'none'})`)
      this.child = null
      this.startedAt = null
      if (this.stopping) {
        this.setStatus('stopped')
        return
      }
      // 异常退出 → 自动恢复
      this.scheduleRestart(cwd, workspaceId)
    })

    this.startedAt = Date.now()
    await this.probeReady(port)
    if (this.child && !this.stopping) {
      this.restartAttempt = 0
      this.setStatus('running')
      this.log('info', `内核就绪: http://127.0.0.1:${port}`)
    }
    return this.getState()
  }

  private scheduleRestart(cwd: string, workspaceId: string | null): void {
    const delay = RESTART_BACKOFF[Math.min(this.restartAttempt, RESTART_BACKOFF.length - 1)]
    this.restartAttempt += 1
    this.setStatus('restarting')
    this.log('warn', `${delay / 1000}s 后自动重启内核（第 ${this.restartAttempt} 次）`)
    this.restartTimer = setTimeout(() => {
      void this.start(workspaceId)
    }, delay)
  }

  /** 优雅停止；force 时直接终止进程树 */
  stop(force = false): Promise<void> {
    return new Promise((resolve) => {
      if (this.restartTimer) {
        clearTimeout(this.restartTimer)
        this.restartTimer = null
      }
      if (this.probeTimer) clearTimeout(this.probeTimer)
      if (this.stopTimer) clearTimeout(this.stopTimer)
      this.stopping = true
      const child = this.child
      if (!child) {
        this.setStatus('stopped')
        resolve()
        return
      }
      let settled = false
      const onExit = (): void => {
        if (settled) return
        settled = true
        if (this.stopTimer) clearTimeout(this.stopTimer)
        // 只允许停止当前代进程（防止旧 stop 回调误伤重启后的新内核）
        if (this.child !== child) {
          resolve()
          return
        }
        this.child = null
        this.startedAt = null
        this.setStatus('stopped')
        resolve()
      }
      child.once('exit', onExit)
      try {
        child.kill()
      } catch {
        onExit()
      }
      // Windows 上 child.kill 只杀根进程，子进程树用 taskkill 兜底
      if (force || process.platform === 'win32') {
        const { spawn } = require('node:child_process') as typeof import('node:child_process')
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
        killer.on('error', () => onExit())
      }
      // 兜底超时（仅当该进程仍是当前代时才生效）
      this.stopTimer = setTimeout(() => {
        if (this.child === child) onExit()
      }, 5000)
    })
  }

  async restart(workspaceId: string | null): Promise<KernelState> {
    await this.stop()
    this.stopping = false
    return this.start(workspaceId)
  }

  dispose(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer)
    if (this.probeTimer) clearTimeout(this.probeTimer)
    if (this.stopTimer) clearTimeout(this.stopTimer)
    this.stopping = true
    if (this.child) {
      try {
        this.child.kill()
      } catch {
        /* 已退出 */
      }
    }
    this.removeAllListeners()
  }
}

/** 单例 */
export const kernelManager = new KernelManager()
