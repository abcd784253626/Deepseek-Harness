/**
 * dsh-img:// 自定义协议：安全地把本地图片提供给渲染进程预览。
 * 仅放行图片扩展名 + 文件头魔数校验；渲染进程无 Node 能力也能显示本地缩略图。
 */
import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { fileStatsSync } from './scanner'
import { extOf, IMAGE_EXTS } from './image-meta'

const MAX_SERVE_BYTES = 50 * 1024 * 1024

export function registerImageProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'dsh-img',
      privileges: { secure: true, stream: true, supportFetchAPI: false, bypassCSP: false }
    }
  ])
}

export function registerImageProtocol(): void {
  protocol.handle('dsh-img', async (request) => {
    try {
      const url = new URL(request.url)
      // dsh-img://local/C:/Users/... → pathname "/C:/Users/..." → "C:\Users\..."
      const encoded = url.pathname.replace(/^\//, '')
      const filePath = decodeURIComponent(encoded).replace(/\//g, '\\')
      if (!IMAGE_EXTS.has(extOf(filePath))) {
        return new Response('forbidden', { status: 403 })
      }
      const st = fileStatsSync(filePath)
      if (!st || !st.isFile || st.size > MAX_SERVE_BYTES) {
        return new Response('not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('bad request', { status: 400 })
    }
  })
}
