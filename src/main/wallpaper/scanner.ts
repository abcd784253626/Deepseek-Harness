/**
 * 本地磁盘图片扫描
 *  - 自动枚举固定盘（A-Z，跳过光驱/网络盘）
 *  - 递归遍历，排除系统/缓存目录，深度限制
 *  - 扩展名初筛 + 文件头魔数复核（识别各类格式）
 *  - 异步分批遍历（setImmediate 让出事件循环），进度回调
 */
import { readdir, stat, open } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join, basename } from 'node:path'
import type { WallpaperInfo } from '@shared/types'
import { isImageExt, readImageMeta } from './image-meta'

const EXCLUDED_DIR_NAMES = new Set([
  'windows', 'program files', 'program files (x86)', 'node_modules', '.git', '.svn',
  '$recycle.bin', 'system volume information', 'appdata', 'temp', 'tmp', 'cache',
  'caches', 'msocache', 'perflogs', 'winnt', 'boot', 'recovery'
])

const MAX_DEPTH = 8
const MAX_FILE_BYTES = 30 * 1024 * 1024
const MAX_RESULTS = 2000

export interface ScanOptions {
  roots?: string[]
  maxDepth?: number
  maxResults?: number
}

export interface ScanProgress {
  scanned: number
  found: number
  currentDir: string
  /** 各格式计数（如 jpeg: 12, png: 8） */
  counts: Record<string, number>
}

/** 枚举本地固定盘根 */
export async function listLocalDrives(): Promise<string[]> {
  const drives: string[] = []
  for (let code = 65; code <= 90; code++) {
    const root = `${String.fromCharCode(code)}:\\`
    try {
      const st = await stat(root)
      if (st.isDirectory()) drives.push(root)
    } catch {
      /* 跳过不存在/不可访问的盘符 */
    }
  }
  return drives
}

/** 用户图片目录的常见位置 */
export function defaultImageDirs(): string[] {
  const { homedir } = require('node:os') as typeof import('node:os')
  const home = homedir()
  return [
    join(home, 'Pictures'),
    join(home, 'Desktop'),
    join(home, 'Downloads'),
    join(home, 'OneDrive', '图片'),
    join(home, 'OneDrive', 'Pictures')
  ].filter((d) => {
    try {
      return require('node:fs').existsSync(d)
    } catch {
      return false
    }
  })
}

/** 去重/去嵌套：若某 root 已被另一 root 覆盖则丢弃（避免重复扫描） */
function dedupeRoots(roots: string[]): string[] {
  const normalized = roots.map((r) => r.replace(/[\\/]+$/, '') + '\\').sort((a, b) => a.length - b.length)
  const kept: string[] = []
  for (const root of normalized) {
    if (kept.some((k) => root.toLowerCase().startsWith(k.toLowerCase()))) continue
    kept.push(root)
  }
  return kept.map((r) => r.replace(/\\$/, ''))
}

export async function scanForImages(options: ScanOptions = {}, onProgress?: (p: ScanProgress) => void): Promise<WallpaperInfo[]> {
  let roots = options.roots?.length ? dedupeRoots(options.roots) : await listLocalDrives()
  const maxDepth = options.maxDepth ?? MAX_DEPTH
  const maxResults = options.maxResults ?? MAX_RESULTS
  const found: WallpaperInfo[] = []
  const counts: Record<string, number> = {}
  let scanned = 0

  const yieldLoop = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve))

  const pushResult = (info: WallpaperInfo): void => {
    found.push(info)
    counts[info.format] = (counts[info.format] ?? 0) + 1
    found.sort((a, b) => b.modifiedAt - a.modifiedAt)
    if (found.length > maxResults) {
      // 截断时同步回收计数
      const dropped = found.slice(maxResults)
      for (const d of dropped) counts[d.format] = Math.max(0, (counts[d.format] ?? 1) - 1)
      found.length = maxResults
    }
  }

  const walk = async (dir: string, depth: number): Promise<boolean> => {
    if (depth > maxDepth) return false
    if (found.length >= maxResults) return true
    let entries: Dirent[]
    try {
      entries = (await readdir(dir, { withFileTypes: true })) as Dirent[]
    } catch {
      return false
    }
    for (const entry of entries) {
      if (found.length >= maxResults) return true
      scanned += 1
      if (scanned % 150 === 0) {
        onProgress?.({ scanned, found: found.length, currentDir: dir, counts: { ...counts } })
        await yieldLoop()
      }
      if (entry.isDirectory()) {
        const name = entry.name.toLowerCase()
        if (EXCLUDED_DIR_NAMES.has(name)) continue
        const done = await walk(join(dir, entry.name), depth + 1)
        if (done) return true
        continue
      }
      if (!entry.isFile()) continue
      const full = join(dir, entry.name)
      if (!isImageExt(full)) continue
      try {
        const st = await stat(full)
        if (st.size <= 0 || st.size > MAX_FILE_BYTES) continue
        // 文件头魔数复核（识别真实格式，防伪装扩展名）
        const meta = readImageMeta(full)
        if (!meta) continue
        pushResult({
          path: full,
          name: basename(full),
          sizeBytes: st.size,
          modifiedAt: st.mtimeMs,
          format: meta.format,
          width: meta.width,
          height: meta.height
        })
      } catch {
        /* 文件可能被占用/删除，跳过 */
      }
    }
    return found.length >= maxResults
  }

  for (const root of roots) {
    if (found.length >= maxResults) break
    const done = await walk(root, 0)
    if (done) break
  }
  onProgress?.({ scanned, found: found.length, currentDir: '', counts })
  return found
}

/** 供协议层使用的同步存在性检查（避免异步竞态） */
export function fileStatsSync(path: string): { size: number; isFile: boolean } | null {
  try {
    const st = require('node:fs').statSync(path)
    return { size: st.size, isFile: st.isFile() }
  } catch {
    return null
  }
}

export async function readFileHead(path: string, bytes: number): Promise<Buffer | null> {
  try {
    const fh = await open(path, 'r')
    try {
      const buf = Buffer.alloc(bytes)
      const { bytesRead } = await fh.read(buf, 0, bytes, 0)
      return buf.subarray(0, bytesRead)
    } finally {
      await fh.close()
    }
  } catch {
    return null
  }
}
