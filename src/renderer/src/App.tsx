/**
 * 应用壳：主题应用 + 布局（标题栏/侧边栏/页面区）+ 命令面板
 */
import { useEffect } from 'react'
import { useApp } from './stores/app'
import { applyThemeToDocument } from './lib/theme'
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
  const page = useApp((s) => s.page)
  const immersive = useApp((s) => s.immersive)
  const activeTheme = useApp((s) => s.activeTheme)
  const customCss = useApp((s) => s.customCss)

  useEffect(() => {
    void useApp.getState().bootstrap()
  }, [])

  // 主题实时应用（切换无闪烁）
  useEffect(() => {
    if (activeTheme) applyThemeToDocument(activeTheme, customCss)
  }, [activeTheme, customCss])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center gap-2 text-[13px] fg-2">
          <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: 'var(--accent)' }} />
          正在启动 DSH Desktop…
        </div>
      </div>
    )
  }

  return (
    <div className={`flex h-full flex-col ${immersive ? 'immersive' : ''}`}>
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1" style={{ background: 'var(--bg)' }}>
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
  )
}
