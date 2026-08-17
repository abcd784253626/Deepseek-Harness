/**
 * 终端面板 — 非交互式命令执行器
 * 渲染进程通过 IPC 发起 `dsh <args>` / 任意命令，流式回传 stdout/stderr。
 * （完整 PTY 需要 node-pty 原生模块，v1 采用 spawn 流式方案，覆盖 dsh CLI 全部命令面）
 */
import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import type { TerminalSession } from '@shared/types'
import { getSettings } from '../store/database'
import { resolveDsh, resolveSystemNode } from '../kernel/resolver'

export interface TerminalOutput {
  sessionId: string
  time: number
  text: string
}

export class TerminalRunner extends EventEmitter {
  private sessions = new Map<string, ChildProcess>()

  /** 运行命令；cwd 缺省为当前工作区根 */
  run(id: string, label: string, args: string[], cwd: string): TerminalSession {
    this.kill(id)
    const settings = getSettings()
    const binary = resolveDsh(settings.dshPathOverride)
    const isDsh = args.length > 0 && args[0] === 'dsh'
    let child: ChildProcess
    if (isDsh) {
      if (!binary) {
        this.emit('output', { sessionId: id, time: Date.now(), text: '错误: 未找到 dsh CLI' } satisfies TerminalOutput)
        this.emit('exit', { sessionId: id, exitCode: 1 } as never)
        return { id, label, cwd, startedAt: Date.now(), exited: true, exitCode: 1 }
      }
      const nodePath = resolveSystemNode()
      const rest = args.slice(1)
      child = binary.viaPath || !nodePath
        ? spawn(binary.path, rest, { cwd, env: { ...process.env, DSH_HOME: settings.dshHomeOverride }, windowsHide: true, shell: true })
        : spawn(nodePath, [binary.path, ...rest], { cwd, env: { ...process.env, DSH_HOME: settings.dshHomeOverride }, windowsHide: true })
    } else {
      child = spawn(args[0], args.slice(1), { cwd, env: process.env, windowsHide: true, shell: true })
    }
    this.sessions.set(id, child)

    const emit = (text: string): void => {
      this.emit('output', { sessionId: id, time: Date.now(), text } satisfies TerminalOutput)
    }
    child.stdout?.on('data', (c: Buffer) => emit(c.toString()))
    child.stderr?.on('data', (c: Buffer) => emit(c.toString()))
    child.on('error', (err) => emit(`\n[进程错误] ${err.message}\n`))
    child.on('close', (code) => {
      this.sessions.delete(id)
      this.emit('exit', { sessionId: id, exitCode: code })
    })
    return { id, label, cwd, startedAt: Date.now(), exited: false, exitCode: null }
  }

  kill(id: string): boolean {
    const child = this.sessions.get(id)
    if (!child) return false
    try {
      child.kill()
    } catch {
      /* 已退出 */
    }
    this.sessions.delete(id)
    return true
  }

  dispose(): void {
    for (const child of this.sessions.values()) {
      try {
        child.kill()
      } catch {
        /* 忽略 */
      }
    }
    this.sessions.clear()
    this.removeAllListeners()
  }
}

export const terminalRunner = new TerminalRunner()
