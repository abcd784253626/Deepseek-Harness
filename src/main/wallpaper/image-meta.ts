/**
 * 图片格式识别 — 纯读文件头，零依赖
 * 魔数检测 jpeg/png/gif/bmp/webp/tiff/ico，并解析宽高（tiff 除外）。
 */
import type { ImageFormat } from '@shared/types'

export const IMAGE_EXTS: ReadonlySet<string> = new Set([
  '.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp', '.tif', '.tiff', '.ico'
])

const MAX_HEADER = 64 * 1024

export function extOf(path: string): string {
  const idx = path.lastIndexOf('.')
  if (idx < 0) return ''
  return path.slice(idx).toLowerCase()
}

export function isImageExt(path: string): boolean {
  return IMAGE_EXTS.has(extOf(path))
}

export function mimeOf(format: ImageFormat): string {
  switch (format) {
    case 'jpeg': return 'image/jpeg'
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    case 'webp': return 'image/webp'
    case 'tiff': return 'image/tiff'
    case 'ico': return 'image/x-icon'
  }
}

export function formatOf(buf: Buffer): ImageFormat | null {
  if (buf.length < 12) return null
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif'
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp'
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp'
  if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) || (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)) return 'tiff'
  if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'ico'
  return null
}

export interface ImageMeta {
  format: ImageFormat
  width: number | null
  height: number | null
}

/** 读取文件头并解析元信息（宽高解析失败时返回 null，不抛错） */
export function readImageMeta(path: string): ImageMeta | null {
  const { openSync, readSync, closeSync } = require('node:fs') as typeof import('node:fs')
  let fd: number
  try {
    fd = openSync(path, 'r')
  } catch {
    return null
  }
  try {
    const buf = Buffer.alloc(Math.min(MAX_HEADER, 4096))
    const n = readSync(fd, buf, 0, buf.length, 0)
    const head = buf.subarray(0, n)
    const format = formatOf(head)
    if (!format) return null
    return { format, ...dimensionsOf(head, format) }
  } catch {
    return null
  } finally {
    try {
      closeSync(fd)
    } catch {
      /* 忽略 */
    }
  }
}

function dimensionsOf(buf: Buffer, format: ImageFormat): { width: number | null; height: number | null } {
  try {
    switch (format) {
      case 'png': {
        // IHDR: 偏移 16，宽高各 4 字节大端
        if (buf.length < 24) return { width: null, height: null }
        return {
          width: buf.readUInt32BE(16),
          height: buf.readUInt32BE(20)
        }
      }
      case 'gif': {
        // 偏移 6，宽高各 2 字节小端
        if (buf.length < 10) return { width: null, height: null }
        return {
          width: buf.readUInt16LE(6),
          height: buf.readUInt16LE(8)
        }
      }
      case 'bmp': {
        // 偏移 18 / 22，4 字节小端
        if (buf.length < 26) return { width: null, height: null }
        return {
          width: buf.readUInt32LE(18),
          height: Math.abs(buf.readInt32LE(22))
        }
      }
      case 'jpeg': {
        // 扫描 SOF 标记：FF C0-CF（排除 C4/C8/CC）
        let off = 2
        while (off + 9 < buf.length) {
          if (buf[off] !== 0xff) {
            off += 1
            continue
          }
          const marker = buf[off + 1]
          if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
            off += 2
            continue
          }
          const len = buf.readUInt16BE(off + 2)
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return {
              height: buf.readUInt16BE(off + 5),
              width: buf.readUInt16BE(off + 7)
            }
          }
          off += 2 + len
        }
        return { width: null, height: null }
      }
      case 'webp': {
        // VP8X: 24 位画布（偏移 24，小端 3 字节）
        if (buf.length > 30 && buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x58) {
          return {
            width: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1,
            height: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1
          }
        }
        // VP8 (lossy): 偏移 26 起 3 字节小端
        if (buf.length > 30 && buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x20) {
          return {
            width: buf[26] | ((buf[27] & 0x3f) << 8),
            height: buf[28] | ((buf[29] & 0x3f) << 8)
          }
        }
        // VP8L (lossless): 14 位打包
        if (buf.length > 25 && buf[12] === 0x56 && buf[13] === 0x50 && buf[14] === 0x38 && buf[15] === 0x4c) {
          const bits = buf.readUInt32LE(21)
          return {
            width: (bits & 0x3fff) + 1,
            height: ((bits >> 14) & 0x3fff) + 1
          }
        }
        return { width: null, height: null }
      }
      case 'ico': {
        // 目录项：偏移 6 + 16*i，宽高为字节（0 = 256）
        const count = buf.readUInt16LE(4)
        if (count < 1) return { width: null, height: null }
        const entry = 6
        const w = buf[entry] === 0 ? 256 : buf[entry]
        const h = buf[entry + 1] === 0 ? 256 : buf[entry + 1]
        return { width: w, height: h }
      }
      default:
        return { width: null, height: null }
    }
  } catch {
    return { width: null, height: null }
  }
}
