/**
 * 终端面板：直接调用 dsh CLI 命令，与 GUI 状态实时同步
 * 内置常用命令快捷入口；输出流式回传。
 */
import { useEffect, useRef, useState } from 'react'
import { Play, Square, Trash2, TerminalSquare } from 'lucide-react'
import { useApp } from '../stores/app'
import { Button } from '../components/ui'

interface OutputLine {
  id: number
  text: string
  kind: 'out' | 'cmd' | 'sys'
}

const PRESETS: Array<{ label: string; args: string[] }> = [
  { label: 'dsh --version', args: ['dsh', '--version'] },
  { label: '查看组合配置', args: ['dsh', '--profile', 'web', '--dump-config'] },
  { label: '查看默认配置', args: ['dsh', '--profile', 'web', '--dump-default-config'] },
  { label: '帮助', args: ['dsh', '--help'] }
]

let lineSeq = 0

export function TerminalPage(): React.JSX.Element {
  const activeWorkspaceId = useApp((s) => s.activeWorkspaceId)
  const workspaces = useApp((s) => s.workspaces)
  const [lines, setLines] = useState<OutputLine[]>([])
  const [cmd, setCmd] = useState('')
  const [running, setRunning] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const cwd = workspaces.find((w) => w.id === activeWorkspaceId)?.path ?? process.cwd?.() ?? ''

  useEffect(() => {
    const offOut = window.dsh.terminal.onOutput((o) => {
      if (o.sessionId !== sessionId) return
      setLines((prev) => [
        ...prev,
        ...o.text.split(/\r?\n/).filter((t) => t !== '').map((text) => ({ id: ++lineSeq, text, kind: 'out' as const }))
      ])
    })
    const offExit = window.dsh.terminal.onExit((o) => {
      if (o.sessionId !== sessionId) return
      setRunning(false)
      setSessionId(null)
      setLines((prev) => [...prev, { id: ++lineSeq, text: `\n[进程结束 exit=${o.exitCode}]`, kind: 'sys' }])
    })
    return () => {
      offOut()
      offExit()
    }
  }, [sessionId])

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight })
  }, [lines])

  const run = (args: string[]): void => {
    if (running) return
    setLines((prev) => [...prev, { id: ++lineSeq, text: `> ${args.join(' ')}`, kind: 'cmd' }])
    const session = window.dsh.terminal.run(args, cwd)
    session.then((s) => {
      setSessionId(s.id)
      setRunning(true)
    })
  }

  const submit = (): void => {
    const trimmed = cmd.trim()
    if (!trimmed) return
    setCmd('')
    run(trimmed.split(/\s+/))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: 'var(--border)' }}>
        <TerminalSquare size={13} className="fg-3" />
        <span className="text-[12px] fg-2">DSH CLI</span>
        <span className="text-[11px] fg-3">cwd: {cwd || '未选择工作区'}</span>
        <div className="flex-1" />
        <Button small onClick={() => setLines([])} title="清空输出">
          <Trash2 size={12} />
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap gap-1.5 px-3 py-2">
        {PRESETS.map((p) => (
          <Button key={p.label} small disabled={running} onClick={() => run(p.args)}>
            {p.label}
          </Button>
        ))}
      </div>

      <div
        ref={outputRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-2 font-mono text-[12px] leading-relaxed"
        style={{ background: 'var(--bg-subtle)', color: 'var(--fg)' }}
      >
        {lines.length === 0 && <div className="fg-3">输出将显示在这里。也可直接输入命令：dsh --profile web --help</div>}
        {lines.map((l) => (
          <div
            key={l.id}
            className="whitespace-pre-wrap"
            style={
              l.kind === 'cmd'
                ? { color: 'var(--accent)' }
                : l.kind === 'sys'
                  ? { color: 'var(--fg-3)' }
                  : undefined
            }
          >
            {l.text}
          </div>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
        <input
          ref={inputRef}
          className="input-pill font-mono"
          placeholder="输入命令，如：dsh --profile web --help"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'ArrowUp') inputRef.current?.blur()
          }}
        />
        {running ? (
          <Button small variant="danger" onClick={() => sessionId && void window.dsh.terminal.kill(sessionId)}>
            <Square size={12} /> 停止
          </Button>
        ) : (
          <Button small variant="primary" disabled={!cmd.trim()} onClick={submit}>
            <Play size={12} /> 运行
          </Button>
        )}
      </div>
    </div>
  )
}
