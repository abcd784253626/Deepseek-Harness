/**
 * 应用壳：主题应用 + 布局（标题栏/侧边栏/页面区）+ 命令面板
 */
import { useEffect, useMemo } from 'react'
import { useApp } from './stores/app'
import { applyThemeToDocument, wallpaperUrlOf } from './lib/theme'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { CommandPalette } from './components/CommandPalette'
import { ChatPage } from './pages/ChatPage'
import { PluginsPage } from './pages/PluginsPage'
import { ThemesPage } from './pages/ThemesPage'
import { SettingsPage } from './pages/SettingsPage'
import { WorkspacesPage } from './pages/WorkspacesPage'
import { TerminalPage } from './pages/TerminalPage'

export default function App(): React.JSX.Element {
  const ready = useApp((s) => s.ready)
  const bootError = useApp((s) => s.bootError)
  const page = useApp((s) => s.page)
  const immersive = useApp((s) => s.immersive)
  const activeTheme = useApp((s) => s.activeTheme)
  const customCss = useApp((s) => s.customCss)
  const settings = useApp((s) => s.settings)

  useEffect(() => {
    void useApp.getState().bootstrap()
  }, [])

  // 主题实时应用（切换无闪烁）
  useEffect(() => {
    if (activeTheme) applyThemeToDocument(activeTheme, customCss)
  }, [activeTheme, customCss])

  // 壁纸背景
  const wallpaperUrl = useMemo(() => wallpaperUrlOf(settings?.wallpaperPath), [settings?.wallpaperPath])

  useEffect(() => {
    document.body.classList.toggle('has-wallpaper', Boolean(wallpaperUrl))
    return () => document.body.classList.remove('has-wallpaper')
  }, [wallpaperUrl])

  if (!ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3" style={{ background: 'var(--bg)' }}>
        {bootError ? (
          <>
            <div className="text-[13px]" style={{ color: 'var(--danger)' }}>启动失败：{bootError}</div>
            <button type="button" className="btn-pill primary" onClick={() => void useApp.getState().bootstrap()}>
              重试
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2 text-[13px] fg-2">
            <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: 'var(--accent)' }} />
            正在启动 DSH Desktop…
          </div>
        )}
      </div>
    )
  }

  const maskOpacity = wallpaperUrl ? (100 - (settings?.wallpaperOpacity ?? 40)) / 100 : 1

  return (
    <div className={`relative flex h-full flex-col ${immersive ? 'immersive' : ''}`}>
      {wallpaperUrl && (
        <>
          <div className="wallpaper-layer" style={{ backgroundImage: wallpaperUrl }} />
          <div className="wallpaper-mask" style={{ opacity: maskOpacity }} />
        </>
      )}
      <div className="wallpaper-content flex flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="app-page-bg min-w-0 flex-1" style={{ background: 'var(--bg)' }}>
            {page === 'chat' && <ChatPage />}
            {page === 'plugins' && <PluginsPage />}
            {page === 'themes' && <ThemesPage />}
            {page === 'terminal' && <TerminalPage />}
            {page === 'workspaces' && <WorkspacesPage />}
            {page === 'settings' && <SettingsPage />}
          </main>
        </div>
        <CommandPalette />
      </div>
    </div>
  )
}
