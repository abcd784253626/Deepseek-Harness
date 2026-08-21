/**
 * IPC 处理器注册
 * 所有渲染进程请求在此鉴权、校验后落到主进程服务。
 */
import { app, ipcMain, shell, dialog, safeStorage, nativeTheme } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { IPC } from '@shared/types'
import type { AgentMode, DesktopSettings, WorkspaceInfo } from '@shared/types'
import {
  getSettings,
  patchSettings,
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  removeWorkspace,
  touchWorkspace
} from './store/database'
import {
  listCredentials,
  setCredential as dbSetCredential,
  removeCredential as dbRemoveCredential
} from './security'
import { kernelManager } from './kernel/manager'
import { AGENT_MODES, modeInfo } from './kernel/presets'
import { resolveDsh, pnpmAvailable, appVersion, systemNodeVersion } from './kernel/resolver'
import { pluginManager } from './plugins/manager'
import { searchMarket, fetchNpmMeta, riskOf } from './plugins/registry'
import {
  allThemes,
  getThemeSafe,
  applyTheme,
  saveUserTheme,
  removeUserTheme,
  exportTheme,
  importThemeFile,
  getCustomCss,
  setCustomCss
} from './themes/manager'
import { terminalRunner } from './terminal/runner'
import { getMainWindow, toggleMaximize, minimizeWindow, requestClose, isMaximized } from './window'
import { homedir } from 'node:os'
import { scanForImages, listLocalDrives, defaultImageDirs } from './wallpaper/scanner'
import { invalidateImageAllowlist } from './wallpaper/protocol'
import { checkDshUpdate } from './updates'
import { writeUiThemePreference } from './theme-sync'
import { getSettings as getSettingsStore } from './store/database'
import { usageTracker } from './usage/tracker'

export function registerIpc(): void {
  const wc = (): Electron.WebContents | null => getMainWindow()?.webContents ?? null

  // ─── 应用 ────────────────────────────────────────────────
  ipcMain.handle(IPC.app.info, () => {
    const settings = getSettings()
    const binary = resolveDsh(settings.dshPathOverride)
    return {
      version: appVersion(),
      electron: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      dshPath: binary?.path ?? null,
      dshVersion: binary?.version ?? null,
      pnpmAvailable: pnpmAvailable(),
      dshHome: settings.dshHomeOverride || join(homedir(), '.dsh'),
      nodeVersion: systemNodeVersion()
    }
  })

  ipcMain.handle(IPC.app.quit, () => {
    void kernelManager.stop(true).then(() => app.quit())
  })
  ipcMain.handle(IPC.app.minimize, () => minimizeWindow())
  ipcMain.handle(IPC.app.maximizeToggle, () => toggleMaximize())
  ipcMain.handle(IPC.app.isMaximized, () => isMaximized())
  ipcMain.handle(IPC.app.openExternal, (_e, url: string) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  })
  ipcMain.handle(IPC.app.showItemInFolder, (_e, path: string) => {
    if (existsSync(path)) shell.showItemInFolder(path)
  })
  ipcMain.handle(IPC.app.pickDirectory, async () => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: '选择目录'
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle(IPC.app.pickFile, async (_e, filters?: { name: string; extensions: string[] }[]) => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters,
      title: '选择文件'
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle(IPC.app.saveFile, async (_e, opts: { defaultName: string; filters?: { name: string; extensions: string[] }[] }) => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showSaveDialog(win, {
      defaultPath: opts.defaultName,
      filters: opts.filters,
      title: '保存文件'
    })
    return result.canceled ? null : result.filePath
  })

  // ─── 内核 ────────────────────────────────────────────────
  ipcMain.handle(IPC.kernel.start, (_e, workspaceId: string | null) =>
    kernelManager.start(workspaceId)
  )
  ipcMain.handle(IPC.kernel.stop, () => kernelManager.stop())
  ipcMain.handle(IPC.kernel.restart, (_e, workspaceId: string | null) =>
    kernelManager.restart(workspaceId)
  )
  ipcMain.handle(IPC.kernel.state, () => kernelManager.getState())
  ipcMain.handle(IPC.kernel.logs, () => kernelManager.getLogs())

  kernelManager.on('state', (state) => wc()?.send(IPC.kernel.onState, state))
  kernelManager.on('log', (line) => wc()?.send(IPC.kernel.onLog, line))

  // ─── 工作区 ──────────────────────────────────────────────
  ipcMain.handle(IPC.workspace.list, () => listWorkspaces())
  ipcMain.handle(IPC.workspace.get, (_e, id: string) => getWorkspace(id))
  ipcMain.handle(IPC.workspace.create, (_e, info: { name: string; path: string; dshHome?: string }) => {
    if (!info.name?.trim() || !info.path?.trim()) throw new Error('工作区名称与路径不能为空')
    if (!/^[a-zA-Z]:[\\/]/.test(info.path)) throw new Error('工作区路径必须是绝对路径')
    if (info.dshHome && !/^[a-zA-Z]:[\\/]/.test(info.dshHome)) throw new Error('DSH_HOME 必须是绝对路径')
    if (!existsSync(info.path)) mkdirSync(info.path, { recursive: true })
    const row: WorkspaceInfo = {
      id: randomUUID(),
      name: info.name.trim(),
      path: info.path,
      dshHome: info.dshHome ?? '',
      createdAt: 0,
      lastUsedAt: 0
    }
    return createWorkspace(row)
  })
  ipcMain.handle(IPC.workspace.remove, (_e, id: string) => {
    removeWorkspace(id)
    const settings = getSettings()
    if (settings.lastWorkspaceId === id) patchSettings({ lastWorkspaceId: '' })
  })
  ipcMain.handle(IPC.workspace.update, (_e, id: string, patch: Partial<Pick<WorkspaceInfo, 'name' | 'path' | 'dshHome'>>) =>
    updateWorkspace(id, patch)
  )
  ipcMain.handle(IPC.workspace.reveal, (_e, id: string) => {
    const ws = getWorkspace(id)
    if (ws && existsSync(ws.path)) shell.showItemInFolder(ws.path)
  })

  // ─── 设置 ────────────────────────────────────────────────
  // 键名白名单：只允许 DesktopSettings 的已知字段，杜绝任意键写入
  const SETTINGS_KEYS = new Set([
    'followSystemTheme', 'themeId', 'autoStartKernel', 'minimizeToTray', 'kernelPort',
    'dshPathOverride', 'dshHomeOverride', 'lastWorkspaceId', 'lastMode', 'customCss',
    'wallpaperPath', 'wallpaperOpacity', 'wallpaperTextColor', 'openAtLogin',
    'usagePriceInput', 'usagePriceCache', 'usagePriceOutput'
  ])
  ipcMain.handle(IPC.settings.get, () => getSettings())
  ipcMain.handle(IPC.settings.set, (_e, patch: Partial<DesktopSettings>) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('无效的设置载荷')
    // 原型必须是纯净 Object.prototype（防 __proto__ 经反序列化变成原型设置）
    if (Object.getPrototypeOf(patch) !== Object.prototype) throw new Error('非法载荷原型')
    for (const key of Reflect.ownKeys(patch)) {
      // 显式拒绝原型相关键（含自有 "__proto__" 键场景）
      if (typeof key !== 'string' || key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error('非法设置键')
      }
      if (!SETTINGS_KEYS.has(key)) throw new Error(`未知设置键: ${key}`)
    }
    return patchSettings(patch)
  })

  // ─── 运行模式 ────────────────────────────────────────────
  ipcMain.handle(IPC.mode.list, () => AGENT_MODES)
  ipcMain.handle(IPC.mode.get, () => modeInfo(getSettings().lastMode))
  ipcMain.handle(IPC.mode.set, (_e, id: AgentMode) => {
    if (!AGENT_MODES.some((m) => m.id === id)) throw new Error(`未知运行模式: ${String(id)}`)
    const info = modeInfo(id)
    patchSettings({ lastMode: id })
    return info
  })

  // ─── 凭据 ────────────────────────────────────────────────
  // 键名仅允许环境变量形式，且拒绝可篡改运行环境的危险键
  const CRED_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
  const FORBIDDEN_CRED_KEYS = new Set([
    'PATH', 'PATHEXT', 'COMSPEC', 'HOME', 'USERPROFILE', 'TMP', 'TEMP', 'TMPDIR',
    'NODE_OPTIONS', 'NODE_PATH', 'DSH_HOME', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES',
    'ELECTRON_RUN_AS_NODE', 'FORCE_COLOR', 'NO_COLOR'
  ])
  ipcMain.handle(IPC.credentials.list, () => listCredentials())
  ipcMain.handle(IPC.credentials.set, (_e, key: string, label: string, value: string) => {
    const trimmed = String(key ?? '').trim()
    if (!CRED_KEY_RE.test(trimmed)) throw new Error('凭据键名必须为环境变量形式（字母/数字/下划线）')
    if (FORBIDDEN_CRED_KEYS.has(trimmed.toUpperCase())) throw new Error(`键名 ${trimmed} 被禁止（可能篡改运行环境）`)
    if (!value) throw new Error('凭据值不能为空')
    return dbSetCredential(trimmed, label || trimmed, value)
  })
  ipcMain.handle(IPC.credentials.remove, (_e, key: string) => dbRemoveCredential(key))

  // ─── 插件 ────────────────────────────────────────────────
  // 参数白名单：npm 包名（含 scope/版本）或 link: 绝对路径；拒绝 shell 元字符与选项注入
  const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(?:@[0-9A-Za-z][0-9A-Za-z._-]*)?$/
  const SHELL_META_RE = /[&|;`$()<>%^"']/
  const validatePluginName = (name: string): string => {
    const trimmed = String(name ?? '').trim()
    if (!NPM_NAME_RE.test(trimmed) || SHELL_META_RE.test(trimmed)) {
      throw new Error('非法的插件名（仅允许 npm 包名格式）')
    }
    return trimmed
  }
  const validatePluginSpec = (spec: string): string => {
    const trimmed = String(spec ?? '').trim()
    if (trimmed.startsWith('link:')) {
      const target = trimmed.slice(5)
      if (!target || SHELL_META_RE.test(target) || !/^[a-zA-Z]:[\\/]/.test(target)) {
        throw new Error('非法的本地插件路径')
      }
      return trimmed
    }
    return validatePluginName(trimmed)
  }
  ipcMain.handle(IPC.plugins.search, (_e, query: string) => searchMarket(String(query ?? '').slice(0, 100)))
  ipcMain.handle(IPC.plugins.installed, () => pluginManager.syncInstalled())
  ipcMain.handle(IPC.plugins.install, async (_e, spec: string) => {
    const safeSpec = validatePluginSpec(spec)
    const result = await pluginManager.install(safeSpec)
    if (result.ok) {
      // 装完自动重启内核使插件树生效（串行化由 kernelManager 内部保证）
      const current = kernelManager.getState().workspaceId
      void kernelManager.restart(current)
    }
    return result
  })
  ipcMain.handle(IPC.plugins.uninstall, async (_e, name: string) => {
    const safeName = validatePluginName(name)
    const result = await pluginManager.uninstall(safeName)
    if (result.ok) {
      const current = kernelManager.getState().workspaceId
      void kernelManager.restart(current)
    }
    return result
  })
  ipcMain.handle(IPC.plugins.detail, async (_e, name: string) => {
    const safeName = validatePluginName(name)
    const meta = await fetchNpmMeta(safeName)
    if (!meta) return { plugin: null, readme: null, versions: [] }
    const plugin = {
      name: meta.name,
      repo: typeof meta.repository === 'string' ? meta.repository : meta.repository?.url ?? null,
      description: meta.description,
      stars: 0,
      updatedAt: Date.now(),
      category: 'other' as const,
      license: meta.license,
      homepage: meta.homepage ?? null,
      npmVersion: meta.version,
      riskFlags: riskOf({ scripts: meta.scripts, license: meta.license, author: meta.author }, true),
      archived: false,
      source: 'npm' as const
    }
    return { plugin, readme: meta.readme ?? null, versions: meta.versions }
  })
  ipcMain.handle(IPC.plugins.versions, (_e, name: string) => pluginManager.availableVersions(validatePluginName(name)))
  ipcMain.handle(IPC.plugins.enable, async (_e, name: string, enabled: boolean) => {
    const safeName = validatePluginName(name)
    const result = await pluginManager.enable(safeName, Boolean(enabled))
    if (result.ok) {
      const current = kernelManager.getState().workspaceId
      void kernelManager.restart(current)
    }
    return result
  })
  ipcMain.handle(IPC.plugins.categories, () => ({
    all: '全部',
    model: '模型',
    tool: '工具',
    skill: '技能',
    ui: '界面',
    sandbox: '沙箱',
    other: '其他'
  }))

  pluginManager.on('op', (op) => wc()?.send(IPC.plugins.onOp, op))

  // ─── 主题 ────────────────────────────────────────────────
  ipcMain.handle(IPC.themes.list, () => allThemes())
  ipcMain.handle(IPC.themes.apply, (_e, id: string) => {
    const theme = applyTheme(id)
    if (theme) writeUiThemePreference(theme.type) // 官方 UI 明暗与桌面主题统一
    return theme
  })
  ipcMain.handle(IPC.themes.save, (_e, theme) => saveUserTheme(theme))
  ipcMain.handle(IPC.themes.remove, (_e, id: string) => removeUserTheme(id))
  ipcMain.handle(IPC.themes.export, async (_e, id: string) => {
    const win = getMainWindow()
    if (!win) return null
    const theme = getThemeSafe(id)
    if (!theme) return null
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${theme.name}.dsh-theme`,
      filters: [{ name: 'DSH 主题', extensions: ['dsh-theme'] }]
    })
    if (result.canceled || !result.filePath) return null
    return exportTheme(id, result.filePath) ? result.filePath : null
  })
  ipcMain.handle(IPC.themes.import, async () => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'DSH 主题', extensions: ['dsh-theme'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    try {
      return importThemeFile(result.filePaths[0])
    } catch (err) {
      return { error: (err as Error).message }
    }
  })
  ipcMain.handle(IPC.themes.getCss, () => getCustomCss())
  ipcMain.handle(IPC.themes.setCss, (_e, css: string) => setCustomCss(css))
  ipcMain.handle(IPC.themes.systemTheme, () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'))

  // ─── 配置导入导出（官方 settings.yaml 互通） ─────────────
  ipcMain.handle(IPC.config.export, async () => {
    const win = getMainWindow()
    if (!win) return null
    const settings = getSettings()
    const home = settings.dshHomeOverride || join(homedir(), '.dsh')
    const src = join(home, 'settings.yaml')
    if (!existsSync(src)) return null
    const result = await dialog.showSaveDialog(win, {
      defaultPath: 'dsh-settings.yaml',
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }]
    })
    if (result.canceled || !result.filePath) return null
    const { copyFileSync } = require('node:fs') as typeof import('node:fs')
    copyFileSync(src, result.filePath)
    return result.filePath
  })
  ipcMain.handle(IPC.config.import, async () => {
    const win = getMainWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'YAML', extensions: ['yaml', 'yml'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const { copyFileSync, readFileSync } = require('node:fs') as typeof import('node:fs')
    // 导入前结构校验：必须是对象根，拒绝明显异常结构
    try {
      const yamlLib = require('js-yaml') as typeof import('js-yaml')
      const parsed = yamlLib.load(readFileSync(result.filePaths[0], 'utf-8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('配置文件根必须是对象')
      }
    } catch (err) {
      throw new Error(`导入失败（配置结构非法）: ${(err as Error).message}`)
    }
    const settings = getSettings()
    const home = settings.dshHomeOverride || join(homedir(), '.dsh')
    mkdirSync(home, { recursive: true })
    const backup = `${join(home, 'settings.yaml')}.bak-${Date.now()}`
    if (existsSync(join(home, 'settings.yaml'))) copyFileSync(join(home, 'settings.yaml'), backup)
    copyFileSync(result.filePaths[0], join(home, 'settings.yaml'))
    return { file: result.filePaths[0], backup }
  })

  // ─── 壁纸 ────────────────────────────────────────────────
  ipcMain.handle(IPC.wallpaper.search, async (_e, roots?: string[]) => {
    // 未指定目录时扫描全部本地固定盘（图片/桌面/下载等目录都在其中）
    const effective = roots?.length ? roots : await listLocalDrives()
    const result = await scanForImages(
      { roots: effective },
      (progress) => wc()?.send(IPC.wallpaper.onProgress, progress)
    )
    return result
  })
  ipcMain.handle(IPC.wallpaper.set, (_e, path: string) => {
    const { statSync } = require('node:fs') as typeof import('node:fs')
    if (!path || typeof path !== 'string' || !statSync(path).isFile()) throw new Error('无效的图片路径')
    patchSettings({ wallpaperPath: path })
    invalidateImageAllowlist() // 壁纸路径变化 → 协议白名单失效重算
    return getSettingsStore().wallpaperPath
  })
  ipcMain.handle(IPC.wallpaper.get, () => getSettings().wallpaperPath)
  ipcMain.handle(IPC.wallpaper.clear, () => patchSettings({ wallpaperPath: '' }))
  ipcMain.handle(IPC.wallpaper.opacity, (_e, opacity: number) => {
    const clamped = Math.max(0, Math.min(100, Number(opacity) || 0))
    patchSettings({ wallpaperOpacity: clamped })
    return clamped
  })

  // ─── 用量统计 ────────────────────────────────────────────
  ipcMain.handle(IPC.usage.get, () => usageTracker.summary())
  usageTracker.on('update', (summary) => wc()?.send(IPC.usage.onUpdate, summary))

  // ─── 官方版本更新检查 ────────────────────────────────────
  ipcMain.handle(IPC.update.check, () => {
    const settings = getSettings()
    const binary = resolveDsh(settings.dshPathOverride)
    return checkDshUpdate(binary?.version ?? null)
  })

  // ─── 开机自启 ────────────────────────────────────────────
  ipcMain.handle(IPC.app.setOpenAtLogin, (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
    patchSettings({ openAtLogin: enabled })
    return enabled
  })

  // ─── 终端 ────────────────────────────────────────────────
  ipcMain.handle(IPC.terminal.run, (_e, args: string[], cwd: string) => {
    const id = randomUUID()
    return terminalRunner.run(id, args.join(' '), args, cwd)
  })
  ipcMain.handle(IPC.terminal.kill, (_e, id: string) => terminalRunner.kill(id))
  terminalRunner.on('output', (o) => wc()?.send(IPC.terminal.onOutput, o))
  terminalRunner.on('exit', (o) => wc()?.send(IPC.terminal.onExit, o))

  // safeStorage 可用性（Windows 恒可用）
  void safeStorage
}
