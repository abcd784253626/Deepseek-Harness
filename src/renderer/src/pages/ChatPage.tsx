/**
 * 会话页：内嵌官方 DSH Web UI（webview）
 * - 官方全部 Agent 能力原样可用（会话/工具/轨迹/审批/模型选择）
 * - 主题系统注入官方界面（CSS 变量 + 自定义 CSS）
 * - 顶部工具条：内核状态、运行模式切换、打开浏览器、重载
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, RefreshCw, Play, Square, Power } from 'lucide-react'
import { useApp } from '../stores/app'
import { buildWebviewThemeScript, wallpaperUrlOf } from '../lib/theme'
import { Badge, Button, Segmented } from '../components/ui'
import { WEBVIEW_PARTITION } from '@shared/types'
import type { AgentMode } from '@shared/types'

interface WebviewElement extends HTMLElement {
  src: string
  executeJavaScript: (code: string) => Promise<unknown>
  reload: () => void
  loadURL: (url: string) => Promise<void>
  getURL: () => string
}

export function ChatPage(): React.JSX.Element {
  const kernel = useApp((s) => s.kernel)
  const activeTheme = useApp((s) => s.activeTheme)
  const customCss = useApp((s) => s.customCss)
  const settings = useApp((s) => s.settings)
  const saveSettings = useApp((s) => s.saveSettings)
  const refreshKernel = useApp((s) => s.refreshKernel)
  const activeWorkspaceId = useApp((s) => s.activeWorkspaceId)
  const appInfo = useApp((s) => s.appInfo)

  const webviewRef = useRef<WebviewElement | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [injectTick, setInjectTick] = useState(0)
  const themeRef = useRef(activeTheme)
  const cssRef = useRef(customCss)
  const wallpaperRef = useRef<string | null>(null)
  themeRef.current = activeTheme
  cssRef.current = customCss
  wallpaperRef.current = wallpaperUrlOf(settings?.wallpaperPath)

  const running = kernel?.status === 'running'

  // 内核就绪后加载官方 UI
  useEffect(() => {
    if (kernel?.status === 'running' && kernel.url) {
      setUrl((prev) => (prev === kernel.url ? prev : kernel.url))
    } else {
      setUrl(null)
    }
  }, [kernel])

  const handleDomReady = useCallback(() => {
    setInjectTick((t) => t + 1)
  }, [])

  // dom-ready 后注入主题；主题变化时重新注入
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return
    wv.addEventListener('dom-ready', handleDomReady)
    return () => wv.removeEventListener('dom-ready', handleDomReady)
  }, [handleDomReady, url])

  useEffect(() => {
    if (!running || !activeTheme) return
    const wv = webviewRef.current
    if (!wv) return
    void wv
      .executeJavaScript(buildWebviewThemeScript(activeTheme, customCss, wallpaperRef.current))
      .catch(() => setInjectTick((t) => t + 1))
    // 等 webview 存在后再注入（dom-ready 可能早于 ref 绑定）
    const timer = setTimeout(() => {
      const wv2 = webviewRef.current
      if (wv2) void wv2.executeJavaScript(buildWebviewThemeScript(themeRef.current!, cssRef.current, wallpaperRef.current)).catch(() => undefined)
    }, 400)
    return () => clearTimeout(timer)
  }, [running, activeTheme, customCss, injectTick, settings?.wallpaperPath, settings?.wallpaperOpacity])

  const changeMode = useCallback(
    async (mode: AgentMode) => {
      await saveSettings({ lastMode: mode })
      await window.dsh.kernel.restart(activeWorkspaceId)
      await refreshKernel()
    },
    [saveSettings, activeWorkspaceId, refreshKernel]
  )

  const modes = useApp((s) => s.modes)

  return (
    <div className="flex h-full flex-col">
      {/* 工具条 */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: 'var(--border)' }}>
        <span className="text-[12px] fg-2">会话</span>
        <Badge tone={running ? 'success' : 'neutral'}>{running ? '官方 Web UI' : kernel?.status === 'starting' || kernel?.status === 'restarting' ? '内核启动中' : '内核未运行'}</Badge>
        {kernel?.port && <span className="text-[11px] fg-3">127.0.0.1:{kernel.port}</span>}
        <div className="flex-1" />
        {modes.length > 0 && (
          <Segmented<AgentMode>
            options={modes.map((m) => ({ value: m.id, label: m.name.replace('模式', '') }))}
            value={settings?.lastMode ?? 'standard'}
            onChange={(v) => void changeMode(v)}
          />
        )}
        {running && kernel?.url && (
          <Button small title="在系统浏览器中打开官方 UI" onClick={() => void window.dsh.app.openExternal(kernel.url!)}>
            <ExternalLink size={12} />
          </Button>
        )}
        {running && (
          <Button
            small
            title="重新加载官方 UI"
            onClick={() => {
              const wv = webviewRef.current
              if (wv) wv.reload()
            }}
          >
            <RefreshCw size={12} />
          </Button>
        )}
        {!running ? (
          <Button
            small
            variant="primary"
            disabled={kernel?.status === 'starting' || kernel?.status === 'restarting'}
            onClick={() => void window.dsh.kernel.start(activeWorkspaceId).then(refreshKernel)}
          >
            <Play size={12} /> 启动内核
          </Button>
        ) : (
          <Button small onClick={() => void window.dsh.kernel.stop().then(refreshKernel)} title="停止内核">
            <Square size={12} />
          </Button>
        )}
      </div>

      {/* 官方 UI */}
      {running && url ? (
        <div className="webview-wrap min-h-0">
          <webview
            ref={(el) => {
              webviewRef.current = el as unknown as WebviewElement | null
            }}
            src={url}
            partition={WEBVIEW_PARTITION}
            className="min-h-0"
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <Power size={22} className="fg-3" />
          <div className="text-[14px]" style={{ color: 'var(--fg)' }}>
            {kernel?.status === 'error' ? '内核启动失败' : '内核未运行'}
          </div>
          {kernel?.lastError && <div className="max-w-[480px] text-center text-[12px] fg-3">{kernel.lastError}</div>}
          <Button
            variant="primary"
            disabled={kernel?.status === 'starting' || kernel?.status === 'restarting'}
            onClick={() => void window.dsh.kernel.start(activeWorkspaceId).then(refreshKernel)}
          >
            <Play size={13} /> 启动内核
          </Button>
          {!appInfo?.dshPath && (
            <div className="max-w-[480px] text-center text-[12px]" style={{ color: 'var(--danger)' }}>
              未找到 dsh CLI。请先安装：npm install -g @deepseek-ai/dsh
            </div>
          )}
        </div>
      )}
    </div>
  )
}
