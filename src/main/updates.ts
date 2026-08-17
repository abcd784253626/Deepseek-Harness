/**
 * 官方版本实时更新检查
 * 对比本地 @deepseek-ai/dsh 与 npm registry 最新版本。
 */
import { fetchJson } from './plugins/registry'

export interface UpdateCheckResult {
  local: string | null
  latest: string | null
  outdated: boolean
  publishedAt: string | null
  error: string | null
}

export async function checkDshUpdate(localVersion: string | null): Promise<UpdateCheckResult> {
  try {
    const doc = await fetchJson<{
      'dist-tags'?: { latest?: string }
      time?: Record<string, string>
    }>('https://registry.npmjs.org/@deepseek-ai/dsh')
    const latest = doc['dist-tags']?.latest ?? null
    const publishedAt = latest ? doc.time?.[latest] ?? null : null
    if (!localVersion || !latest) {
      return { local: localVersion, latest, outdated: false, publishedAt, error: null }
    }
    const outdated = compareVersions(localVersion, latest) < 0
    return { local: localVersion, latest, outdated, publishedAt, error: null }
  } catch (err) {
    return {
      local: localVersion,
      latest: null,
      outdated: false,
      publishedAt: null,
      error: (err as Error).message
    }
  }
}

/** 语义化版本比较：rc 后缀视为低于正式版 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string): Array<number | string> =>
    v.replace(/^v/, '').split(/[-+.]/).map((part) => {
      const n = Number(part)
      return Number.isNaN(n) ? part : n
    })
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    if (typeof x === 'number') return 1 // 数字段 > 文本段（如 0.1.0 > 0.1.0-rc.6? 需谨慎）
    if (typeof y === 'number') return -1
    return x < y ? -1 : 1
  }
  return 0
}
