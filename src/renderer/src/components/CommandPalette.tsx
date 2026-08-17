/**
 * 全局命令面板（Ctrl+Shift+P）
 * 可执行所有核心功能：切换页面、工作区、运行模式、内核控制、主题切换。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, CornerDownLeft } from 'lucide-react'
import { useApp, type Page } from '../stores/app'
import type { AgentMode } from '@shared/types'

interface CommandItem {
  id: string
  label: string
  hint?: string
  keywords: string
  run: () => void | Promise<void>
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useApp((s) => s.commandPaletteOpen)
  const setOpen = useApp((s) => s.setCommandPalette)
  const setPage = useApp((s) => s.setPage)
  const toggleImmersive = useApp((s) => s.toggleImmersive)
  const workspaces = useApp((s) => s.workspaces)
  const setActiveWorkspace = useApp((s) => s.setActiveWorkspace)
  const modes = useApp((s) => s.modes)
  const settings = useApp((s) => s.settings)
  const saveSettings = useApp((s) => s.saveSettings)
  const themes = useApp((s) => s.themes)
  const applyThemeById = useApp((s) => s.applyThemeById)
  const refreshKernel = useApp((s) => s.refreshKernel)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 全局快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toUpperCase() === 'P') {
        e.preventDefault()
        setOpen(!useApp.getState().commandPaletteOpen)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpen])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  const commands = useMemo<CommandItem[]>(() => {
    const pages: Array<[Page, string]> = [
      ['chat', '打开会话'],
      ['plugins', '打开插件市场'],
      ['themes', '打开主题设置'],
      ['terminal', '打开终端'],
      ['workspaces', '打开工作区管理'],
      ['settings', '打开设置']
    ]
    const list: CommandItem[] = pages.map(([page, label]) => ({
      id: `page-${page}`,
      label,
      keywords: label,
      run: () => setPage(page)
    }))
    for (const ws of workspaces) {
      list.push({
        id: `ws-${ws.id}`,
        label: `切换到工作区：${ws.name}`,
        hint: ws.path,
        keywords: `工作区 ${ws.name} ${ws.path}`,
        run: () => void setActiveWorkspace(ws.id)
      })
    }
    for (const mode of modes) {
      list.push({
        id: `mode-${mode.id}`,
        label: `运行模式：${mode.name}`,
        hint: mode.description.slice(0, 40),
        keywords: `模式 ${mode.name}`,
        run: async () => {
          await saveSettings({ lastMode: mode.id as AgentMode })
          await refreshKernel()
        }
      })
    }
    for (const theme of themes) {
      list.push({
        id: `theme-${theme.id}`,
        label: `应用主题：${theme.name}`,
        hint: theme.type === 'dark' ? '深色' : '浅色',
        keywords: `主题 ${theme.name}`,
        run: () => void applyThemeById(theme.id)
      })
    }
    list.push(
      { id: 'immerse', label: '无干扰模式', keywords: '沉浸 全屏 无干扰', run: toggleImmersive },
      {
        id: 'kernel-restart',
        label: '重启内核',
        keywords: '内核 重启 dsh',
        run: async () => {
          const id = useApp.getState().activeWorkspaceId
          await window.dsh.kernel.restart(id)
        }
      },
      { id: 'kernel-stop', label: '停止内核', keywords: '内核 停止', run: () => void window.dsh.kernel.stop() },
      {
        id: 'about',
        label: '关于 DSH Desktop',
        keywords: '关于 版本',
        run: () => setPage('settings')
      }
    )
    return list
  }, [workspaces, modes, themes, setPage, setActiveWorkspace, saveSettings, refreshKernel, applyThemeById, toggleImmersive])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => c.keywords.toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => {
    setSelected(0)
  }, [query])

  if (!open) return null

  const run = (cmd: CommandItem): void => {
    setOpen(false)
    void cmd.run()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh]"
      style={{ background: 'color-mix(in srgb, var(--bg) 50%, transparent)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div
        className="w-[560px] max-w-[90vw] overflow-hidden rounded-2xl"
        style={{ background: 'var(--bg-elevated)', boxShadow: '0 16px 64px color-mix(in srgb, var(--fg) 18%, transparent)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2 border-b px-4" style={{ borderColor: 'var(--border)' }}>
          <Search size={14} className="fg-3" />
          <input
            ref={inputRef}
            className="w-full border-none bg-transparent py-3 text-[14px] outline-none"
            style={{ color: 'var(--fg)' }}
            placeholder="输入命令…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelected((s) => Math.min(s + 1, filtered.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelected((s) => Math.max(s - 1, 0))
              } else if (e.key === 'Enter' && filtered[selected]) {
                run(filtered[selected])
              }
            }}
          />
        </div>
        <div className="max-h-[320px] overflow-y-auto p-1.5">
          {filtered.length === 0 && <div className="px-3 py-6 text-center text-[13px] fg-3">没有匹配的命令</div>}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left"
              style={i === selected ? { background: 'var(--bg-subtle)' } : undefined}
              onMouseEnter={() => setSelected(i)}
              onClick={() => run(cmd)}
            >
              <span className="flex-1 truncate text-[13px]" style={{ color: i === selected ? 'var(--fg)' : 'var(--fg-2)' }}>
                {cmd.label}
              </span>
              {cmd.hint && <span className="max-w-[40%] truncate text-[11px] fg-3">{cmd.hint}</span>}
              {i === selected && <CornerDownLeft size={12} className="fg-3" />}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
