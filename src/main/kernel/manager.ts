/**
 * DSH 内核子进程管理器
 *
 * 以 `dsh --profile web --host 127.0.0.1 --port <port>` 方式后台运行官方内核。
 *
 * 生命周期安全设计：
 *  - 串行化：start/stop/restart 共用 in-flight promise，并发调用复用/排队
 *  - 代际校验：每次 start 分配 generation，跨 await 后校验代际与 stopping，
 *    杜绝旧 start 覆盖新状态、孤儿进程、stop 意图丢失
 *  - 就绪判定：HTTP 轮询绑定端口；超时置 error（不误报 running）
 *  - 端口交叉校验：仅采纳与绑定端口一致的内核自报端口
 */
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { get } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import type { KernelLogLevel, KernelLogLine, KernelState, KernelStatus, WorkspaceInfo } from '@shared/types'
import { getSettings, getWorkspace } from '../store/database'
import { readCredential, listCredentials } from '../security'
import { getThemeSafe } from '../themes/manager'
import { writeUiThemePreference } from '../theme-sync'
import { resolveDsh, resolveSystemNode } from './resolver'

const MAX_LOG_LINES = 2000
const READY_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 350
const RESTART_BACKOFF = [1000, 2000, 5000, 10_000, 20_000]

const ANSI_RE = /\u001b\[[0-9;]*m/g

/** settings.yaml 原子写：临时文件 + rename */
function atomicWriteYaml(path: string, doc: Record<string, unknown>): void {
  const tmp = `${path}.tmp-${Date.now()}`
  const yaml = require('js-yaml') as typeof import('js-yaml')
  writeFileSync(tmp, yaml.dump(doc, { noRefs: true }), 'utf-8')
  renameSync(tmp, path)
}

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
  private probeTimer: NodeJS.Timeout | null = null
  private stopTimer: NodeJS.Timeout | null = null
  /** 生命周期代际：任何 stop/start 操作递增，使跨 await 的旧流程自我失效 */
  private generation = 0
  /** in-flight 生命周期 promise（串行化） */
  private lifecycle: Promise<KernelState> | null = null

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
    // 官方就绪信号：dsh web: http://127.0.0.1:<port> —— 仅采纳与绑定端口一致的自报
    const urlMatch = text.match(/dsh web:\s*https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/)
    if (urlMatch) {
      const parsedPort = Number(urlMatch[1])
      if (parsedPort > 0 && parsedPort === this.port) {
        this.log('info', `官方内核报告 Web UI 端口: ${parsedPort}`)
      } else if (parsedPort > 0) {
        this.log('warn', `内核自报端口 ${parsedPort} 与绑定端口 ${this.port ?? '?'} 不一致，忽略（防本地服务欺骗）`)
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

  /** 探测绑定端口就绪；超时返回 false（不抛错，由调用方置 error） */
  private probeReady(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const deadline = Date.now() + READY_TIMEOUT_MS
      const tick = (): void => {
        if (this.stopping) return resolve(false)
        const req = get(
          { host: '127.0.0.1', port, path: '/', timeout: 1200 },
          (res) => {
            res.resume()
            resolve(true)
          }
        )
        req.on('timeout', () => req.destroy())
        req.on('error', () => {
          if (Date.now() > deadline) {
            resolve(false)
            return
          }
          this.probeTimer = setTimeout(tick, POLL_INTERVAL_MS)
        })
      }
      tick()
    })
  }

  /** 切换运行模式：写官方 settings.yaml 的 agent-presets.default（原子写） */
  applyModeToSettings(mode: string, dshHome: string): { ok: boolean; message: string } {
    try {
      const settingsPath = join(dshHome, 'settings.yaml')
      let yaml: Record<string, unknown> = {}
      if (existsSync(settingsPath)) {
        const yamlLib = require('js-yaml') as typeof import('js-yaml')
        const parsed = yamlLib.load(readFileSync(settingsPath, 'utf-8'))
        if (parsed && typeof parsed === 'object') yaml = parsed as Record<string, unknown>
      }
      const presets = (yaml['agent-presets'] as Record<string, unknown>) ?? {}
      presets['default'] = mode
      yaml['agent-presets'] = presets
      atomicWriteYaml(settingsPath, yaml)
      return { ok: true, message: `运行模式已写入 ${settingsPath}` }
    } catch (err) {
      return { ok: false, message: `写入 settings.yaml 失败: ${(err as Error).message}` }
    }
  }

  /**
   * 串行化入口：start 进行中再次调用返回同一 promise；
   * stop/restart 递增代际使 in-flight start 失效。
   */
  async start(workspaceId: string | null): Promise<KernelState> {
    if (this.lifecycle) return this.lifecycle
    const gen = ++this.generation
    this.lifecycle = this.doStart(workspaceId, gen).finally(() => {
      if (this.generation === gen) this.lifecycle = null
    })
    return this.lifecycle
  }

  private async doStart(workspaceId: string | null, gen: number): Promise<KernelState> {
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
    const dshHome = workspace?.dshHome || settings.dshHomeOverride || join(homedir(), '.dsh')

    // 先应用当前模式与官方 UI 明暗偏好（settings.yaml 原子写）
    this.applyModeToSettings(settings.lastMode, dshHome)
    const activeTheme = getThemeSafe(settings.themeId)
    if (activeTheme) writeUiThemePreference(activeTheme.type)

    let port: number
    try {
      port = await this.pickFreePort(settings.kernelPort)
    } catch (err) {
      if (gen !== this.generation || this.stopping) return this.getState()
      this.lastError = `无法分配端口: ${(err as Error).message}`
      this.setStatus('error')
      return this.getState()
    }
    if (gen !== this.generation || this.stopping) return this.getState()
    this.port = port
    this.lastError = null
    this.stopping = false
    this.setStatus('starting')

    this.log('info', `启动 DSH 内核 v${binary.version ?? '?'} (${binary.path})`)
    this.log('info', `工作区: ${cwd}`)
    this.log('info', `DSH_HOME: ${dshHome}`)

    // 从本地加密库注入模型凭据（DPAPI 解密 → 仅进入子进程环境变量，不外泄）
    const envExtra: Record<string, string> = {}
    for (const entry of listCredentials()) {
      const value = readCredential(entry.key)
      if (value) envExtra[entry.key] = value
    }
    if (Object.keys(envExtra).length > 0) {
      this.log('info', `注入模型凭据环境变量: ${Object.keys(envExtra).join(', ')}`)
    }

    // 系统 Node + bin.js：始终参数数组 spawn（无 shell）
    let child: ChildProcess
    try {
      child = spawn(
        binary.viaPath ? binary.path : nodePath,
        binary.viaPath
          ? ['--profile', 'web', '--host', '127.0.0.1', '--port', String(port)]
          : [binary.path, '--profile', 'web', '--host', '127.0.0.1', '--port', String(port)],
        {
          cwd,
          env: {
            ...process.env,
            ...envExtra,
            DSH_HOME: dshHome,
            FORCE_COLOR: '0',
            NO_COLOR: '1'
          },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          ...(binary.viaPath ? { shell: true } : {})
        }
      )
    } catch (err) {
      this.lastError = `spawn 失败: ${(err as Error).message}`
      this.log('error', this.lastError)
      this.setStatus('error')
      return this.getState()
    }
    this.child = child

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split(/\r?\n/)) this.feedLine(line)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf-8').split(/\r?\n/)) this.feedLine(line)
    })

    child.on('error', (err) => {
      if (this.child !== child) return
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
    const ready = await this.probeReady(port)
    if (gen !== this.generation || this.stopping) return this.getState()
    if (this.child === child && ready) {
      this.restartAttempt = 0
      this.setStatus('running')
      this.log('info', `内核就绪: http://127.0.0.1:${port}`)
    } else if (this.child === child) {
      // 超时未就绪 → 明确置 error，不误报 running
      this.lastError = `内核启动超时（${READY_TIMEOUT_MS / 1000}s 内未响应）`
      this.log('error', this.lastError)
      this.setStatus('error')
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

  /** 优雅停止；force 时直接终止进程树。递增代际使 in-flight start 失效。 */
  stop(force = false): Promise<void> {
    return new Promise((resolve) => {
      this.generation += 1
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
      if (force || process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
        killer.on('error', () => onExit())
      }
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
    this.generation += 1
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
