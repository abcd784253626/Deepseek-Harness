/**
 * 用量跟踪 — 读取官方内核的会话投影缓存（$DSH_HOME/storages/session_projcache.json）
 * 聚合每个会话的 tokenUsage（输入 / 缓存命中 / 输出），按可配置计价折算估算金额，
 * 监听缓存文件变化并推送更新。文件由内核原子写入，缺失/损坏时回退空数据，绝不抛错。
 */
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { basename, join, normalize } from 'node:path'
import { homedir } from 'node:os'
import { getSettings } from '../store/database'
import type { UsageCost, UsageSummary, UsageTotals } from '@shared/types'

/** 投影缓存文件的顶层结构（内核 dsh-session-projection-cache 的落盘格式） */
interface ProjCacheFile {
  tables?: {
    sessions?: Record<
      string,
      {
        identity?: { createdAt?: number; cwd?: string }
        rows?: {
          tokenUsage?: {
            val?: {
              totals?: {
                uncachedInputTokens?: number
                cacheReadTokens?: number
                cacheWriteTokens?: number
                outputTokens?: number
              }
            }
          }
          title?: { val?: string | null }
          sessionListMetadata?: { val?: { lastPromptAt?: number | null } }
        }
      }
    >
  }
}

const zeroTotals = (): UsageTotals => ({ inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 })
const zeroCost = (): UsageCost => ({ input: 0, cacheRead: 0, output: 0, total: 0 })

function toNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

/** 归一化工作区路径：统一分隔符、去尾部斜杠 */
function normalizeCwd(cwd: string): string {
  const n = normalize(cwd).replace(/[\\/]+$/, '')
  return n || cwd
}

function costOf(totals: UsageTotals, pricing: { input: number; cacheRead: number; output: number }): UsageCost {
  const input = (totals.inputTokens / 1e6) * pricing.input
  const cacheRead = (totals.cacheReadTokens / 1e6) * pricing.cacheRead
  const output = (totals.outputTokens / 1e6) * pricing.output
  return { input, cacheRead, output, total: input + cacheRead + output }
}

function addTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    outputTokens: a.outputTokens + b.outputTokens
  }
}

function addCost(a: UsageCost, b: UsageCost): UsageCost {
  return {
    input: a.input + b.input,
    cacheRead: a.cacheRead + b.cacheRead,
    output: a.output + b.output,
    total: a.total + b.total
  }
}

/** 投影缓存路径（与 IPC app.info 的 dshHome 解析保持一致） */
function cachePath(): string {
  const settings = getSettings()
  const home = settings.dshHomeOverride || join(homedir(), '.dsh')
  return join(home, 'storages', 'session_projcache.json')
}

function readCache(): ProjCacheFile | null {
  const path = cachePath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ProjCacheFile
  } catch {
    return null
  }
}

export class UsageTracker extends EventEmitter {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private lastSummary: UsageSummary | null = null
  private error: string | null = null

  /** 计算当前用量汇总（失败返回空汇总而非抛错） */
  compute(): UsageSummary {
    const pricing = {
      input: getSettings().usagePriceInput,
      cacheRead: getSettings().usagePriceCache,
      output: getSettings().usagePriceOutput
    }
    const generatedAt = Date.now()
    const empty: UsageSummary = {
      generatedAt,
      today: { totals: zeroTotals(), cost: zeroCost() },
      total: { totals: zeroTotals(), cost: zeroCost() },
      workspaces: [],
      sessions: [],
      sessionCount: 0,
      pricing
    }
    const cache = readCache()
    if (!cache?.tables?.sessions) {
      this.error = cache ? '会话缓存结构异常' : null
      this.lastSummary = empty
      return empty
    }
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const todayStart = startOfToday.getTime()

    const sessions: UsageSummary['sessions'] = []
    const byWorkspace = new Map<string, { totals: UsageTotals; cost: UsageCost; count: number }>()
    let todayTotals = zeroTotals()
    let todayCost = zeroCost()
    let allTotals = zeroTotals()
    let allCost = zeroCost()

    for (const [id, entry] of Object.entries(cache.tables.sessions)) {
      const identity = entry?.identity ?? {}
      const rows = entry?.rows ?? {}
      const totalsVal = rows.tokenUsage?.val?.totals
      if (!totalsVal) continue
      const totals: UsageTotals = {
        // 未命中缓存 + 写入缓存均按“输入”计价
        inputTokens: toNum(totalsVal.uncachedInputTokens) + toNum(totalsVal.cacheWriteTokens),
        cacheReadTokens: toNum(totalsVal.cacheReadTokens),
        outputTokens: toNum(totalsVal.outputTokens)
      }
      const lastPromptAt = toNum(rows.sessionListMetadata?.val?.lastPromptAt) || null
      const createdAt = toNum(identity.createdAt) || generatedAt
      // 只统计真正用过的会话（发过提示或产生过 tokens）
      const hasUsage = totals.inputTokens + totals.cacheReadTokens + totals.outputTokens > 0
      const hasActivity = lastPromptAt !== null
      if (!hasUsage && !hasActivity) continue

      const cost = costOf(totals, pricing)
      allTotals = addTotals(allTotals, totals)
      allCost = addCost(allCost, cost)
      const activeToday = lastPromptAt !== null ? lastPromptAt >= todayStart : createdAt >= todayStart
      if (activeToday) {
        todayTotals = addTotals(todayTotals, totals)
        todayCost = addCost(todayCost, cost)
      }

      const cwd = normalizeCwd(typeof identity.cwd === 'string' && identity.cwd ? identity.cwd : '')
      const bucket = byWorkspace.get(cwd)
      if (bucket) {
        bucket.totals = addTotals(bucket.totals, totals)
        bucket.cost = addCost(bucket.cost, cost)
        bucket.count += 1
      } else {
        byWorkspace.set(cwd, { totals, cost, count: 1 })
      }

      sessions.push({
        id,
        title: typeof rows.title?.val === 'string' && rows.title.val ? rows.title.val : null,
        cwd,
        createdAt,
        lastPromptAt,
        totals,
        cost
      })
    }

    sessions.sort((a, b) => (b.lastPromptAt ?? b.createdAt) - (a.lastPromptAt ?? a.createdAt))
    const workspaces = [...byWorkspace.entries()]
      .map(([path, v]) => ({
        path,
        label: path ? basename(path) : '（未知工作区）',
        sessionCount: v.count,
        totals: v.totals,
        cost: v.cost
      }))
      .sort((a, b) => b.cost.total - a.cost.total)

    this.error = null
    this.lastSummary = {
      generatedAt,
      today: { totals: todayTotals, cost: todayCost },
      total: { totals: allTotals, cost: allCost },
      workspaces,
      sessions,
      sessionCount: sessions.length,
      pricing
    }
    return this.lastSummary
  }

  /** 当前汇总（每次读取最新缓存计算；文件缺失时返回空汇总） */
  summary(): UsageSummary {
    return this.compute()
  }

  lastError(): string | null {
    return this.error
  }

  /** 开始监听投影缓存（文件原子替换/内容变更均触发，去抖后推送） */
  start(): void {
    this.stop()
    const dir = join(cachePath(), '..')
    if (existsSync(dir)) {
      try {
        this.watcher = watch(dir, { persistent: false }, () => this.schedule())
        return
      } catch {
        /* 目录不可监听时退化为轮询 */
      }
    }
    // 目录尚不存在（内核未运行过）或不可监听 → 轮询兜底
    this.timer = setInterval(() => this.schedule(), 30_000)
  }

  stop(): void {
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch {
        /* ignore */
      }
      this.watcher = null
    }
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      const summary = this.compute()
      this.emit('update', summary)
    }, 500)
  }
}

/** 全局单例（主进程） */
export const usageTracker = new UsageTracker()
