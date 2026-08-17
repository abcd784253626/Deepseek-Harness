/**
 * dsh CLI 解析器
 * 定位官方 @deepseek-ai/dsh 可执行文件，读取版本信息。
 *
 * 查找顺序：
 *   1. 桌面设置中的显式路径覆盖（settings.dshPathOverride）
 *   2. 环境变量 DSH_DESKTOP_DSH_BIN
 *   3. PATH / npm 全局安装（Windows: %APPDATA%\npm\node_modules）
 *   4. 应用内捆绑目录 resources/dsh
 */
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { app } from 'electron'
import { homedir } from 'node:os'

export interface DshBinary {
  /** 可执行入口（node 脚本路径，始终指向 lib/bin.js） */
  path: string
  version: string | null
  /** 是否来自 PATH 中的 dsh.cmd（旧字段，保留兼容） */
  viaPath: boolean
}

const NPM_GLOBAL_CANDIDATES = [
  join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  join(homedir(), '.npm-global', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  join(homedir(), 'AppData', 'Local', 'pnpm', 'global', '5', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
]

function probeVersion(entry: string): string | null {
  try {
    // 必须用系统 Node 执行 bin.js（打包环境下 process.execPath 是 exe 而非 node）
    const node = resolveSystemNode() ?? process.execPath
    const res = spawnSync(node, [entry, '--version'], {
      timeout: 8000,
      encoding: 'utf-8',
      windowsHide: true
    })
    const text = (res.stdout || res.stderr || '').trim()
    const m = text.match(/[\d]+\.[\d]+\.[\d]+(?:-[^\s]+)?/)
    return m ? m[0] : null
  } catch {
    return null
  }
}

/**
 * .cmd 垫片 → 真实 bin.js
 * npm 全局安装的 dsh.cmd 与 bin.js 位于同一 node_modules 树：
 *   <npmBin>/dsh.cmd
 *   <npmBin>/node_modules/@deepseek-ai/dsh/lib/bin.js
 * 统一返回 bin.js，主进程以 `node bin.js` 方式启动（无需 shell，避免 cmd 引号问题）。
 */
function normalizeCmdShim(cmdPath: string): string | null {
  const binDir = dirname(cmdPath)
  const script = join(binDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (existsSync(script)) return script
  return null
}

function findFromPath(): DshBinary | null {
  const npmBin = join(process.env.APPDATA ?? '', 'npm')
  const cmd = join(npmBin, 'dsh.cmd')
  if (existsSync(cmd)) {
    const script = normalizeCmdShim(cmd)
    if (script) {
      const version = probeVersion(script)
      return { path: script, version, viaPath: false }
    }
    // 垫片存在但 bin.js 缺失：保留 viaPath 兜底（调用方需以 shell 执行）
    return { path: cmd, version: null, viaPath: true }
  }
  return null
}

/**
 * 校验入口是否属于官方 @deepseek-ai/dsh 包树：
 * 向上查找 package.json 的 name 字段（bin.js 位于 <pkg>/lib/bin.js）
 */
function isOfficialDshEntry(entry: string): boolean {
  try {
    const resolved = require('node:path').resolve(entry)
    const { dirname, join } = require('node:path') as typeof import('node:path')
    let dir = dirname(resolved)
    for (let i = 0; i < 6; i++) {
      const pkgPath = join(dir, 'package.json')
      if (existsSync(pkgPath)) {
        try {
          const doc = JSON.parse(require('node:fs').readFileSync(pkgPath, 'utf-8'))
          if (doc?.name === '@deepseek-ai/dsh') return true
          return false
        } catch {
          return false
        }
      }
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch {
    /* 校验失败按非官方处理 */
  }
  return false
}

export function resolveDsh(override: string): DshBinary | null {
  if (override) {
    if (existsSync(override)) {
      const script = override.endsWith('.cmd') ? normalizeCmdShim(override) : null
      const entry = script ?? override
      // 覆盖路径必须是官方 dsh CLI（防止任意可执行文件被拉起）
      if (entry.endsWith('.cmd') || !isOfficialDshEntry(entry)) return null
      return { path: entry, version: probeVersion(entry), viaPath: false }
    }
    return null
  }
  const envBin = process.env.DSH_DESKTOP_DSH_BIN
  if (envBin && existsSync(envBin)) {
    const script = envBin.endsWith('.cmd') ? normalizeCmdShim(envBin) : null
    const entry = script ?? envBin
    return { path: entry, version: probeVersion(entry), viaPath: !script }
  }
  const fromPath = findFromPath()
  if (fromPath) return fromPath
  for (const candidate of NPM_GLOBAL_CANDIDATES) {
    if (existsSync(candidate)) {
      return { path: candidate, version: probeVersion(candidate), viaPath: false }
    }
  }
  // 应用内捆绑（未来版本随安装包分发 dsh）
  const bundled = join(process.resourcesPath ?? '', 'dsh', 'lib', 'bin.js')
  if (existsSync(bundled)) {
    return { path: bundled, version: probeVersion(bundled), viaPath: false }
  }
  return null
}

/** dsh 包目录（bin.js 的上一级再上一级即包根） */
export function dshPackageRoot(binary: DshBinary): string {
  return dirname(dirname(binary.path))
}

export function pnpmAvailable(): boolean {
  const candidates = [
    join(process.env.APPDATA ?? '', 'npm', 'pnpm.cmd'),
    join(process.env.LOCALAPPDATA ?? '', 'pnpm', 'pnpm.exe')
  ]
  for (const c of candidates) {
    if (existsSync(c)) return true
  }
  // PATH 兜底（corepack / 手动安装）
  try {
    const res = spawnSync('pnpm', ['--version'], { timeout: 5000, windowsHide: true })
    return res.status === 0
  } catch {
    return false
  }
}

export function appVersion(): string {
  return app.getVersion()
}

/**
 * 定位系统 Node.js 运行时。
 * 返回绝对路径（不返回裸命令名 'node'，避免 Windows CreateProcess
 * 搜索顺序 / PATH 劫持执行非预期可执行文件）。
 */
export function resolveSystemNode(): string | null {
  const override = process.env.DSH_DESKTOP_NODE_BIN
  if (override && existsSync(override)) return override
  try {
    // 先探测 PATH 中的 node 并解析出真实 execPath 绝对路径
    const res = spawnSync('node', ['-p', 'process.execPath'], {
      timeout: 5000,
      windowsHide: true,
      encoding: 'utf-8'
    })
    if (res.status === 0 && res.stdout) {
      const abs = res.stdout.trim()
      if (abs && existsSync(abs)) return abs
    }
  } catch {
    /* PATH 无 node */
  }
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'nodejs', 'node.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'nodejs', 'node.exe')
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

export function systemNodeVersion(): string | null {
  const node = resolveSystemNode()
  if (!node) return null
  try {
    const res = spawnSync(node, ['--version'], { timeout: 5000, windowsHide: true, encoding: 'utf-8' })
    return (res.stdout || '').trim().replace(/^v/, '') || null
  } catch {
    return null
  }
}
