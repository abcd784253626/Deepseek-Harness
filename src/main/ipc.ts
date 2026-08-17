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
  ipcMain.handle(IPC.settings.get, () => getSettings())
  ipcMain.handle(IPC.settings.set, (_e, patch: Partial<DesktopSettings>) => patchSettings(patch))

  // ─── 运行模式 ────────────────────────────────────────────
  ipcMain.handle(IPC.mode.list, () => AGENT_MODES)
  ipcMain.handle(IPC.mode.get, () => modeInfo(getSettings().lastMode))
  ipcMain.handle(IPC.mode.set, (_e, id: AgentMode) => {
    const info = modeInfo(id)
    patchSettings({ lastMode: id })
    return info
  })

  // ─── 凭据 ────────────────────────────────────────────────
  ipcMain.handle(IPC.credentials.list, () => listCredentials())
  ipcMain.handle(IPC.credentials.set, (_e, key: string, label: string, value: string) => {
    if (!key?.trim() || !value) throw new Error('键与值不能为空')
    return dbSetCredential(key.trim(), label || key, value)
  })
  ipcMain.handle(IPC.credentials.remove, (_e, key: string) => dbRemoveCredential(key))

  // ─── 插件 ────────────────────────────────────────────────
  ipcMain.handle(IPC.plugins.search, (_e, query: string) => searchMarket(query))
  ipcMain.handle(IPC.plugins.installed, () => pluginManager.syncInstalled())
  ipcMain.handle(IPC.plugins.install, async (_e, spec: string) => {
    const result = await pluginManager.install(spec)
    if (result.ok) {
      // 装完自动重启内核使插件树生效
      const settings = getSettings()
      void kernelManager.restart(settings.lastWorkspaceId || null)
    }
    return result
  })
  ipcMain.handle(IPC.plugins.uninstall, async (_e, name: string) => {
    const result = await pluginManager.uninstall(name)
    if (result.ok) {
      const settings = getSettings()
      void kernelManager.restart(settings.lastWorkspaceId || null)
    }
    return result
  })
  ipcMain.handle(IPC.plugins.detail, async (_e, name: string) => {
    const meta = await fetchNpmMeta(name)
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
      riskFlags: riskOf({ scripts: meta.scripts, license: meta.license, author: meta.author }),
      archived: false,
      source: 'npm' as const
    }
    return { plugin, readme: meta.readme ?? null, versions: meta.versions }
  })
  ipcMain.handle(IPC.plugins.versions, (_e, name: string) => pluginManager.availableVersions(name))
  ipcMain.handle(IPC.plugins.enable, (_e, name: string, enabled: boolean) => pluginManager.enable(name, enabled))
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
  ipcMain.handle(IPC.themes.apply, (_e, id: string) => applyTheme(id))
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
    const { copyFileSync } = require('node:fs') as typeof import('node:fs')
    const settings = getSettings()
    const home = settings.dshHomeOverride || join(homedir(), '.dsh')
    mkdirSync(home, { recursive: true })
    const backup = `${join(home, 'settings.yaml')}.bak-${Date.now()}`
    if (existsSync(join(home, 'settings.yaml'))) copyFileSync(join(home, 'settings.yaml'), backup)
    copyFileSync(result.filePaths[0], join(home, 'settings.yaml'))
    return { file: result.filePaths[0], backup }
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
