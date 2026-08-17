/**
 * dsh-img:// 自定义协议：安全地把本地图片提供给渲染进程预览。
 * 安全边界（四重）：
 *  1. 扩展名白名单 + 文件头魔数复核（扩展名伪装无效）
 *  2. lstat 拒绝符号链接（防链接名绕过扩展名检查）
 *  3. 路径白名单：仅允许已登记的壁纸路径与工作区/用户图片目录（防任意文件读取）
 *  4. 大小上限
 */
import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { lstatSync, readFileSync } from 'node:fs'
import { dirname, normalize, sep } from 'node:path'
import { extOf, IMAGE_EXTS, formatOf } from './image-meta'
import { getSettings, listWorkspaces } from '../store/database'
import { defaultImageDirs } from './scanner'

const MAX_SERVE_BYTES = 50 * 1024 * 1024

export function registerImageProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'dsh-img',
      privileges: { secure: true, stream: true, supportFetchAPI: false, bypassCSP: false }
    }
  ])
}

/** 计算当前允许服务的路径根（缓存于模块级，设置变化时失效） */
let allowlistCache: string[] | null = null
export function invalidateImageAllowlist(): void {
  allowlistCache = null
}

function allowedRoots(): string[] {
  if (allowlistCache) return allowlistCache
  const roots = new Set<string>()
  const settings = getSettings()
  // 1. 当前壁纸路径本身（及其父目录）
  if (settings.wallpaperPath) {
    roots.add(dirname(settings.wallpaperPath))
  }
  // 2. 用户图片/桌面/下载目录
  for (const dir of defaultImageDirs()) roots.add(dir)
  // 3. 已登记工作区目录（含 dshHome）
  for (const ws of listWorkspaces()) {
    roots.add(ws.path)
    if (ws.dshHome) roots.add(ws.dshHome)
  }
  allowlistCache = [...roots]
  return allowlistCache
}

function isAllowedPath(filePath: string): boolean {
  const normalized = normalize(filePath).toLowerCase()
  for (const root of allowedRoots()) {
    const r = normalize(root).toLowerCase().replace(/[\\/]+$/, '')
    if (normalized === r || normalized.startsWith(r + sep)) return true
  }
  return false
}

export function registerImageProtocol(): void {
  protocol.handle('dsh-img', async (request) => {
    try {
      const url = new URL(request.url)
      const encoded = url.pathname.replace(/^\//, '')
      const filePath = decodeURIComponent(encoded).replace(/\//g, '\\')

      // 1) 扩展名白名单
      if (!IMAGE_EXTS.has(extOf(filePath))) {
        return new Response('forbidden', { status: 403 })
      }
      // 2) 拒绝符号链接 / 非常规文件
      let st
      try {
        st = lstatSync(filePath)
      } catch {
        return new Response('not found', { status: 404 })
      }
      if (!st.isFile() || st.isSymbolicLink() || st.size <= 0 || st.size > MAX_SERVE_BYTES) {
        return new Response('forbidden', { status: 403 })
      }
      // 3) 路径白名单
      if (!isAllowedPath(filePath)) {
        return new Response('forbidden', { status: 403 })
      }
      // 4) 文件头魔数复核（扩展名伪装 / 非图片内容一律拒绝）
      let head: Buffer
      try {
        head = readFileSync(filePath, { encoding: null }).subarray(0, 64)
      } catch {
        return new Response('unreadable', { status: 500 })
      }
      const format = formatOf(head)
      const ext = extOf(filePath).slice(1)
      const formatMatchesExt =
        format === 'jpeg' ? ext === 'jpg' || ext === 'jpeg'
        : format === 'tiff' ? ext === 'tif' || ext === 'tiff'
        : ext === format
      if (!format || !formatMatchesExt) {
        return new Response('not an image', { status: 415 })
      }
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('bad request', { status: 400 })
    }
  })
}
