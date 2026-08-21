/**
 * 设置页：常规、壁纸、官方更新、内核路径、API 凭据、配置互通、关于
 */
import { useEffect, useState } from 'react'
import {
  KeyRound,
  Download,
  Upload,
  FolderOpen,
  Info,
  Plus,
  Trash2,
  Image as ImageIcon,
  Search,
  X as XIcon,
  RefreshCw,
  Rocket
} from 'lucide-react'
import { useApp } from '../stores/app'
import { Badge, Button, RangeSlider, Segmented, Switch } from '../components/ui'
import type { CredentialEntry, DesktopSettings, WallpaperInfo } from '@shared/types'

interface UpdateInfo {
  local: string | null
  latest: string | null
  outdated: boolean
  publishedAt: string | null
  error: string | null
}

export function SettingsPage(): React.JSX.Element {
  const { settings, appInfo, saveSettings, refreshKernel } = useApp()
  const [credentials, setCredentials] = useState<CredentialEntry[]>([])
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [kernelPortText, setKernelPortText] = useState('0')

  // 壁纸状态
  const [wallpaperPreview, setWallpaperPreview] = useState<string | null>(null)
  const [wpResults, setWpResults] = useState<WallpaperInfo[]>([])
  const [wpSearching, setWpSearching] = useState(false)
  const [wpProgress, setWpProgress] = useState<string | null>(null)
  const [wpScope, setWpScope] = useState<'auto' | 'custom'>('auto')
  const [wpCustomDir, setWpCustomDir] = useState('')

  // 官方更新状态
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateLog, setUpdateLog] = useState<string[]>([])
  const [updating, setUpdating] = useState(false)

  useEffect(() => {
    void window.dsh.credentials.list().then(setCredentials)
    if (settings) setKernelPortText(String(settings.kernelPort))
  }, [settings])

  const addCredential = async (): Promise<void> => {
    if (!key.trim() || !secret) {
      setNotice('请填写键名与密钥值')
      return
    }
    try {
      const entry = await window.dsh.credentials.set(key.trim(), label.trim() || key.trim(), secret)
      setKey('')
      setLabel('')
      setSecret('')
      setNotice(`凭据「${entry.key}」已加密保存（Windows DPAPI）`)
      setCredentials(await window.dsh.credentials.list())
    } catch (err) {
      setNotice(`保存失败：${(err as Error).message.replace(/^Error invoking remote method '[^']+':\s*/, '')}`)
    }
  }

  const wallpaperSrc = (path: string): string => `dsh-img://local/${encodeURIComponent(path).replace(/%2F/gi, '/')}`
  const currentWallpaper = settings?.wallpaperPath ?? ''
  // 壁纸文字颜色模式：auto=跟随主题 / dark=深色 / light=浅色 / custom=自定义 hex
  const wallpaperTextColor = settings?.wallpaperTextColor ?? ''
  const wallpaperTextMode: 'auto' | 'dark' | 'light' | 'custom' =
    wallpaperTextColor === '' ? 'auto' : wallpaperTextColor === '#111111' ? 'dark' : wallpaperTextColor === '#eeeeee' ? 'light' : 'custom'

  const searchWallpapers = async (): Promise<void> => {
    setWpSearching(true)
    setWpProgress('正在扫描磁盘图片…')
    setWpResults([])
    const off = window.dsh.wallpaper.onProgress((p) => {
      const counts = p.counts
        ? Object.entries(p.counts)
            .map(([k, v]) => `${k}: ${v}`)
            .join(' · ')
        : ''
      setWpProgress(`已扫描 ${p.scanned} 个条目，找到 ${p.found} 张图片${counts ? `（${counts}）` : ''}${p.currentDir ? ` — ${p.currentDir}` : ''}`)
    })
    try {
      const roots = wpScope === 'custom' && wpCustomDir ? [wpCustomDir] : undefined
      const list = await window.dsh.wallpaper.search(roots)
      setWpResults(list)
      setWpProgress(`搜索完成：共 ${list.length} 张图片（按修改时间倒序，含 jpg/png/gif/bmp/webp/tiff/ico）`)
    } catch (err) {
      setWpProgress(`搜索失败：${(err as Error).message}`)
    } finally {
      off()
      setWpSearching(false)
    }
  }

  const checkUpdate = async (): Promise<void> => {
    setUpdateChecking(true)
    const info = await window.dsh.update.check()
    setUpdateInfo(info)
    setUpdateChecking(false)
  }

  const runUpdate = async (): Promise<void> => {
    if (updating) return
    setUpdating(true)
    setUpdateLog([])
    setNotice(null)
    const offOut = window.dsh.terminal.onOutput((o) => {
      setUpdateLog((prev) => [...prev.slice(-80), o.text])
    })
    const offExit = window.dsh.terminal.onExit((o) => {
      setUpdateLog((prev) => [...prev, `[更新进程结束 exit=${o.exitCode}]`])
      if (o.exitCode === 0) {
        setNotice('内核更新完成，请重启 DSH Desktop 后生效')
        void checkUpdate()
      }
      setUpdating(false)
      offOut()
      offExit()
    })
    try {
      const s = await window.dsh.terminal.run(['npm', 'install', '-g', '@deepseek-ai/dsh@latest'], '')
      setUpdateLog((prev) => [...prev, `> npm install -g @deepseek-ai/dsh@latest (session ${s.id})`])
    } catch (err) {
      setUpdateLog((prev) => [...prev, `启动更新失败：${(err as Error).message}`])
      setUpdating(false)
      offOut()
      offExit()
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[760px] flex-col gap-8 px-6 py-6">
        {/* 常规 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[14px] font-medium" style={{ color: 'var(--fg)' }}>常规</h2>
          <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-[13px]" style={{ color: 'var(--fg)' }}>启动时自动拉起内核</div>
              <div className="text-[11px] fg-3">打开应用即启动 dsh --profile web，无需手动执行 CLI</div>
            </div>
            <Switch checked={settings?.autoStartKernel ?? true} onChange={(v) => void saveSettings({ autoStartKernel: v })} />
          </div>
          <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-[13px]" style={{ color: 'var(--fg)' }}>开机自启动</div>
              <div className="text-[11px] fg-3">登录 Windows 后自动启动 DSH Desktop（双击 exe 亦可直接启动，无需命令行）</div>
            </div>
            <Switch
              checked={settings?.openAtLogin ?? false}
              onChange={(v) => void window.dsh.app.setOpenAtLogin(v).then(() => void saveSettings({ openAtLogin: v }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-[13px]" style={{ color: 'var(--fg)' }}>关闭窗口最小化到托盘</div>
              <div className="text-[11px] fg-3">后台保持内核进程存活，不中断任务</div>
            </div>
            <Switch checked={settings?.minimizeToTray ?? true} onChange={(v) => void saveSettings({ minimizeToTray: v })} />
          </div>
          <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="text-[13px]" style={{ color: 'var(--fg)' }}>内核端口</div>
              <div className="text-[11px] fg-3">0 = 自动分配空闲端口（推荐）</div>
            </div>
            <input
              className="input-pill !w-24 text-center font-mono"
              value={kernelPortText}
              onChange={(e) => setKernelPortText(e.target.value.replace(/\D/g, ''))}
              onBlur={() => {
                const port = Number(kernelPortText || 0)
                void saveSettings({ kernelPort: Math.min(port, 65535) })
              }}
            />
          </div>
        </section>

        {/* 壁纸 */}
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-[14px] font-medium" style={{ color: 'var(--fg)' }}>
            <ImageIcon size={14} /> 壁纸
            <span className="text-[11px] font-normal fg-3">搜索本地磁盘图片，支持 jpg/png/gif/bmp/webp/tiff/ico（文件头魔数识别）</span>
          </h2>

          {/* 当前壁纸 */}
          <div className="flex items-center gap-3 rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            {currentWallpaper ? (
              <img
                src={wallpaperSrc(currentWallpaper)}
                className="h-16 w-24 rounded-lg object-cover"
                style={{ border: '1px solid var(--border)' }}
                alt="当前壁纸"
                onError={() => {
                  setWallpaperPreview('图片加载失败，文件可能已被移动')
                  void window.dsh.wallpaper.clear()
                }}
              />
            ) : (
              <div className="flex h-16 w-24 items-center justify-center rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                <span className="text-[11px] fg-3">未设置</span>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]" style={{ color: 'var(--fg)' }}>{currentWallpaper ? currentWallpaper.split(/[\\/]/).pop() : '无壁纸'}</div>
              <div className="truncate font-mono text-[11px] fg-3">{currentWallpaper}</div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[11px] fg-2">不透明度</span>
                <RangeSlider
                  min={5}
                  max={100}
                  value={settings?.wallpaperOpacity ?? 40}
                  onChange={(v) => {
                    void window.dsh.wallpaper.opacity(v).then(() => void saveSettings({ wallpaperOpacity: v }))
                  }}
                  className="w-32 accent-[var(--accent)]"
                />
                <span className="text-[11px] font-mono fg-2">{settings?.wallpaperOpacity ?? 40}%</span>
              </div>
              {currentWallpaper && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] fg-2">文字颜色</span>
                  <Segmented
                    options={[
                      { value: 'auto', label: '跟随主题' },
                      { value: 'dark', label: '深色' },
                      { value: 'light', label: '浅色' },
                      { value: 'custom', label: '自定义' }
                    ]}
                    value={wallpaperTextMode}
                    onChange={(v) => {
                      const next =
                        v === 'auto' ? '' : v === 'dark' ? '#111111' : v === 'light' ? '#eeeeee' : wallpaperTextColor || '#666666'
                      void saveSettings({ wallpaperTextColor: next })
                    }}
                  />
                  {wallpaperTextMode === 'custom' && (
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(wallpaperTextColor) ? wallpaperTextColor : '#666666'}
                      onChange={(e) => void saveSettings({ wallpaperTextColor: e.target.value })}
                      className="h-6 w-9 cursor-pointer rounded border-none bg-transparent p-0"
                      title="自定义文字颜色"
                    />
                  )}
                  <span className="text-[10px] fg-3">壁纸拉满不透明度后文字看不清时，选一个与壁纸相反的深浅色</span>
                </div>
              )}
            </div>
            {currentWallpaper && (
              <Button small variant="danger" onClick={() => void window.dsh.wallpaper.clear().then(() => void saveSettings({ wallpaperPath: '' }))}>
                <XIcon size={12} /> 移除
              </Button>
            )}
          </div>

          {/* 搜索 */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                options={[
                  { value: 'auto', label: '全部磁盘' },
                  { value: 'custom', label: '指定目录' }
                ]}
                value={wpScope}
                onChange={(v) => setWpScope(v)}
              />
              {wpScope === 'custom' && (
                <>
                  <input
                    className="input-pill !w-64 !py-1 font-mono text-[12px]"
                    placeholder="目录路径…"
                    value={wpCustomDir}
                    onChange={(e) => setWpCustomDir(e.target.value)}
                  />
                  <Button small onClick={async () => {
                    const dir = await window.dsh.app.pickDirectory()
                    if (dir) setWpCustomDir(dir)
                  }}>
                    <FolderOpen size={12} />
                  </Button>
                </>
              )}
              <Button small variant="primary" disabled={wpSearching} onClick={() => void searchWallpapers()}>
                <Search size={12} /> {wpSearching ? '搜索中…' : '搜索本地图片'}
              </Button>
              {wpSearching && <span className="text-[11px] fg-3">首次全盘扫描可能需要一两分钟</span>}
            </div>
            {wpProgress && <div className="text-[11px] fg-3">{wpProgress}</div>}
          </div>

          {/* 结果网格 */}
          {wpResults.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
              {wpResults.map((img) => (
                <button
                  key={img.path}
                  type="button"
                  className="group relative overflow-hidden rounded-lg border text-left"
                  style={{ borderColor: img.path === currentWallpaper ? 'var(--accent)' : 'var(--border)', aspectRatio: '1/1' }}
                  title={`${img.name}\n${img.format.toUpperCase()} ${img.width && img.height ? `${img.width}×${img.height}` : ''} ${Math.round(img.sizeBytes / 1024)}KB\n${img.path}`}
                  onClick={() => void window.dsh.wallpaper.set(img.path).then(() => void saveSettings({ wallpaperPath: img.path }))}
                >
                  <img src={wallpaperSrc(img.path)} alt={img.name} loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute bottom-0 left-0 right-0 truncate bg-black/50 px-1 py-[1px] text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {img.name}
                  </span>
                  {img.path === currentWallpaper && (
                    <span className="absolute right-1 top-1 rounded-full bg-accent px-1.5 text-[10px]" style={{ color: 'var(--accent-fg)' }}>当前</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 官方更新 */}
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-[14px] font-medium" style={{ color: 'var(--fg)' }}>
            <RefreshCw size={14} /> 官方更新
            <span className="text-[11px] font-normal fg-3">与 npm 官方源实时对比 @deepseek-ai/dsh 版本</span>
          </h2>
          <div className="flex flex-col gap-2 rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 text-[13px]">
              <span className="fg-2">本地内核</span>
              <span className="font-mono">{appInfo?.dshVersion ?? '未安装'}</span>
              {updateInfo && (
                <>
                  <span className="fg-3">→ 官方最新</span>
                  <span className="font-mono">{updateInfo.latest ?? '查询失败'}</span>
                  {updateInfo.outdated ? (
                    <Badge tone="danger">有更新</Badge>
                  ) : updateInfo.latest ? (
                    <Badge tone="success">已是最新</Badge>
                  ) : null}
                </>
              )}
              {updateInfo?.publishedAt && <span className="text-[11px] fg-3">发布于 {new Date(updateInfo.publishedAt).toLocaleString('zh-CN')}</span>}
            </div>
            {updateInfo?.error && <div className="text-[11px]" style={{ color: 'var(--danger)' }}>检查失败：{updateInfo.error}</div>}
            <div className="flex items-center gap-2">
              <Button small disabled={updateChecking} onClick={() => void checkUpdate()}>
                <RefreshCw size={12} /> {updateChecking ? '检查中…' : '检查更新'}
              </Button>
              <Button small variant="primary" disabled={!updateInfo?.outdated || updating} onClick={() => void runUpdate()}>
                <Rocket size={12} /> {updating ? '更新中…' : '一键更新内核'}
              </Button>
              <Button small onClick={() => void window.dsh.app.openExternal('https://github.com/deepseek-ai/deepseek-harness/releases')}>
                官方更新日志
              </Button>
            </div>
            {updateLog.length > 0 && (
              <pre className="max-h-32 overflow-y-auto rounded-lg bg-subtle p-2 text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--fg-2)' }}>
                {updateLog.join('\n')}
              </pre>
            )}
          </div>
        </section>

        {/* 内核与运行环境 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[14px] font-medium" style={{ color: 'var(--fg)' }}>内核与运行环境</h2>
          <div className="flex flex-col gap-2 rounded-xl border px-4 py-3 text-[12px]" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between">
              <span className="fg-2">dsh CLI</span>
              <span className="font-mono">{appInfo?.dshPath ? `✓ ${appInfo.dshPath} (v${appInfo.dshVersion ?? '?'})` : '未找到'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="fg-2">pnpm（插件安装依赖）</span>
              <span>{appInfo?.pnpmAvailable ? '✓ 可用' : '✗ 未安装 — npm install -g pnpm'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="fg-2">DSH_HOME</span>
              <button type="button" className="cursor-pointer font-mono text-accent" onClick={() => void window.dsh.app.showItemInFolder(appInfo?.dshHome ?? '')}>
                {appInfo?.dshHome ?? ''}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="fg-2">Electron</span>
              <span className="font-mono">v{appInfo?.electron} · {appInfo?.platform} {appInfo?.arch}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button small onClick={async () => {
              const dir = await window.dsh.app.pickDirectory()
              if (dir) await saveSettings({ dshPathOverride: dir })
            }}>
              <FolderOpen size={12} /> 指定 dsh 路径
            </Button>
            <Button small onClick={async () => {
              const dir = await window.dsh.app.pickDirectory()
              if (dir) await saveSettings({ dshHomeOverride: dir })
            }}>
              <FolderOpen size={12} /> 指定 DSH_HOME
            </Button>
            <Button small onClick={() => void refreshKernel()}>刷新状态</Button>
          </div>
        </section>

        {/* 凭据 */}
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-[14px] font-medium" style={{ color: 'var(--fg)' }}>
            <KeyRound size={14} /> API 凭据
            <span className="text-[11px] font-normal fg-3">本地加密存储（Windows DPAPI），绝不上传</span>
          </h2>
          <div className="flex flex-col gap-2">
            {credentials.map((c) => (
              <div key={c.key} className="flex items-center gap-2 rounded-xl border px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
                <span className="flex-1 text-[13px]" style={{ color: 'var(--fg)' }}>{c.label}</span>
                <code className="text-[11px] fg-3">{c.key}</code>
                <Badge tone="success">已保存</Badge>
                <Button small variant="danger" onClick={async () => {
                  await window.dsh.credentials.remove(c.key)
                  void window.dsh.credentials.list().then(setCredentials)
                }}>
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
            {credentials.length === 0 && <div className="text-[12px] fg-3">尚未保存任何凭据</div>}
          </div>
          <div className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex gap-2">
              <input className="input-pill !w-40" placeholder="环境变量键（如 DEEPSEEK_API_KEY）" value={key} onChange={(e) => setKey(e.target.value)} />
              <input className="input-pill flex-1" placeholder="显示名称" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <input className="input-pill flex-1" type="password" placeholder="密钥值（加密后存储）" value={secret} onChange={(e) => setSecret(e.target.value)} />
              <Button small variant="primary" disabled={!key.trim() || !secret} onClick={() => void addCredential()}>
                <Plus size={12} /> 保存
              </Button>
            </div>
          </div>
          <p className="text-[11px] fg-3">
            保存的凭据经 Windows DPAPI 加密存储（绝不上传、不落盘明文），内核每次启动时自动解密并注入为同名环境变量
            （如保存键 DASHSCOPE_API_KEY → 注入 DASHSCOPE_API_KEY）。官方模型的 apiKeyEnv 指向该键即可接入任意
            兼容 API（DeepSeek / 阿里百炼 / OpenAI 等），配置格式与原生 DSH 完全互通。
          </p>
        </section>

        {/* 用量与计费 */}
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-1.5 text-[14px] font-medium" style={{ color: 'var(--fg)' }}>
            <RefreshCw size={14} /> 用量与计费
            <span className="text-[11px] font-normal fg-3">左侧栏用量面板的金额估算参数（本地计算，不上传）</span>
          </h2>
          <div className="flex flex-col gap-2 rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  { key: 'usagePriceInput', label: '输入（缓存未命中）', hint: '¥/百万 tokens' },
                  { key: 'usagePriceCache', label: '输入（缓存命中）', hint: '¥/百万 tokens' },
                  { key: 'usagePriceOutput', label: '输出', hint: '¥/百万 tokens' }
                ] as const
              ).map((f) => (
                <div key={f.key} className="flex flex-col gap-1">
                  <label className="text-[12px] fg-2">{f.label}</label>
                  <input
                    className="input-pill !w-full text-center font-mono text-[12px]"
                    defaultValue={String(settings?.[f.key] ?? 0)}
                    key={`${f.key}-${String(settings?.[f.key])}`}
                    onBlur={(e) => {
                      const v = Number.parseFloat(e.target.value)
                      if (Number.isFinite(v) && v >= 0 && v !== settings?.[f.key]) {
                        void saveSettings({ [f.key]: v } as Partial<DesktopSettings>)
                      }
                    }}
                  />
                  <span className="text-[10px] fg-3">{f.hint}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] fg-3">
              默认按 DeepSeek V4-Flash 空闲时段官方价（输入 ¥1.5 / 缓存命中 ¥0.05 / 输出 ¥4.5 每百万 tokens，
              2026-08-17 调价后）。实际费用与模型、时段（高峰 9:00–14:00 翻倍）、缓存命中率有关，此处为估算。
              用量数据来自官方内核投影缓存，按会话累计；「今日」为今日有活动的会话（近似口径）。
            </p>
          </div>
        </section>

        {/* 配置互通 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[14px] font-medium" style={{ color: 'var(--fg)' }}>配置互通（官方 DSH 兼容）</h2>
          <div className="flex items-center gap-2">
            <Button small onClick={async () => {
              const file = await window.dsh.config.export()
              setNotice(file ? `已导出: ${file}` : '导出取消')
            }}>
              <Download size={12} /> 导出 settings.yaml
            </Button>
            <Button small onClick={async () => {
              const result = await window.dsh.config.import()
              if (result) {
                setNotice(`已导入 ${result.file}，原配置备份至 ${result.backup}。建议重启内核生效。`)
                void window.dsh.kernel.restart(useApp.getState().activeWorkspaceId)
              }
            }}>
              <Upload size={12} /> 导入 settings.yaml
            </Button>
          </div>
          <p className="text-[11px] fg-3">配置文件与原生 dsh 完全互通：工作区、插件集、模型配置、运行模式全部共享官方格式。</p>
        </section>

        {/* 关于 */}
        <section className="flex flex-col gap-2 pb-8">
          <h2 className="flex items-center gap-1.5 text-[14px] font-medium" style={{ color: 'var(--fg)' }}>
            <Info size={14} /> 关于
          </h2>
          <div className="text-[12px] fg-2">
            DSH Desktop v{appInfo?.version} — 基于官方 DeepSeek Harness（MIT）封装的 Windows 桌面客户端。
            <br />
            内核：{appInfo?.dshVersion ? `dsh v${appInfo.dshVersion}` : '未安装 @deepseek-ai/dsh'}
          </div>
          <Button small onClick={() => void window.dsh.app.openExternal('https://github.com/deepseek-ai/deepseek-harness')}>
            官方仓库
          </Button>
        </section>

        {notice && <div className="pb-4 text-[12px]" style={{ color: 'var(--success)' }}>{notice}</div>}
      </div>
    </div>
  )
}
