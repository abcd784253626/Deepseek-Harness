/**
 * 系统托盘
 * 最小化到托盘时保持内核进程存活，点击恢复窗口。
 *
 * 崩溃防护：Electron 中 Tray 销毁后仍可能派发已排队事件（如退出瞬间的
 * 单击），回调访问已销毁的原生对象会抛 "Object has been destroyed"。
 * 处理：销毁前 removeAllListeners；回调内以 destroyed 标志守卫。
 */
import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'node:path'
import { getMainWindow } from './window'

let tray: Tray | null = null
let destroyed = true

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
  tray.setToolTip('DSH Desktop — DeepSeek Harness')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => getMainWindow()?.show() },
      { label: '隐藏主窗口', click: () => getMainWindow()?.hide() },
      { type: 'separator' },
      { label: '退出 DSH Desktop', click: () => app.quit() }
    ])
  )
  tray.on('click', () => {
    if (destroyed) return
    const win = getMainWindow()
    if (!win) return
    if (win.isVisible()) win.hide()
    else win.show()
  })
}

export function destroyTray(): void {
  if (!tray) return
  destroyed = true
  tray.removeAllListeners()
  const t = tray
  tray = null
  try {
    t.destroy()
  } catch {
    /* 已销毁 */
  }
}
