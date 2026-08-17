/**
 * DSH Desktop — Electron 主进程入口
 *
 * 三层架构中的"主进程"层：窗口/托盘/菜单/文件对话框 + 内核子进程生命周期
 * + 本地存储 + IPC 鉴权中转。
 */
import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { createMainWindow, getMainWindow, destroyMainWindow, requestClose } from './window'
import { installMenu } from './menu'
import { installTray, destroyTray } from './tray'
import { kernelManager } from './kernel/manager'
import { getSettings } from './store/database'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  bootstrap()
}

let isQuitting = false

function bootstrap(): void {
  // 单实例：重复启动时聚焦已有窗口
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    installMenu()
    registerIpc()
    createMainWindow()
    installTray()

    // 启动时自动拉起内核（默认开启）
    const settings = getSettings()
    if (settings.autoStartKernel) {
      await kernelManager.start(settings.lastWorkspaceId || null)
    }
  })

  // 关闭窗口 → 按设置最小化到托盘或退出
  app.on('window-all-closed', () => {
    /* 由各窗口 close 事件统一处理（托盘常驻），不在此退出 */
  })
  getMainWindowProxyClose()

  app.on('before-quit', () => {
    kernelManager.dispose()
    destroyTray()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
}

function getMainWindowProxyClose(): void {
  // window.ts 的 requestClose 在渲染进程关闭按钮触发；此处兜底 intercept close 事件
  app.on('browser-window-created', (_e, win) => {
    win.on('close', (event) => {
      if (isQuitting) return
      const decision = requestClose()
      if (decision === 'tray') {
        event.preventDefault()
      } else {
        isQuitting = true
      }
    })
  })
}
