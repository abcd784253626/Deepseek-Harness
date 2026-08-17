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

  // 导航白名单：精确解析 URL，拒绝前缀匹配绕过（localhost.evil.com / userinfo 注入等）
  const isAllowedNavigation = (url: string): boolean => {
    try {
      const parsed = new URL(url)
      if (parsed.username || parsed.password) return false
      if (parsed.protocol === 'file:') {
        // 仅放行应用自带 renderer 目录
        const appFile = parsed.pathname.replace(/\//g, '\\').toLowerCase()
        return (
          appFile.includes('\\out\\renderer\\') ||
          appFile.endsWith('\\index.html')
        )
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
      const host = parsed.hostname.toLowerCase()
      return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
    } catch {
      return false
    }
  }

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault()
      if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    }
  })

  // webview 客进程加固：仅放行内核 origin，外部链接交给系统浏览器
  win.webContents.on('did-attach-webview', (_event, guest) => {
    guest.on('will-navigate', (event, url) => {
      let allowed = false
      try {
        const parsed = new URL(url)
        allowed =
          parsed.protocol === 'http:' &&
          (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
      } catch {
        allowed = false
      }
      if (!allowed) {
        event.preventDefault()
        if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
      }
    })
    guest.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
  })

  // webview 挂载校验：src/partition 白名单 + 强制移除特权能力
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    let srcOk = false
    try {
      const parsed = new URL(params.src ?? '')
      srcOk =
        parsed.protocol === 'http:' &&
        (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
        !parsed.username &&
        !parsed.password
    } catch {
      srcOk = false
    }
    const partitionOk = (params.partition ?? '') === 'persist:dsh-official'
    if (!srcOk || !partitionOk || params.allowpopups) {
      event.preventDefault()
      return
    }
    // 无论渲染进程传什么，客进程一律无特权
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
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
