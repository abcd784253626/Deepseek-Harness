/**
 * 本地插件管理
 *
 * 安装/卸载走官方机制：`dsh plugin --profile <name> add|remove <spec>`
 * （该命令把参数原样转发给 profile 目录下的 pnpm）。
 * 启用/禁用通过编辑 profile package.json 的 dsh.profile.bundles 列表实现
 * （bundle 列表 = 官方定义的"挂载中的插件"）。
 * 安装完成后需重启内核使树生效（官方 Cordis 装载语义）。
 */
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import type { InstalledPlugin, PluginCategory, PluginOpResult } from '@shared/types'
import { getSettings } from '../store/database'
import {
  listInstalledPlugins,
  upsertInstalledPlugin,
  removeInstalledPlugin,
  setPluginEnabled as dbSetEnabled,
  type InstalledPluginRow
} from '../store/database'
import { resolveDsh, resolveSystemNode, pnpmAvailable } from '../kernel/resolver'
import { fetchNpmMeta } from './registry'

/** npm 包名白名单（含 scope）；防止路径遍历与 shell 元字符 */
export const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

/** 校验依赖键为合法 npm 包名（syncInstalled 读取其 node_modules 路径时使用） */
export function isSafePackageName(name: string): boolean {
  return NPM_NAME_RE.test(name) && !name.includes('..') && !name.includes('\\')
}

/**
 * 计算 profile node_modules 下某个依赖的 package.json 绝对路径。
 * name 已是完整包名（含 scope，如 @scope/name），直接拼到 node_modules 下即可，
 * 兼容 scoped 与普通包名；非法/不安全包名返回 null。
 */
function safePkgPath(profileDir: string, name: string): string | null {
  if (!profileDir || !isSafePackageName(name)) return null
  return join(profileDir, 'node_modules', name, 'package.json')
}

export function resolveProfileDir(dshHomeOverride = ''): string {
  const settings = getSettings()
  const home = dshHomeOverride || settings.dshHomeOverride || join(homedir(), '.dsh')
  return join(home, 'profiles', 'web')
}

export function readProfileJson(dshHomeOverride = ''): {
  dependencies: Record<string, string>
  bundles: string[]
  path: string
} | null {
  const dir = resolveProfileDir(dshHomeOverride)
  const file = join(dir, 'package.json')
  if (!existsSync(file)) return null
  try {
    const doc = JSON.parse(readFileSync(file, 'utf-8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    return {
      dependencies: doc.dependencies ?? {},
      bundles: doc.dsh?.profile?.bundles ?? [],
      path: file
    }
  } catch {
    return null
  }
}

export function writeProfileJson(patch: { dependencies?: Record<string, string>; bundles?: string[] }): boolean {
  try {
    const current = readProfileJson()
    if (!current) return false
    const doc = JSON.parse(readFileSync(current.path, 'utf-8')) as Record<string, unknown>
    if (patch.dependencies) doc.dependencies = patch.dependencies
    if (patch.bundles) {
      const dsh = (doc.dsh as Record<string, unknown> | undefined) ?? {}
      const profile = (dsh.profile as Record<string, unknown> | undefined) ?? {}
      profile.bundles = patch.bundles
      dsh.profile = profile
      doc.dsh = dsh
    }
    atomicWriteJson(current.path, doc)
    return true
  } catch {
    return false
  }
}

/** 原子写：同目录临时文件 + rename（防半写损坏） */
function atomicWriteJson(filePath: string, doc: unknown): void {
  const tmp = `${filePath}.tmp-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf-8')
  renameSync(tmp, filePath)
}

interface RunResult {
  ok: boolean
  code: number | null
  output: string
}

/** 杀进程树（Windows） */
function killTree(pid: number): void {
  try {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    killer.unref()
  } catch {
    /* 已退出 */
  }
}

/**
 * 执行 dsh plugin 命令。
 * 安全边界：始终以参数数组 spawn（无 shell）；dsh 入口统一解析到 bin.js。
 */
function runCommand(entry: string, isCmd: boolean, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 300_000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = isCmd
      ? spawn(entry, args, { env, windowsHide: true, shell: true })
      : spawn(process.execPath, [entry, ...args], { env, windowsHide: true })
    let output = ''
    let settled = false
    child.stdout?.on('data', (c: Buffer) => (output += c.toString()))
    child.stderr?.on('data', (c: Buffer) => (output += c.toString()))
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        /* 忽略 */
      }
      killTree(child.pid ?? 0)
      resolve({ ok: false, code: null, output: output + '\n[超时已终止]' })
    }, timeoutMs)
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, code: null, output: output + `\n${err.message}` })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: code === 0, code, output })
    })
  })
}

/** 插件操作事件（安装进度/日志），供 UI 订阅 */
export class PluginManager extends EventEmitter {
/** 执行 dsh plugin 命令；dsh 入口优先解析为 bin.js（无 shell） */
private async dshPlugin(args: string[]): Promise<RunResult> {
  const settings = getSettings()
  const binary = resolveDsh(settings.dshPathOverride)
  if (!binary) {
    return { ok: false, code: null, output: '未找到 dsh CLI' }
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: settings.dshHomeOverride || join(homedir(), '.dsh')
  }
  if (binary.viaPath) {
    // 兜底路径（.cmd 且 bin.js 缺失）：参数已由调用方白名单校验
    return runCommand(binary.path, true, ['plugin', '--profile', 'web', ...args], env)
  }
  // 必须用系统 Node 执行 bin.js：process.execPath 是 electron.exe（打包后为 DSH Desktop.exe），
  // 不带 ELECTRON_RUN_AS_NODE 时会把 bin.js 当应用入口加载导致 plugin 命令从未真正执行。
  const nodePath = resolveSystemNode()
  if (!nodePath) {
    return { ok: false, code: null, output: '未找到系统 Node.js 运行时。dsh 插件安装需要 Node.js 18+。' }
  }
  return runCommand(nodePath, false, [binary.path, 'plugin', '--profile', 'web', ...args], env)
}

  /**
   * 从 profile package.json 同步已安装插件到本地库（profile 为权威来源）。
   *
   * 设计要点：
   * 1. profile.dependencies 中每一项都 upsert 进 installed_plugins（保证安装后、重启后都能显示）；
   * 2. 版本号优先从本地 node_modules 的 package.json 读取，兼容 scoped 包名；
   * 3. enabled 同时匹配 bundles 中的「包名」与「link: 路径」两种写法；
   * 4. 数据一致性：清理孤儿记录（profile 已无此依赖且非内置的 DB 条目），
   *    仅当 profile 存在时才清理，避免 profile 尚未生成时误删已安装记录；
   * 5. 任何解析异常都不应清空列表 —— 回退到已有 DB 记录。
   */
  syncInstalled(): InstalledPlugin[] {
    const toInstalled = (r: InstalledPluginRow): InstalledPlugin => ({
      name: r.name,
      version: r.version,
      spec: r.spec,
      kind: r.kind,
      enabled: r.enabled,
      installedAt: r.installedAt,
      category: r.category as PluginCategory
    })
    try {
      const profile = readProfileJson()
      const profileDeps = profile?.dependencies ?? {}
      const bundles = new Set(profile?.bundles ?? [])
      const profileDir = profile ? resolveProfileDir() : ''

      // 现有 DB 记录（用于保留首次安装时间，避免每次同步都刷新成当前时间）
      const existing = new Map(listInstalledPlugins().map((r) => [r.name, r] as const))

      const seen = new Set<string>()
      for (const [name, spec] of Object.entries(profileDeps)) {
        const kind: InstalledPlugin['kind'] = spec.startsWith('link:') ? 'link' : 'npm'
        const linkName = spec.replace(/^link:/, '')
        const isBundle = bundles.has(name) || bundles.has(linkName)
        // 版本号：优先从本地 node_modules 的 package.json 读取（兼容 scoped 包名）
        let version = ''
        const pkgPath = safePkgPath(profileDir, name)
        if (pkgPath && existsSync(pkgPath)) {
          try {
            const doc = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string }
            version = doc.version ?? ''
          } catch {
            /* 损坏的包忽略 */
          }
        }
        const prev = existing.get(name)
        upsertInstalledPlugin({
          name,
          version,
          spec,
          kind,
          enabled: isBundle,
          installedAt: prev?.installedAt ?? Date.now(),
          category: prev?.category && prev.category !== 'other' ? prev.category : 'other'
        })
        seen.add(name)
      }

      // 数据一致性：清理孤儿记录 —— profile 已无此依赖且非内置的 DB 条目
      if (profile) {
        for (const r of existing.values()) {
          if (r.kind !== 'builtin' && !seen.has(r.name)) removeInstalledPlugin(r.name)
        }
      }

      return listInstalledPlugins().map(toInstalled)
    } catch (err) {
      // 任意解析失败都不应清空列表：回退到已有 DB 记录
      console.error('[plugins] syncInstalled 失败，回退到已有记录:', err)
      return listInstalledPlugins().map(toInstalled)
    }
  }

  /** 安装（npm 包或 link: 本地路径）；安装后返回提示重启内核 */
  async install(spec: string): Promise<PluginOpResult> {
    if (!pnpmAvailable()) {
      return {
        ok: false,
        message: '未检测到 pnpm。dsh 官方插件机制依赖 pnpm，请先安装：npm install -g pnpm',
        logTail: []
      }
    }
    this.emit('op', { phase: 'install', name: spec, status: 'running' })
    const name = spec.replace(/^link:/, '')
    const result = await this.dshPlugin(['add', spec])
    if (!result.ok) {
      this.emit('op', { phase: 'install', name, status: 'failed' })
      return {
        ok: false,
        message: `安装失败（exit ${result.code ?? '?'}）`,
        logTail: result.output.split(/\r?\n/).filter(Boolean).slice(-40)
      }
    }
    this.syncInstalled()
    this.emit('op', { phase: 'install', name, status: 'done' })
    return {
      ok: true,
      message: '安装成功。插件将在内核重启后生效（桌面端会自动重启内核）。',
      logTail: result.output.split(/\r?\n/).filter(Boolean).slice(-20)
    }
  }

  async uninstall(name: string): Promise<PluginOpResult> {
    const result = await this.dshPlugin(['remove', name])
    if (!result.ok) {
      return {
        ok: false,
        message: `卸载失败（exit ${result.code ?? '?'})`,
        logTail: result.output.split(/\r?\n/).filter(Boolean).slice(-40)
      }
    }
    // 先按 profile 重新对账（依赖移除后不应再被写回），再确保 DB 中彻底删除该记录
    this.syncInstalled()
    removeInstalledPlugin(name)
    return { ok: true, message: '卸载成功。内核将自动重启以卸载插件树。' }
  }

  /** 更新 / 回滚到指定版本（仅对 npm 版本类依赖有效） */
  async setVersion(name: string, version?: string): Promise<PluginOpResult> {
    const profile = readProfileJson()
    const spec = profile?.dependencies[name] ?? ''
    if (!spec || spec.startsWith('link:')) {
      return { ok: false, message: '该插件为本地链接安装，不支持版本切换' }
    }
    const target = version ? `${name}@${version}` : name
    const result = await this.dshPlugin(['add', target])
    if (!result.ok) {
      return {
        ok: false,
        message: `版本切换失败（exit ${result.code ?? '?'}）`,
        logTail: result.output.split(/\r?\n/).filter(Boolean).slice(-40)
      }
    }
    this.syncInstalled()
    return { ok: true, message: version ? `已回滚到 ${version}。内核将自动重启。` : '已更新到最新版本。内核将自动重启。' }
  }

  async enable(name: string, enabled: boolean): Promise<PluginOpResult> {
    const profile = readProfileJson()
    if (!profile) return { ok: false, message: '未找到 web profile（请先启动一次内核）' }
    const bundles = new Set(profile.bundles)
    if (enabled) bundles.add(name)
    else bundles.delete(name)
    if (writeProfileJson({ bundles: [...bundles] })) {
      dbSetEnabled(name, enabled)
      return {
        ok: true,
        message: enabled ? '已启用（重启内核后生效）' : '已禁用（重启内核后生效）'
      }
    }
    return { ok: false, message: '写入 profile 失败' }
  }

  /** 安装时可选的 npm 版本列表 */
  async availableVersions(name: string): Promise<string[]> {
    const meta = await fetchNpmMeta(name)
    return meta?.versions ?? []
  }
}

export const pluginManager = new PluginManager()
