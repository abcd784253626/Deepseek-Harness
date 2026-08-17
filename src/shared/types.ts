/**
 * DSH Desktop — 主进程 / 渲染进程共享类型契约
 * 所有 IPC 载荷与状态模型的唯一事实来源。
 */

// ─── 应用与内核 ───────────────────────────────────────────────

export interface AppInfo {
  version: string
  electron: string
  platform: NodeJS.Platform
  arch: string
  /** 解析到的 dsh CLI 绝对路径（未找到为 null） */
  dshPath: string | null
  dshVersion: string | null
  /** pnpm 是否可用（dsh plugin 安装依赖它） */
  pnpmAvailable: boolean
  /** 生效中的 DSH_HOME */
  dshHome: string
  /** 系统 Node.js 版本（内核运行运行时） */
  nodeVersion: string | null
}

export type KernelStatus = 'stopped' | 'starting' | 'running' | 'restarting' | 'error'

export interface KernelState {
  status: KernelStatus
  /** 官方 Web UI 地址，如 http://127.0.0.1:53210 */
  url: string | null
  pid: number | null
  port: number | null
  workspaceId: string | null
  startedAt: number | null
  lastError: string | null
}

export type KernelLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface KernelLogLine {
  time: number
  level: KernelLogLevel
  text: string
}

// ─── 工作区 ───────────────────────────────────────────────────

export interface WorkspaceInfo {
  id: string
  name: string
  path: string
  /** 可选独立 DSH_HOME；空 = 使用全局默认（官方兼容） */
  dshHome: string
  createdAt: number
  lastUsedAt: number
}

// ─── 运行模式（对应官方 config/agent-presets） ─────────────────

export type AgentMode = 'standard' | 'code' | 'minimal' | 'cordis'

export interface AgentModeInfo {
  id: AgentMode
  name: string
  description: string
  order: number
}

// ─── 插件市场 ─────────────────────────────────────────────────

export type PluginCategory = 'model' | 'tool' | 'skill' | 'ui' | 'sandbox' | 'other'

export type RiskLevel = 'info' | 'warn' | 'danger'

export interface RiskFlag {
  kind: 'install-script' | 'no-license' | 'archived' | 'unknown-author' | 'unverified'
  level: RiskLevel
  message: string
}

export interface RegistryPlugin {
  /** npm 包名（安装目标） */
  name: string
  repo: string | null
  description: string
  stars: number
  updatedAt: number
  category: PluginCategory
  license: string | null
  homepage: string | null
  npmVersion: string | null
  riskFlags: RiskFlag[]
  archived: boolean
  source: 'github' | 'npm'
}

export interface InstalledPlugin {
  name: string
  version: string
  /** npm 包 / link 本地路径 */
  spec: string
  kind: 'npm' | 'link' | 'builtin'
  enabled: boolean
  installedAt: number
  category: PluginCategory
}

export interface PluginDetail {
  plugin: RegistryPlugin
  readme: string | null
  /** 历史版本（npm 视角，按时间倒序） */
  versions: string[]
}

export interface PluginOpResult {
  ok: boolean
  message: string
  /** 失败时的日志尾部 */
  logTail?: string[]
}

// ─── 皮肤主题 ─────────────────────────────────────────────────

export type ThemeType = 'light' | 'dark'

export interface ThemeTokens {
  /** 主背景 */
  bg: string
  /** 次级背景（侧栏、hover） */
  bgSubtle: string
  /** 浮层背景（命令面板、菜单） */
  bgElevated: string
  /** 主文本 */
  fg: string
  /** 次级文本 */
  fgSecondary: string
  /** 禁用文本 */
  fgDisabled: string
  /** 1px 分割线 */
  border: string
  /** 唯一强调色 */
  accent: string
  /** 强调色上的文本 */
  accentFg: string
  /** 危险态 */
  danger: string
  /** 成功态 */
  success: string
  /** 控件圆角（px） */
  radius: number
  /** 基准字号（px） */
  fontSize: number
  /** 字体栈 */
  fontFamily: string
}

export interface ThemeDefinition {
  id: string
  name: string
  type: ThemeType
  author: string
  description: string
  source: 'builtin' | 'user'
  tokens: ThemeTokens
  /** 用户自定义 CSS 注入（叠加在 token 之上） */
  customCss: string
}

// ─── 桌面设置 ─────────────────────────────────────────────────

export interface DesktopSettings {
  /** 跟随系统明暗 */
  followSystemTheme: boolean
  /** 当前主题 id（followSystemTheme=true 时表示明暗偏好主题） */
  themeId: string
  /** 启动时自动拉起内核 */
  autoStartKernel: boolean
  /** 关闭窗口最小化到托盘 */
  minimizeToTray: boolean
  /** 内核端口偏好（0 = 自动分配） */
  kernelPort: number
  /** dsh 可执行文件路径覆盖 */
  dshPathOverride: string
  /** DSH_HOME 覆盖（空 = 官方默认 ~/.dsh） */
  dshHomeOverride: string
  /** 上次使用的工作区 id */
  lastWorkspaceId: string
  /** 上次使用的运行模式 */
  lastMode: AgentMode
  /** 全局自定义 CSS 注入（叠加在主题之上） */
  customCss: string
  /** 壁纸图片路径（空 = 无壁纸） */
  wallpaperPath: string
  /** 壁纸不透明度 0-100 */
  wallpaperOpacity: number
  /** 开机自启 */
  openAtLogin: boolean
}

// ─── 凭据（API Key，经 safeStorage 加密） ──────────────────────

export interface CredentialEntry {
  key: string
  label: string
  /** 是否有已存值（明文不回传） */
  hasValue: boolean
  updatedAt: number
}

// ─── 终端 ─────────────────────────────────────────────────────

export interface TerminalSession {
  id: string
  label: string
  cwd: string
  startedAt: number
  exited: boolean
  exitCode: number | null
}

// ─── 壁纸 ────────────────────────────────────────────────────

export type ImageFormat = 'jpeg' | 'png' | 'gif' | 'bmp' | 'webp' | 'tiff' | 'ico'

export interface WallpaperInfo {
  path: string
  name: string
  sizeBytes: number
  modifiedAt: number
  format: ImageFormat
  width: number | null
  height: number | null
}

// ─── IPC 通道常量 ─────────────────────────────────────────────

export const IPC = {
  app: {
    info: 'app:info',
    quit: 'app:quit',
    minimize: 'app:minimize',
    maximizeToggle: 'app:maximize-toggle',
    isMaximized: 'app:is-maximized',
    openExternal: 'app:open-external',
    showItemInFolder: 'app:show-item-in-folder',
    pickDirectory: 'app:pick-directory',
    pickFile: 'app:pick-file',
    saveFile: 'app:save-file',
    setOpenAtLogin: 'app:set-open-at-login'
  },
  kernel: {
    start: 'kernel:start',
    stop: 'kernel:stop',
    restart: 'kernel:restart',
    state: 'kernel:state',
    logs: 'kernel:logs',
    onState: 'kernel:on-state',
    onLog: 'kernel:on-log'
  },
  workspace: {
    list: 'workspace:list',
    create: 'workspace:create',
    remove: 'workspace:remove',
    get: 'workspace:get',
    update: 'workspace:update',
    reveal: 'workspace:reveal'
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set'
  },
  mode: {
    list: 'mode:list',
    set: 'mode:set',
    get: 'mode:get'
  },
  credentials: {
    list: 'credentials:list',
    set: 'credentials:set',
    remove: 'credentials:remove'
  },
  plugins: {
    search: 'plugins:search',
    installed: 'plugins:installed',
    install: 'plugins:install',
    uninstall: 'plugins:uninstall',
    detail: 'plugins:detail',
    versions: 'plugins:versions',
    enable: 'plugins:enable',
    categories: 'plugins:categories',
    onOp: 'plugins:on-op'
  },
  themes: {
    list: 'themes:list',
    apply: 'themes:apply',
    save: 'themes:save',
    remove: 'themes:remove',
    export: 'themes:export',
    import: 'themes:import',
    getCss: 'themes:get-css',
    setCss: 'themes:set-css',
    systemTheme: 'themes:system-theme'
  },
  config: {
    export: 'config:export',
    import: 'config:import'
  },
  wallpaper: {
    search: 'wallpaper:search',
    set: 'wallpaper:set',
    get: 'wallpaper:get',
    clear: 'wallpaper:clear',
    opacity: 'wallpaper:opacity',
    onProgress: 'wallpaper:on-progress'
  },
  update: {
    check: 'update:check'
  },
  aliyun: {
    save: 'aliyun:save',
    test: 'aliyun:test',
    get: 'aliyun:get'
  },
  terminal: {
    run: 'terminal:run',
    kill: 'terminal:kill',
    onOutput: 'terminal:on-output',
    onExit: 'terminal:on-exit'
  }
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC][keyof (typeof IPC)[keyof typeof IPC]]
