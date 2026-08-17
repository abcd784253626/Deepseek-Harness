/**
 * 原生应用菜单（Windows）
 * 与渲染进程快捷键（Ctrl+Shift+P 等）配合；极简，无冗余项。
 */
import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import { getMainWindow } from './window'

export function installMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ role: 'appMenu' as const }]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '退出', accelerator: 'Alt+F4', click: () => app.quit() }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '官方文档',
          click: () => {
            const { shell } = require('electron') as typeof import('electron')
            void shell.openExternal('https://github.com/deepseek-ai/deepseek-harness')
          }
        },
        {
          label: '关于 DSH Desktop',
          click: () => {
            const win = getMainWindow()
            win?.webContents.send('app:show-about')
          }
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
