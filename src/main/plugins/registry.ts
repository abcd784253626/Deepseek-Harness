/**
 * 插件市场数据源
 *  - GitHub topic 检索（topic:dsh-plugin）
 *  - npm registry 检索（keywords:dsh-plugin / @deepseek-ai scope）
 *  - 逐包元数据抓取 + 依赖安全扫描
 * 结果写入 SQLite 缓存，避免触发 API 限流。
 */
import type {
  PluginCategory,
  RegistryPlugin,
  RiskFlag,
  RiskLevel
} from '@shared/types'
import { getCache, setCache } from '../store/database'

const GITHUB_SEARCH = 'https://api.github.com/search/repositories'
const NPM_SEARCH = 'https://registry.npmjs.org/-/v1/search'
const NPM_PACKAGE = (name: string): string =>
  `https://registry.npmjs.org/${encodeURIComponent(name).replace(/%2F/g, '/')}`

const UA = {
  'User-Agent': 'dsh-desktop/0.1.0',
  Accept: 'application/vnd.github+json'
}

const CACHE_TTL = 10 * 60 * 1000 // 市场列表缓存 10 分钟

export async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: UA, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export function categoryFromKeywords(keywords: string[] | undefined): PluginCategory {
  const k = new Set((keywords ?? []).map((x) => x.toLowerCase()))
  if (k.has('model') || k.has('llm') || k.has('provider')) return 'model'
  if (k.has('skill') || k.has('skills')) return 'skill'
  if (k.has('ui') || k.has('frontend') || k.has('theme')) return 'ui'
  if (k.has('sandbox') || k.has('fs') || k.has('shell') || k.has('runtime')) return 'sandbox'
  if (k.has('tool') || k.has('tools') || k.has('agent')) return 'tool'
  return 'other'
}

export function riskOf(pkg: { scripts?: Record<string, string>; license?: unknown; author?: unknown; install?: unknown }): RiskFlag[] {
  const flags: RiskFlag[] = []
  const scripts = pkg.scripts ?? {}
  const dangerous = ['install', 'postinstall', 'preinstall']
  for (const key of dangerous) {
    const script = scripts[key]
    if (script && !/^\s*(node-gyp|prebuild-install|node-pre-gyp)/.test(script)) {
      flags.push({
        kind: 'install-script',
        level: 'danger',
        message: `包声明了 ${key} 脚本（会在安装时执行任意命令）: ${script.slice(0, 80)}`
      })
    }
  }
  if (!pkg.license) {
    flags.push({ kind: 'no-license', level: 'warn', message: '未声明开源许可证，使用需自行评估风险' })
  }
  if (!pkg.author && !pkg.install) {
    flags.push({ kind: 'unknown-author', level: 'info', message: '作者信息缺失' })
  }
  return flags
}

// ─── GitHub 源 ────────────────────────────────────────────────

interface GithubRepo {
  full_name: string
  html_url: string
  description: string | null
  stargazers_count: number
  updated_at: string
  license: { spdx_id: string } | null
  archived: boolean
  owner: { login: string; type: string }
}

interface GithubSearchResult {
  items: GithubRepo[]
}

async function fetchRepoPackage(repoFullName: string): Promise<{ name: string; keywords?: string[] } | null> {
  try {
    const pkg = await fetchJson<{ name: string; keywords?: string[] }>(
      `https://raw.githubusercontent.com/${repoFullName}/HEAD/package.json`,
      8000
    )
    return pkg
  } catch {
    return null
  }
}

export async function searchGithub(): Promise<RegistryPlugin[]> {
  const cache = getCache<RegistryPlugin[]>('market:github')
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.data

  const result = await fetchJson<GithubSearchResult>(
    `${GITHUB_SEARCH}?q=topic:dsh-plugin&sort=stars&order=desc&per_page=50`
  )
  const plugins: RegistryPlugin[] = []
  for (const repo of result.items) {
    if (repo.owner.type === 'Organization' && repo.owner.login === 'deepseek-ai' && repo.full_name.includes('deepseek-harness')) {
      continue // 官方主仓库本身不是插件
    }
    const pkg = await fetchRepoPackage(repo.full_name)
    const name = pkg?.name
    if (!name || name === 'dsh' || name.startsWith('@deepseek-ai/dsh-')) {
      // 跳过同名/核心包（核心包属于内核本体，不进入市场）
      if (!name || name === 'dsh') continue
    }
    const npm = await fetchNpmMeta(name).catch(() => null)
    const license = repo.license?.spdx_id ?? npm?.license ?? null
    plugins.push({
      name,
      repo: repo.html_url,
      description: repo.description ?? npm?.description ?? '',
      stars: repo.stargazers_count,
      updatedAt: Date.parse(repo.updated_at),
      category: categoryFromKeywords(pkg?.keywords ?? npm?.keywords),
      license: license && license !== 'NOASSERTION' ? license : null,
      homepage: repo.html_url,
      npmVersion: npm?.version ?? null,
      riskFlags: [
        ...riskOf({ scripts: npm?.scripts, license: repo.license?.spdx_id, author: npm?.author }),
        ...(repo.archived ? [{ kind: 'archived' as const, level: 'warn' as RiskLevel, message: '仓库已归档，不再维护' }] : [])
      ],
      archived: repo.archived,
      source: 'github'
    })
  }
  setCache('market:github', plugins)
  return plugins
}

// ─── npm 源 ───────────────────────────────────────────────────

interface NpmSearchItem {
  package: {
    name: string
    version: string
    description: string
    keywords?: string[]
    date: string
    links?: { repository?: string; homepage?: string }
    publisher?: { username: string }
    author?: unknown
  }
  score?: { detail?: { popularity?: number } }
}

interface NpmSearchResult {
  objects: NpmSearchItem[]
}

export async function searchNpm(query = ''): Promise<RegistryPlugin[]> {
  const cacheKey = `market:npm:${query || 'default'}`
  const cache = getCache<RegistryPlugin[]>(cacheKey)
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.data

  const term = query ? `keywords:${query}` : 'keywords:dsh-plugin'
  const result = await fetchJson<NpmSearchResult>(`${NPM_SEARCH}?text=${encodeURIComponent(term)}&size=50`)
  const plugins: RegistryPlugin[] = result.objects
    .filter((o) => !o.package.name.startsWith('@deepseek-ai/dsh-') || o.package.name !== 'dsh')
    .map((o) => {
      const p = o.package
      return {
        name: p.name,
        repo: p.links?.repository ?? null,
        description: p.description ?? '',
        stars: Math.round((o.score?.detail?.popularity ?? 0) * 1000),
        updatedAt: Date.parse(p.date),
        category: categoryFromKeywords(p.keywords),
        license: null, // 由详情接口补充
        homepage: p.links?.homepage ?? null,
        npmVersion: p.version,
        riskFlags: [],
        archived: false,
        source: 'npm' as const
      }
    })
  setCache(cacheKey, plugins)
  return plugins
}

// ─── npm 包详情 ───────────────────────────────────────────────

export interface NpmMeta {
  name: string
  version: string
  description: string
  license: string | null
  keywords?: string[]
  scripts?: Record<string, string>
  author?: unknown
  homepage?: string
  repository?: string | { url?: string }
  versions: string[]
  readme?: string
}

export async function fetchNpmMeta(name: string): Promise<NpmMeta | null> {
  const cacheKey = `npm:${name}`
  const cache = getCache<NpmMeta>(cacheKey)
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) return cache.data
  try {
    const doc = await fetchJson<{
      name: string
      'dist-tags'?: { latest?: string }
      versions: Record<string, { version: string; scripts?: Record<string, string>; license?: unknown; author?: unknown; description?: string; homepage?: string }>
      readme?: string
      license?: unknown
      description?: string
      homepage?: string
    }>(NPM_PACKAGE(name))
    const latest = doc['dist-tags']?.latest ?? Object.keys(doc.versions ?? {}).at(-1) ?? ''
    const meta: NpmMeta = {
      name: doc.name,
      version: latest,
      description: doc.description ?? '',
      license: typeof doc.license === 'string' ? doc.license : null,
      keywords: [],
      scripts: doc.versions[latest]?.scripts ?? {},
      author: doc.versions[latest]?.author,
      homepage: doc.homepage,
      repository: undefined,
      versions: Object.keys(doc.versions ?? {}).sort(),
      readme: doc.readme
    }
    setCache(cacheKey, meta)
    return meta
  } catch {
    return null
  }
}

/** 市场合集（GitHub + npm 去重合并；相关性软过滤：名称/描述/keywords 含 dsh 或 deepseek） */
export async function searchMarket(query = ''): Promise<RegistryPlugin[]> {
  const [gh, npm] = await Promise.all([searchGithub(), searchNpm(query)])
  const byName = new Map<string, RegistryPlugin>()
  for (const p of [...gh, ...npm]) {
    const existing = byName.get(p.name)
    if (!existing || p.source === 'npm') byName.set(p.name, p)
  }
  let list = [...byName.values()].filter((p) => {
    const hay = `${p.name} ${p.description}`.toLowerCase()
    return hay.includes('dsh') || hay.includes('deepseek') || hay.includes('harness')
  })
  if (list.length === 0) list = [...byName.values()] // 过滤过严时回退全量
  if (query) {
    const q = query.toLowerCase()
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.includes(q)
    )
  }
  return list
}
