/**
 * 系统托盘
 * 最小化到托盘时保持内核进程存活，点击恢复窗口。
 *
 * 崩溃防护（多层）：
 *  - 回调整体 try/catch：Tray 事件在原生对象销毁后仍可能排队派发
 *    （Windows 托盘消息循环 / explorer 重启 / 退出时序），任何一行抛错
 *    都会变成主进程 uncaught exception 弹窗
 *  - destroyed 标志 + removeAllListeners：销毁后事件不再进入回调
 *  - isDestroyed() 检查：回调中访问的 BrowserWindow 也可能已销毁
 *  - 所有 Tray 方法调用单独 try/catch（destroy 竞态）
 */
import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'node:path'
import { getMainWindow } from './window'

let tray: Tray | null = null
let destroyed = true

/** 回调内统一的错误吞噬：Tray/窗口生命周期竞态一律不弹窗 */
function safe(cb: () => void): () => void {
  return () => {
    if (destroyed || !tray) return
    try {
      cb()
    } catch {
      /* Tray 事件竞态错误（Object has been destroyed 等）：吞掉，避免 uncaught 弹窗 */
    }
  }
}

export function installTray(): void {
  if (tray) return
  const iconPath = join(__dirname, '../../resources/tray.png')
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    // 兜底：16x16 纯色图标
    image = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCgYA6hQAAX8Kk6UAAAAASUVORK5CYII='
    )
  }
  destroyed = false
  tray = new Tray(image)
  try {
    tray.setToolTip('DSH Desktop — DeepSeek Harness')
  } catch {
    /* 忽略 */
  }
  try {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: '显示主窗口',
          click: safe(() => {
            const win = getMainWindow()
            if (win && !win.isDestroyed()) win.show()
          })
        },
        {
          label: '隐藏主窗口',
          click: safe(() => {
            const win = getMainWindow()
            if (win && !win.isDestroyed()) win.hide()
          })
        },
        { type: 'separator' },
        {
          label: '退出 DSH Desktop',
          click: () => app.quit()
        }
      ])
    )
  } catch {
    /* 忽略 */
  }
  // 单击托盘：切换主窗口显隐（回调内不访问 tray 自身，只访问窗口）
  tray.on('click', safe(() => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return
    if (win.isVisible()) win.hide()
    else {
      win.show()
      win.focus()
    }
  }))
  // 双保险：托盘图标的原生错误不再向上抛（Electron 43 Windows 托盘已知竞态）
  tray.on('double-click', safe(() => {
    const win = getMainWindow()
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
    }
  }))
}

export function destroyTray(): void {
  if (!tray) return
  destroyed = true
  try {
    tray.removeAllListeners()
  } catch {
    /* 忽略 */
  }
  const t = tray
  tray = null
  try {
    t.destroy()
  } catch {
    /* 已销毁 */
  }
}
