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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { InstalledPlugin, PluginCategory, PluginOpResult } from '@shared/types'
import { getSettings } from '../store/database'
import {
  listInstalledPlugins,
  upsertInstalledPlugin,
  removeInstalledPlugin,
  setPluginEnabled as dbSetEnabled
} from '../store/database'
import { resolveDsh, pnpmAvailable } from '../kernel/resolver'
import { fetchNpmMeta } from './registry'

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
  const current = readProfileJson()
  if (!current) return false
  const doc = JSON.parse(readFileSync(current.path, 'utf-8'))
  if (patch.dependencies) doc.dependencies = patch.dependencies
  if (patch.bundles) {
    doc.dsh = doc.dsh ?? {}
    doc.dsh.profile = doc.dsh.profile ?? {}
    doc.dsh.profile.bundles = patch.bundles
  }
  writeFileSync(current.path, JSON.stringify(doc, null, 2) + '\n', 'utf-8')
  return true
}

interface RunResult {
  ok: boolean
  code: number | null
  output: string
}

function runCommand(entry: string, isCmd: boolean, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 300_000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = isCmd
      ? spawn(entry, args, { env, windowsHide: true, shell: true })
      : spawn(process.execPath, [entry, ...args], { env, windowsHide: true })
    let output = ''
    child.stdout?.on('data', (c: Buffer) => (output += c.toString()))
    child.stderr?.on('data', (c: Buffer) => (output += c.toString()))
    const timer = setTimeout(() => {
      child.kill()
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, code: null, output: output + `\n${err.message}` })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, code, output })
    })
  })
}

/** 插件操作事件（安装进度/日志），供 UI 订阅 */
export class PluginManager extends EventEmitter {
  /** 执行 dsh plugin 命令 */
  private async dshPlugin(args: string[]): Promise<RunResult> {
    const settings = getSettings()
    const binary = resolveDsh(settings.dshPathOverride)
    if (!binary) {
      return { ok: false, code: null, output: '未找到 dsh CLI' }
    }
    const isCmd = binary.viaPath || binary.path.endsWith('.cmd')
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DSH_HOME: settings.dshHomeOverride || join(homedir(), '.dsh')
    }
    return runCommand(binary.path, isCmd, ['plugin', '--profile', 'web', ...args], env)
  }

  /** 从 profile package.json 同步已安装插件到本地库 */
  syncInstalled(): InstalledPlugin[] {
    const rows = listInstalledPlugins()
    const known = new Set(rows.map((r) => r.name))
    const toInstalled = (r: (typeof rows)[number]): InstalledPlugin => ({
      name: r.name,
      version: r.version,
      spec: r.spec,
      kind: r.kind,
      enabled: r.enabled,
      installedAt: r.installedAt,
      category: r.category as PluginCategory
    })
    const profile = readProfileJson()
    if (profile) {
      for (const [name, spec] of Object.entries(profile.dependencies)) {
        const kind = spec.startsWith('link:') ? 'link' : 'npm'
        const bundles = profile.bundles
        const isBundle = bundles.includes(name) || bundles.includes(spec.replace(/^link:/, ''))
        upsertInstalledPlugin({
          name,
          version: '',
          spec,
          kind,
          enabled: isBundle,
          installedAt: rows.find((r) => r.name === name)?.installedAt ?? Date.now(),
          category: 'other'
        })
        known.add(name)
      }
      // 补全版本号（读 profile node_modules 的 package.json）
      const dir = resolveProfileDir()
      for (const name of known) {
        const pkgPath = join(dir, 'node_modules', name.replace('/', '/node_modules/'), 'package.json')
        if (existsSync(pkgPath)) {
          try {
            const doc = JSON.parse(readFileSync(pkgPath, 'utf-8'))
            upsertInstalledPlugin({
              name,
              version: doc.version ?? '',
              spec: profile.dependencies[name] ?? '',
              kind: (profile.dependencies[name] ?? '').startsWith('link:') ? 'link' : 'npm',
              enabled: profile.bundles.includes(name),
              installedAt: rows.find((r) => r.name === name)?.installedAt ?? Date.now(),
              category: 'other'
            })
          } catch {
            /* 忽略损坏的包 */
          }
        }
      }
    }
    return listInstalledPlugins().map(toInstalled)
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
        message: `卸载失败（exit ${result.code ?? '?'}）`,
        logTail: result.output.split(/\r?\n/).filter(Boolean).slice(-40)
      }
    }
    removeInstalledPlugin(name)
    this.syncInstalled()
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
