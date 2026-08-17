/**
 * 渲染进程桥 — contextBridge
 * 暴露类型安全的 window.dsh API；渲染进程零 Node 能力（sandbox: true）。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type {
  AgentMode,
  AgentModeInfo,
  AppInfo,
  CredentialEntry,
  DesktopSettings,
  InstalledPlugin,
  KernelLogLine,
  KernelState,
  PluginCategory,
  PluginDetail,
  PluginOpResult,
  RegistryPlugin,
  TerminalSession,
  ThemeDefinition,
  WallpaperInfo,
  WorkspaceInfo
} from '@shared/types'

const send = (channel: string, ...args: unknown[]): Promise<unknown> =>
  ipcRenderer.invoke(channel, ...args)

const api = {
  app: {
    info: (): Promise<AppInfo> => send(IPC.app.info) as Promise<AppInfo>,
    quit: (): Promise<void> => send(IPC.app.quit) as Promise<void>,
    minimize: (): Promise<void> => send(IPC.app.minimize) as Promise<void>,
    maximizeToggle: (): Promise<void> => send(IPC.app.maximizeToggle) as Promise<void>,
    isMaximized: (): Promise<boolean> => send(IPC.app.isMaximized) as Promise<boolean>,
    openExternal: (url: string): Promise<void> => send(IPC.app.openExternal, url) as Promise<void>,
    showItemInFolder: (path: string): Promise<void> => send(IPC.app.showItemInFolder, path) as Promise<void>,
    pickDirectory: (): Promise<string | null> => send(IPC.app.pickDirectory) as Promise<string | null>,
    pickFile: (filters?: { name: string; extensions: string[] }[]): Promise<string | null> =>
      send(IPC.app.pickFile, filters) as Promise<string | null>,
    saveFile: (opts: { defaultName: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> =>
      send(IPC.app.saveFile, opts) as Promise<string | null>,
    setOpenAtLogin: (enabled: boolean): Promise<boolean> =>
      send(IPC.app.setOpenAtLogin, enabled) as Promise<boolean>,
    onMaximized: (cb: (max: boolean) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, max: boolean): void => cb(max)
      ipcRenderer.on('window:maximized', listener)
      return () => ipcRenderer.removeListener('window:maximized', listener)
    }
  },
  kernel: {
    start: (workspaceId: string | null): Promise<KernelState> =>
      send(IPC.kernel.start, workspaceId) as Promise<KernelState>,
    stop: (): Promise<KernelState> => send(IPC.kernel.stop) as Promise<KernelState>,
    restart: (workspaceId: string | null): Promise<KernelState> =>
      send(IPC.kernel.restart, workspaceId) as Promise<KernelState>,
    state: (): Promise<KernelState> => send(IPC.kernel.state) as Promise<KernelState>,
    logs: (): Promise<KernelLogLine[]> => send(IPC.kernel.logs) as Promise<KernelLogLine[]>,
    onState: (cb: (s: KernelState) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, s: KernelState): void => cb(s)
      ipcRenderer.on(IPC.kernel.onState, listener)
      return () => ipcRenderer.removeListener(IPC.kernel.onState, listener)
    },
    onLog: (cb: (l: KernelLogLine) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, l: KernelLogLine): void => cb(l)
      ipcRenderer.on(IPC.kernel.onLog, listener)
      return () => ipcRenderer.removeListener(IPC.kernel.onLog, listener)
    }
  },
  workspace: {
    list: (): Promise<WorkspaceInfo[]> => send(IPC.workspace.list) as Promise<WorkspaceInfo[]>,
    get: (id: string): Promise<WorkspaceInfo | null> => send(IPC.workspace.get, id) as Promise<WorkspaceInfo | null>,
    create: (info: { name: string; path: string; dshHome?: string }): Promise<WorkspaceInfo> =>
      send(IPC.workspace.create, info) as Promise<WorkspaceInfo>,
    remove: (id: string): Promise<void> => send(IPC.workspace.remove, id) as Promise<void>,
    update: (id: string, patch: Partial<Pick<WorkspaceInfo, 'name' | 'path' | 'dshHome'>>): Promise<WorkspaceInfo | null> =>
      send(IPC.workspace.update, id, patch) as Promise<WorkspaceInfo | null>,
    reveal: (id: string): Promise<void> => send(IPC.workspace.reveal, id) as Promise<void>
  },
  settings: {
    get: (): Promise<DesktopSettings> => send(IPC.settings.get) as Promise<DesktopSettings>,
    set: (patch: Partial<DesktopSettings>): Promise<DesktopSettings> => send(IPC.settings.set, patch) as Promise<DesktopSettings>
  },
  mode: {
    list: (): Promise<AgentModeInfo[]> => send(IPC.mode.list) as Promise<AgentModeInfo[]>,
    get: (): Promise<AgentModeInfo> => send(IPC.mode.get) as Promise<AgentModeInfo>,
    set: (id: AgentMode): Promise<AgentModeInfo> => send(IPC.mode.set, id) as Promise<AgentModeInfo>
  },
  credentials: {
    list: (): Promise<CredentialEntry[]> => send(IPC.credentials.list) as Promise<CredentialEntry[]>,
    set: (key: string, label: string, value: string): Promise<CredentialEntry> =>
      send(IPC.credentials.set, key, label, value) as Promise<CredentialEntry>,
    remove: (key: string): Promise<void> => send(IPC.credentials.remove, key) as Promise<void>
  },
  plugins: {
    search: (query: string): Promise<RegistryPlugin[]> => send(IPC.plugins.search, query) as Promise<RegistryPlugin[]>,
    installed: (): Promise<InstalledPlugin[]> => send(IPC.plugins.installed) as Promise<InstalledPlugin[]>,
    install: (spec: string): Promise<PluginOpResult> => send(IPC.plugins.install, spec) as Promise<PluginOpResult>,
    uninstall: (name: string): Promise<PluginOpResult> => send(IPC.plugins.uninstall, name) as Promise<PluginOpResult>,
    detail: (name: string): Promise<PluginDetail> => send(IPC.plugins.detail, name) as Promise<PluginDetail>,
    versions: (name: string): Promise<string[]> => send(IPC.plugins.versions, name) as Promise<string[]>,
    enable: (name: string, enabled: boolean): Promise<PluginOpResult> => send(IPC.plugins.enable, name, enabled) as Promise<PluginOpResult>,
    categories: (): Promise<Record<string, string>> => send(IPC.plugins.categories) as Promise<Record<string, string>>,
    onOp: (cb: (op: { phase: string; name: string; status: string }) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, op: { phase: string; name: string; status: string }): void => cb(op)
      ipcRenderer.on(IPC.plugins.onOp, listener)
      return () => ipcRenderer.removeListener(IPC.plugins.onOp, listener)
    }
  },
  themes: {
    list: (): Promise<ThemeDefinition[]> => send(IPC.themes.list) as Promise<ThemeDefinition[]>,
    apply: (id: string): Promise<ThemeDefinition | null> => send(IPC.themes.apply, id) as Promise<ThemeDefinition | null>,
    save: (theme: ThemeDefinition): Promise<ThemeDefinition> => send(IPC.themes.save, theme) as Promise<ThemeDefinition>,
    remove: (id: string): Promise<boolean> => send(IPC.themes.remove, id) as Promise<boolean>,
    export: (id: string): Promise<string | null> => send(IPC.themes.export, id) as Promise<string | null>,
    import: (): Promise<ThemeDefinition | null | { error: string }> => send(IPC.themes.import) as Promise<ThemeDefinition | null | { error: string }>,
    getCss: (): Promise<string> => send(IPC.themes.getCss) as Promise<string>,
    setCss: (css: string): Promise<void> => send(IPC.themes.setCss, css) as Promise<void>,
    systemTheme: (): Promise<'light' | 'dark'> => send(IPC.themes.systemTheme) as Promise<'light' | 'dark'>
  },
  config: {
    export: (): Promise<string | null> => send(IPC.config.export) as Promise<string | null>,
    import: (): Promise<{ file: string; backup: string } | null> => send(IPC.config.import) as Promise<{ file: string; backup: string } | null>
  },
  wallpaper: {
    search: (roots?: string[]): Promise<WallpaperInfo[]> => send(IPC.wallpaper.search, roots) as Promise<WallpaperInfo[]>,
    set: (path: string): Promise<string> => send(IPC.wallpaper.set, path) as Promise<string>,
    get: (): Promise<string> => send(IPC.wallpaper.get) as Promise<string>,
    clear: (): Promise<DesktopSettings> => send(IPC.wallpaper.clear) as Promise<DesktopSettings>,
    opacity: (opacity: number): Promise<number> => send(IPC.wallpaper.opacity, opacity) as Promise<number>,
    onProgress: (cb: (p: { scanned: number; found: number; currentDir: string; counts: Record<string, number> }) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, p: { scanned: number; found: number; currentDir: string; counts: Record<string, number> }): void => cb(p)
      ipcRenderer.on(IPC.wallpaper.onProgress, listener)
      return () => ipcRenderer.removeListener(IPC.wallpaper.onProgress, listener)
    }
  },
  update: {
    check: (): Promise<{ local: string | null; latest: string | null; outdated: boolean; publishedAt: string | null; error: string | null }> =>
      send(IPC.update.check) as Promise<{ local: string | null; latest: string | null; outdated: boolean; publishedAt: string | null; error: string | null }>
  },
  terminal: {
    run: (args: string[], cwd: string): Promise<TerminalSession> => send(IPC.terminal.run, args, cwd) as Promise<TerminalSession>,
    kill: (id: string): Promise<boolean> => send(IPC.terminal.kill, id) as Promise<boolean>,
    onOutput: (cb: (o: { sessionId: string; time: number; text: string }) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, o: { sessionId: string; time: number; text: string }): void => cb(o)
      ipcRenderer.on(IPC.terminal.onOutput, listener)
      return () => ipcRenderer.removeListener(IPC.terminal.onOutput, listener)
    },
    onExit: (cb: (o: { sessionId: string; exitCode: number | null }) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, o: { sessionId: string; exitCode: number | null }): void => cb(o)
      ipcRenderer.on(IPC.terminal.onExit, listener)
      return () => ipcRenderer.removeListener(IPC.terminal.onExit, listener)
    }
  }
}

export type DshApi = typeof api

contextBridge.exposeInMainWorld('dsh', api)
