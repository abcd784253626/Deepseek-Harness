/**
 * 左侧窄边栏：工作区切换 + 功能入口（会话/插件/主题/终端/设置）
 * 32px 行高，密集但不拥挤；底部为内核状态与运行模式。
 */
import { useState } from 'react'
import {
  MessageSquare,
  Puzzle,
  Palette,
  Settings,
  FolderOpen,
  Terminal,
  Maximize2,
  Plus,
  RefreshCw,
  Command,
  Wallet
} from 'lucide-react'
import { useApp, type Page } from '../stores/app'
import { Badge } from './ui'

const NAV: Array<{ page: Page; label: string; icon: typeof MessageSquare }> = [
  { page: 'chat', label: '会话', icon: MessageSquare },
  { page: 'plugins', label: '插件', icon: Puzzle },
  { page: 'themes', label: '主题', icon: Palette },
  { page: 'terminal', label: '终端', icon: Terminal },
  { page: 'workspaces', label: '工作区', icon: FolderOpen },
  { page: 'settings', label: '设置', icon: Settings }
]

const STATUS_TEXT: Record<string, { label: string; tone: 'neutral' | 'success' | 'warn' | 'danger' }> = {
  running: { label: '内核运行中', tone: 'success' },
  starting: { label: '内核启动中', tone: 'warn' },
  restarting: { label: '自动恢复中', tone: 'warn' },
  stopped: { label: '内核已停止', tone: 'neutral' },
  error: { label: '内核异常', tone: 'danger' }
}

/** 数字格式化：1234 → 1.2K，1234567 → 1.2M */
function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

/** 金额格式化：小额保留 4 位，大额 2 位 */
function fmtYuan(v: number): string {
  if (v >= 100) return v.toFixed(0)
  if (v >= 1) return v.toFixed(2)
  if (v >= 0.01) return v.toFixed(2)
  return v > 0 ? v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : '0.00'
}

/** 用量面板：今日 tokens / 今日费用 / 累计费用 + 比例条 + 悬停明细 */
function UsagePanel(): React.JSX.Element {
  const usage = useApp((s) => s.usage)
  const refreshUsage = useApp((s) => s.refreshUsage)

  if (!usage) return <></>

  const today = usage.today
  const total = usage.total
  const totalTokens = today.totals.inputTokens + today.totals.cacheReadTokens + today.totals.outputTokens
  const seg = (n: number): number => (n > 0 && totalTokens > 0 ? Math.max(2, Math.round((n / totalTokens) * 100)) : 0)
  const tooltip =
    usage.sessionCount === 0
      ? '暂无用量数据'
      : `今日 = 今日有活动的会话累计（近似）\n估算金额按 ¥/百万 tokens：输入 ${usage.pricing.input} · 缓存 ${usage.pricing.cacheRead} · 输出 ${usage.pricing.output}\n—— 各工作区累计 ——\n${usage.workspaces
          .slice(0, 5)
          .map((w) => `${w.label}：¥${fmtYuan(w.cost.total)}（${w.sessionCount} 个会话）`)
          .join('\n')}${usage.workspaces.length > 5 ? `\n… 共 ${usage.workspaces.length} 个工作区` : ''}`

  return (
    <div
      className="mx-2 mb-1 rounded-xl border p-2"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
      title={tooltip}
    >
      <div className="mb-1 flex items-center gap-1">
        <Wallet size={11} className="fg-2" />
        <span className="flex-1 text-[11px] fg-2">用量统计</span>
        <button
          type="button"
          className="btn-pill sm !px-1"
          title="刷新用量"
          onClick={() => void refreshUsage()}
        >
          <RefreshCw size={10} />
        </button>
      </div>
      {usage.sessionCount === 0 ? (
        <div className="px-1 pb-1 text-[11px] fg-3">暂无用量数据</div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 px-1 text-[11px]">
            <span className="fg-2">今日</span>
            <span className="font-mono" style={{ color: 'var(--fg)' }}>
              {fmtTokens(today.totals.inputTokens)} 入 / {fmtTokens(today.totals.outputTokens)} 出
            </span>
          </div>
          <div className="mt-1 h-[4px] overflow-hidden rounded-full bg-subtle">
            <div className="flex h-full">
              <span style={{ width: `${seg(today.totals.inputTokens)}%`, background: 'var(--accent)' }} />
              <span style={{ width: `${seg(today.totals.cacheReadTokens)}%`, background: 'var(--fg-3)' }} />
              <span style={{ width: `${seg(today.totals.outputTokens)}%`, background: 'var(--success)' }} />
            </div>
          </div>
          <div className="mt-1.5 flex flex-col gap-[2px] px-1 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="fg-3">今日费用</span>
              <span className="font-mono" style={{ color: 'var(--fg)' }}>≈ ¥{fmtYuan(today.cost.total)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="fg-3">累计费用</span>
              <span className="font-mono" style={{ color: 'var(--fg)' }}>≈ ¥{fmtYuan(total.cost.total)}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function Sidebar(): React.JSX.Element {
  const page = useApp((s) => s.page)
  const setPage = useApp((s) => s.setPage)
  const workspaces = useApp((s) => s.workspaces)
  const activeWorkspaceId = useApp((s) => s.activeWorkspaceId)
  const setActiveWorkspace = useApp((s) => s.setActiveWorkspace)
  const kernel = useApp((s) => s.kernel)
  const modes = useApp((s) => s.modes)
  const settings = useApp((s) => s.settings)
  const toggleImmersive = useApp((s) => s.toggleImmersive)
  const setCommandPalette = useApp((s) => s.setCommandPalette)
  const refreshKernel = useApp((s) => s.refreshKernel)
  const [wsOpen, setWsOpen] = useState(false)

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId)
  const status = STATUS_TEXT[kernel?.status ?? 'stopped']
  const currentMode = modes.find((m) => m.id === settings?.lastMode)

  return (
    <aside
      className="app-sidebar flex h-full w-[200px] shrink-0 flex-col border-r"
      style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
    >
      {/* 工作区切换 */}
      <div className="px-2 pt-2 pb-1">
        <button
          type="button"
          className="nav-item relative"
          style={{ height: 32 }}
          onClick={() => setWsOpen((v) => !v)}
          title="切换工作区"
        >
          <FolderOpen size={14} />
          <span className="flex-1 truncate">{activeWs?.name ?? '未选择工作区'}</span>
          <Plus size={12} className="fg-3" />
        </button>
        {wsOpen && (
          <div className="mt-1 rounded-xl border p-1" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                className="nav-item !h-[28px] text-[12px]"
                style={ws.id === activeWorkspaceId ? { color: 'var(--fg)', fontWeight: 500 } : undefined}
                onClick={() => {
                  setWsOpen(false)
                  void setActiveWorkspace(ws.id)
                }}
              >
                <span className="truncate">{ws.name}</span>
              </button>
            ))}
            <button
              type="button"
              className="nav-item !h-[28px] text-[12px]"
              onClick={() => {
                setWsOpen(false)
                setPage('workspaces')
              }}
            >
              <Plus size={12} /> 管理工作区
            </button>
          </div>
        )}
      </div>

      <div className="hairline mx-2" />

      {/* 功能导航 */}
      <nav className="flex flex-col gap-[2px] p-2">
        {NAV.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.page}
              type="button"
              className={`nav-item relative ${page === item.page ? 'active' : ''}`}
              onClick={() => setPage(item.page)}
            >
              <Icon size={14} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* 用量统计（空白弹性区） */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <UsagePanel />
      </div>

      {/* 底部：内核状态 + 模式 + 快捷入口 */}
      <div className="flex flex-col gap-1 border-t p-2" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-1.5 px-1 py-[2px]">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: status.tone === 'success' ? 'var(--success)' : status.tone === 'danger' ? 'var(--danger)' : 'var(--fg-3)' }}
          />
          <span className="flex-1 truncate text-[11px] fg-2">{status.label}</span>
          <button type="button" className="btn-pill sm !px-1.5" title="刷新内核状态" onClick={() => void refreshKernel()}>
            <RefreshCw size={11} />
          </button>
        </div>
        {currentMode && (
          <div className="px-1 pb-1">
            <Badge tone="accent">{currentMode.name}</Badge>
          </div>
        )}
        <div className="flex items-center gap-1">
          <button type="button" className="btn-pill sm !px-1.5" title="命令面板 (Ctrl+Shift+P)" onClick={() => setCommandPalette(true)}>
            <Command size={12} />
          </button>
          <button type="button" className="btn-pill sm !px-1.5" title="无干扰模式" onClick={toggleImmersive}>
            <Maximize2 size={12} />
          </button>
        </div>
      </div>
    </aside>
  )
}
