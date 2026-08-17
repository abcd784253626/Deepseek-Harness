/**
 * 主窗口管理
 * - 无边框窗口（隐藏系统标题栏，渲染进程绘制自定义标题栏，适配皮肤）
 * - 渲染进程沙箱化：contextIsolation + nodeIntegration 关闭
 */
import { BrowserWindow, shell, nativeTheme } from 'electron'
import { join } from 'node:path'
import { getSettings } from './store/database'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0d0d' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: false
    }
  })

  mainWindow = win

  win.on('ready-to-show', () => win.show())
  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))

  // 外部链接一律交给系统浏览器（安全）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
      event.preventDefault()
      if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    }
  })

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void win.loadURL(rendererUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

export function destroyMainWindow(): void {
  mainWindow = null
}

/** 供 IPC 查询当前窗口状态 */
export function isMaximized(): boolean {
  return mainWindow?.isMaximized() ?? false
}

export function toggleMaximize(): void {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
}

export function minimizeWindow(): void {
  mainWindow?.minimize()
}

/** 渲染进程请求关闭：按设置决定最小化到托盘还是退出 */
export function requestClose(): 'quit' | 'tray' {
  const settings = getSettings()
  if (settings.minimizeToTray) {
    mainWindow?.hide()
    return 'tray'
  }
  return 'quit'
}
