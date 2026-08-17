/**
 * 插件市场页
 * 分类浏览 / 搜索排序 / 一键安装卸载 / 版本管理 / 详情（README、版本日志）/ 本地导入 / 安全提示
 */
import { useEffect, useMemo, useState } from 'react'
import {
  Search,
  Star,
  Download,
  Trash2,
  FolderOpen,
  RefreshCw,
  AlertTriangle,
  Package,
  ShieldCheck,
  ChevronRight
} from 'lucide-react'
import { useApp } from '../stores/app'
import { usePlugins, sortPlugins, type SortKey } from '../stores/plugins'
import { Badge, Button, EmptyState, Modal, Segmented, Switch } from '../components/ui'
import type { PluginCategory, PluginDetail, RegistryPlugin } from '@shared/types'

const CATEGORY_ORDER: Array<PluginCategory | 'all'> = ['all', 'tool', 'model', 'skill', 'ui', 'sandbox', 'other']

function RiskBadges({ plugin }: { plugin: RegistryPlugin }): React.JSX.Element {
  if (plugin.riskFlags.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--success)' }}>
        <ShieldCheck size={11} /> 已扫描
      </span>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {plugin.riskFlags.map((f, i) => (
        <span
          key={i}
          title={f.message}
          className="inline-flex cursor-help items-center gap-1 rounded-full px-1.5 py-[1px] text-[10px]"
          style={{
            color: f.level === 'danger' ? 'var(--danger)' : f.level === 'warn' ? 'var(--fg)' : 'var(--fg-2)',
            background: f.level === 'danger' ? 'color-mix(in srgb, var(--danger) 10%, transparent)' : 'var(--bg-subtle)'
          }}
        >
          <AlertTriangle size={9} />
          {f.kind === 'install-script' ? '安装脚本' : f.kind === 'no-license' ? '无许可证' : f.kind === 'archived' ? '已归档' : f.kind === 'unknown-author' ? '作者未知' : '未验证'}
        </span>
      ))}
    </span>
  )
}

export function PluginsPage(): React.JSX.Element {
  const { market, installed, query, category, sort, loading, error, search, setQuery, setCategory, setSort, refreshInstalled } = usePlugins()
  const [tab, setTab] = useState<'market' | 'installed'>('market')
  const [detail, setDetail] = useState<{ name: string; data: PluginDetail | null } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [opLog, setOpLog] = useState<string | null>(null)
  // 安装任务进度：{ name, phase, status } 队列，running 显示横幅，终态 4 秒后消失
  const [tasks, setTasks] = useState<Array<{ name: string; phase: string; status: string; at: number }>>([])

  useEffect(() => {
    void search()
    void refreshInstalled()
    return window.dsh.plugins.onOp((op) => {
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.name === op.name && t.phase === op.phase)
        const next = [...prev]
        if (idx >= 0) next[idx] = { name: op.name, phase: op.phase, status: op.status, at: Date.now() }
        else next.push({ name: op.name, phase: op.phase, status: op.status, at: Date.now() })
        return next.slice(-5)
      })
      setOpLog(`${op.phase} ${op.name}: ${op.status === 'running' ? '进行中…' : op.status === 'done' ? '完成' : '失败'}`)
    })
  }, [search, refreshInstalled])

  // 终态任务自动清除
  useEffect(() => {
    if (!tasks.some((t) => t.status !== 'running')) return
    const timer = setTimeout(() => {
      setTasks((prev) => prev.filter((t) => t.status === 'running' || Date.now() - t.at < 4000))
    }, 4000)
    return () => clearTimeout(timer)
  }, [tasks])

  const categoryLabels: Record<string, string> = {
    all: '全部',
    tool: '工具',
    model: '模型',
    skill: '技能',
    ui: '界面',
    sandbox: '沙箱',
    other: '其他'
  }

  const filtered = useMemo(() => {
    const base = category === 'all' ? market : market.filter((p) => p.category === category)
    return sortPlugins(base, sort)
  }, [market, category, sort])

  const installedNames = useMemo(() => new Set(installed.map((p) => p.name)), [installed])

  const doInstall = async (spec: string): Promise<void> => {
    setBusy(spec)
    setNotice(null)
    const result = await window.dsh.plugins.install(spec)
    setBusy(null)
    setNotice(result.message)
    if (result.ok) {
      await refreshInstalled()
      setDetail(null)
    } else if (result.logTail) {
      setOpLog(result.logTail.slice(-6).join('\n'))
    }
  }

  const doUninstall = async (name: string): Promise<void> => {
    setBusy(name)
    const result = await window.dsh.plugins.uninstall(name)
    setBusy(null)
    setNotice(result.message)
    await refreshInstalled()
  }

  const openDetail = async (name: string): Promise<void> => {
    setDetail({ name, data: null })
    const data = await window.dsh.plugins.detail(name)
    setDetail({ name, data })
  }

  const pickLocalDir = async (): Promise<void> => {
    const dir = await window.dsh.app.pickDirectory()
    if (dir) {
      setNotice(`正在安装本地插件: ${dir}`)
      await doInstall(`link:${dir}`)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-3 border-b px-3" style={{ borderColor: 'var(--border)' }}>
        <Segmented
          options={[
            { value: 'market', label: '插件市场' },
            { value: 'installed', label: `已安装 (${installed.length})` }
          ]}
          value={tab}
          onChange={setTab}
        />
        <div className="flex-1" />
        <Button small onClick={() => void pickLocalDir()}>
          <FolderOpen size={12} /> 导入本地插件
        </Button>
        <Button small onClick={() => void search()}>
          <RefreshCw size={12} />
        </Button>
      </div>

      {/* 安装任务进度横幅 */}
      {tasks.length > 0 && (
        <div className="flex shrink-0 flex-col gap-1 border-b px-4 py-2" style={{ borderColor: 'var(--border)', background: 'var(--bg-subtle)' }}>
          {tasks.map((t, i) => (
            <div key={`${t.name}-${t.phase}-${i}`} className="flex items-center gap-2 text-[12px]">
              {t.status === 'running' ? (
                <>
                  <span className="h-2.5 w-2.5 animate-spin rounded-full border-[2px]" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
                  <span style={{ color: 'var(--fg)' }}>{t.name}</span>
                  <span className="fg-3">{t.phase === 'install' ? '安装中（pnpm 解析依赖可能需要一点时间）…' : `${t.phase}中…`}</span>
                </>
              ) : t.status === 'done' ? (
                <>
                  <span style={{ color: 'var(--success)' }}>✓</span>
                  <span style={{ color: 'var(--fg)' }}>{t.name}</span>
                  <span className="fg-3">{t.phase}完成，内核将自动重启生效</span>
                </>
              ) : (
                <>
                  <span style={{ color: 'var(--danger)' }}>✗</span>
                  <span style={{ color: 'var(--fg)' }}>{t.name}</span>
                  <span className="fg-3">{t.phase}失败，查看下方日志</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {notice && (
        <div className="border-b px-4 py-2 text-[12px]" style={{ borderColor: 'var(--border)', color: notice.startsWith('失败') || notice.includes('失败') ? 'var(--danger)' : 'var(--success)' }}>
          {notice}
        </div>
      )}

      {tab === 'market' ? (
        <>
          <div className="flex shrink-0 flex-col gap-2 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 fg-3" />
                <input
                  className="input-pill !pl-9"
                  placeholder="搜索插件（名称 / 描述 / 分类）…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void search()
                  }}
                />
              </div>
              <Segmented<SortKey>
                options={[
                  { value: 'stars', label: '星标' },
                  { value: 'updated', label: '更新' },
                  { value: 'name', label: '名称' }
                ]}
                value={sort}
                onChange={setSort}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {CATEGORY_ORDER.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="btn-pill sm"
                  style={category === c ? { background: 'var(--bg-subtle)', color: 'var(--fg)' } : undefined}
                  onClick={() => setCategory(c)}
                >
                  {categoryLabels[c]}
                </button>
              ))}
              <span className="ml-auto text-[11px] fg-3">数据源：GitHub topic:dsh-plugin + npm</span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {loading && <div className="py-10 text-center text-[13px] fg-3">加载中…</div>}
            {error && <div className="py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>市场加载失败：{error}</div>}
            {!loading && !error && filtered.length === 0 && (
              <EmptyState icon={<Package size={20} />} text="没有找到插件，换个关键词试试" />
            )}
            <div className="flex flex-col">
              {filtered.map((plugin) => {
                const isInstalled = installedNames.has(plugin.name)
                return (
                  <div
                    key={plugin.name}
                    className="flex cursor-pointer items-center gap-3 border-b px-1 py-3"
                    style={{ borderColor: 'var(--border)' }}
                    onClick={() => void openDetail(plugin.name)}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium" style={{ color: 'var(--fg)' }}>{plugin.name}</span>
                        <Badge tone="neutral">{categoryLabels[plugin.category] ?? plugin.category}</Badge>
                        {plugin.archived && <Badge tone="warn">已归档</Badge>}
                        <RiskBadges plugin={plugin} />
                      </div>
                      <div className="truncate text-[12px] fg-2">{plugin.description || '暂无描述'}</div>
                      <div className="flex items-center gap-3 text-[11px] fg-3">
                        <span className="inline-flex items-center gap-0.5"><Star size={10} /> {plugin.stars}</span>
                        <span>更新于 {new Date(plugin.updatedAt).toLocaleDateString('zh-CN')}</span>
                        {plugin.npmVersion && <span>npm {plugin.npmVersion}</span>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {isInstalled ? (
                        <Badge tone="success">已安装</Badge>
                      ) : (
                        <Button
                          small
                          variant="primary"
                          disabled={busy !== null}
                          onClick={() => void doInstall(plugin.name)}
                        >
                          {busy === plugin.name ? '安装中…' : <><Download size={12} /> 安装</>}
                        </Button>
                      )}
                      <ChevronRight size={14} className="fg-3" />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {installed.length === 0 && <EmptyState icon={<Package size={20} />} text="还没有安装任何插件" />}
          <div className="flex flex-col">
            {installed.map((p) => (
              <div key={p.name} className="flex items-center gap-3 border-b px-1 py-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium" style={{ color: 'var(--fg)' }}>{p.name}</span>
                    {p.kind === 'link' ? <Badge tone="accent">本地链接</Badge> : <Badge tone="neutral">{p.version || '未知版本'}</Badge>}
                  </div>
                  <div className="truncate text-[11px] fg-3" title={p.spec}>{p.spec}</div>
                </div>
                <Switch checked={p.enabled} onChange={(v) => void window.dsh.plugins.enable(p.name, v).then(refreshInstalled)} label={p.enabled ? '启用' : '禁用'} />
                <Button small disabled={busy !== null} onClick={() => void doUninstall(p.name)} title="卸载">
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 详情弹窗 */}
      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail?.name ?? '插件详情'}>
        {detail && !detail.data && <div className="py-8 text-center text-[13px] fg-3">加载详情中…</div>}
        {detail?.data && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[15px] font-medium" style={{ color: 'var(--fg)' }}>{detail.data.plugin?.name ?? detail.name}</span>
                {detail.data.plugin && <RiskBadges plugin={detail.data.plugin} />}
              </div>
              {detail.data.plugin?.description && <span className="text-[13px] fg-2">{detail.data.plugin.description}</span>}
              <div className="flex items-center gap-3 text-[11px] fg-3">
                {detail.data.plugin?.npmVersion && <span>最新: {detail.data.plugin.npmVersion}</span>}
                {detail.data.plugin?.license && <span>许可证: {detail.data.plugin.license}</span>}
                {detail.data.plugin?.repo && (
                  <button type="button" className="text-accent cursor-pointer" onClick={() => void window.dsh.app.openExternal(detail.data!.plugin!.repo!)}>
                    查看源码
                  </button>
                )}
              </div>
            </div>

            {detail.data.versions.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[12px] fg-2">版本管理</span>
                <select
                  className="input-pill !w-auto !py-1 text-[12px]"
                  defaultValue=""
                  onChange={async (e) => {
                    const v = e.target.value
                    if (!v) return
                    const result = await window.dsh.plugins.install(`${detail.name}@${v}`)
                    setNotice(result.message)
                  }}
                >
                  <option value="" disabled>回滚到历史版本…</option>
                  {detail.data.versions.slice(-30).reverse().map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            )}

            {installedNames.has(detail.name) ? (
              <div className="flex gap-2">
                <Badge tone="success">已安装</Badge>
                <Button small onClick={() => void window.dsh.plugins.install(detail.name)} title="更新到最新版本">
                  <RefreshCw size={12} /> 更新
                </Button>
              </div>
            ) : (
              <Button variant="primary" disabled={busy !== null} onClick={() => void doInstall(detail.name)}>
                <Download size={13} /> 安装 {detail.name}
              </Button>
            )}

            {detail.data.readme ? (
              <div className="max-h-[380px] overflow-y-auto rounded-xl border p-3 text-[12px] leading-relaxed" style={{ borderColor: 'var(--border)', color: 'var(--fg-2)' }}>
                <pre className="whitespace-pre-wrap font-sans">{detail.data.readme.slice(0, 12000)}</pre>
              </div>
            ) : (
              <div className="text-[12px] fg-3">该插件未提供 README 说明。</div>
            )}
          </div>
        )}
      </Modal>

      {opLog && (
        <div className="border-t px-4 py-2" style={{ borderColor: 'var(--border)' }}>
          <pre className="max-h-24 overflow-y-auto text-[11px] leading-relaxed fg-3 whitespace-pre-wrap">{opLog}</pre>
        </div>
      )}
    </div>
  )
}
