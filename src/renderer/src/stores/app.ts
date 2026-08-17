/**
 * 全局应用状态（Zustand）
 * 页面导航、设置、主题、内核状态、工作区。
 */
import { create } from 'zustand'
import type {
  AgentModeInfo,
  AppInfo,
  DesktopSettings,
  KernelState,
  ThemeDefinition,
  WorkspaceInfo
} from '@shared/types'

export type Page = 'chat' | 'plugins' | 'themes' | 'settings' | 'workspaces' | 'terminal'

interface AppState {
  ready: boolean
  bootError: string | null
  appInfo: AppInfo | null
  settings: DesktopSettings | null
  themes: ThemeDefinition[]
  activeTheme: ThemeDefinition | null
  customCss: string
  kernel: KernelState | null
  workspaces: WorkspaceInfo[]
  activeWorkspaceId: string | null
  modes: AgentModeInfo[]
  page: Page
  immersive: boolean
  commandPaletteOpen: boolean

  bootstrap: () => Promise<void>
  setPage: (p: Page) => void
  toggleImmersive: () => void
  setCommandPalette: (open: boolean) => void
  refreshThemes: () => Promise<void>
  applyThemeById: (id: string) => Promise<void>
  refreshKernel: () => Promise<void>
  refreshWorkspaces: () => Promise<void>
  setActiveWorkspace: (id: string | null) => Promise<void>
  saveSettings: (patch: Partial<DesktopSettings>) => Promise<void>
  setCustomCss: (css: string) => Promise<void>
}

/** 跟随系统时：取与系统明暗一致的已存主题，否则回退主题 id */
function resolveActive(
  themes: ThemeDefinition[],
  settings: DesktopSettings,
  system: 'light' | 'dark'
): ThemeDefinition {
  const list = themes.length ? themes : []
  const byType = list.filter((t) => t.type === system)
  const preferred = list.find((t) => t.id === settings.themeId)
  if (!settings.followSystemTheme && preferred) return preferred
  if (preferred?.type === system) return preferred
  const fallback = byType[0] ?? list[0]
  if (fallback) return fallback
  throw new Error('无可用主题')
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  bootError: null,
  appInfo: null,
  settings: null,
  themes: [],
  activeTheme: null,
  customCss: '',
  kernel: null,
  workspaces: [],
  activeWorkspaceId: null,
  modes: [],
  page: 'chat',
  immersive: false,
  commandPaletteOpen: false,

  bootstrap: async () => {
    try {
      const [appInfo, settings, themes, kernel, workspaces, modes, systemTheme, customCss] =
        await Promise.all([
          window.dsh.app.info(),
          window.dsh.settings.get(),
          window.dsh.themes.list(),
          window.dsh.kernel.state(),
          window.dsh.workspace.list(),
          window.dsh.mode.list(),
          window.dsh.themes.systemTheme(),
          window.dsh.themes.getCss()
        ])
      const activeTheme = resolveActive(themes, settings, systemTheme)
      const activeWorkspaceId =
        settings.lastWorkspaceId && workspaces.some((w) => w.id === settings.lastWorkspaceId)
          ? settings.lastWorkspaceId
          : workspaces[0]?.id ?? null
      set({
        ready: true,
        bootError: null,
        appInfo,
        settings,
        themes,
        activeTheme,
        customCss,
        kernel,
        workspaces,
        activeWorkspaceId,
        modes
      })
    } catch (err) {
      set({ bootError: (err as Error).message })
      return
    }
    // 内核状态订阅
    window.dsh.kernel.onState((s) => set({ kernel: s }))
    void get().refreshKernel()
  },

  setPage: (page) => set({ page, commandPaletteOpen: false }),
  toggleImmersive: () => set((s) => ({ immersive: !s.immersive })),
  setCommandPalette: (commandPaletteOpen) => set({ commandPaletteOpen }),

  refreshThemes: async () => {
    const themes = await window.dsh.themes.list()
    const settings = get().settings
    const system = await window.dsh.themes.systemTheme()
    set({ themes })
    if (settings) set({ activeTheme: resolveActive(themes, settings, system) })
  },

  applyThemeById: async (id) => {
    const theme = await window.dsh.themes.apply(id)
    const settings = get().settings
    if (theme && settings) {
      await window.dsh.settings.set({ themeId: id, followSystemTheme: false })
      set({ activeTheme: theme, settings: { ...settings, themeId: id, followSystemTheme: false } })
    }
  },

  refreshKernel: async () => {
    const kernel = await window.dsh.kernel.state()
    set({ kernel })
  },

  refreshWorkspaces: async () => {
    const workspaces = await window.dsh.workspace.list()
    set((s) => ({
      workspaces,
      activeWorkspaceId:
        s.activeWorkspaceId && workspaces.some((w) => w.id === s.activeWorkspaceId)
          ? s.activeWorkspaceId
          : workspaces[0]?.id ?? null
    }))
  },

  setActiveWorkspace: async (id) => {
    if (!id) return
    await window.dsh.settings.set({ lastWorkspaceId: id })
    const settings = get().settings
    set({ activeWorkspaceId: id, settings: settings ? { ...settings, lastWorkspaceId: id } : settings })
    // 切换工作区后重启内核（不同 cwd / DSH_HOME）
    await window.dsh.kernel.restart(id)
  },

  saveSettings: async (patch) => {
    const settings = await window.dsh.settings.set(patch)
    set({ settings })
  },

  setCustomCss: async (css) => {
    await window.dsh.themes.setCss(css)
    set({ customCss: css })
  }
}))
