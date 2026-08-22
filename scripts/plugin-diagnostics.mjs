#!/usr/bin/env node
/**
 * 插件管理诊断工具 — 三方对账（profile manifest / node_modules 真实安装 / 应用 SQLite）
 *
 * 用法：
 *   node scripts/plugin-diagnostics.mjs                 # 人类可读报告
 *   node scripts/plugin-diagnostics.mjs --json          # JSON 输出
 *   node scripts/plugin-diagnostics.mjs --fix-cache     # 清理 plugin_cache 表
 *   node scripts/plugin-diagnostics.mjs --prune-ghosts  # 清理 DB 中的孤儿记录（需 --yes 确认）
 *   node scripts/plugin-diagnostics.mjs --prune-bundles # 清理 profile.bundles 中无依赖/无文件的幽灵挂载项（需 --yes）
 *   node scripts/plugin-diagnostics.mjs --list          # 仅列出真实安装的插件（从 node_modules）
 *   node scripts/plugin-diagnostics.mjs --sync          # 直接对 DB 执行一次 syncInstalled 语义写入
 *
 * 可选参数：
 *   --dsh-home <path>    DSH_HOME 覆盖（默认取 $DSH_HOME 或 ~/.dsh）
 *   --profile <name>     profile 名（默认 web）
 *   --db <path>          SQLite 文件路径（默认自动定位 userData/dsh-desktop.db）
 *   --yes                对 --prune-ghosts / --sync 等写操作跳过交互确认
 */
import { readFileSync, readdirSync, existsSync, statSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// .mjs 下没有 require，用 createRequire 加载 CommonJS 原生模块（better-sqlite3）
const require = createRequire(import.meta.url)

// ─── 参数解析 ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const opts = {}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--json') opts.json = true
  else if (a === '--fix-cache') opts.fixCache = true
  else if (a === '--prune-ghosts') opts.pruneGhosts = true
  else if (a === '--prune-bundles') opts.pruneBundles = true
  else if (a === '--sync') opts.sync = true
  else if (a === '--list') opts.list = true
  else if (a === '--yes') opts.yes = true
  else if (a === '--help' || a === '-h') { printHelp(); process.exit(0) }
  else if (a === '--dsh-home') opts.dshHome = argv[++i]
  else if (a === '--profile') opts.profile = argv[++i]
  else if (a === '--db') opts.db = argv[++i]
  else { console.error(`未知参数: ${a}`); printHelp(); process.exit(2) }
}

const dshHome = opts.dshHome || process.env.DSH_HOME || join(homedir(), '.dsh')
const profileName = opts.profile || 'web'
const profileDir = join(dshHome, 'profiles', profileName)
const profilePkgPath = join(profileDir, 'package.json')
const nodeModulesDir = join(profileDir, 'node_modules')
const dbPath = opts.db || resolveDbPath()

// ─── DB 路径自动定位 ───────────────────────────────────────────────────────
function resolveDbPath() {
  // Electron 默认以 productName 作为 userData 目录名；本应用 productName = "DSH Desktop"
  const appdata = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  const candidates = [
    join(appdata, 'DSH Desktop', 'dsh-desktop.db'),
    join(appdata, 'dsh-desktop', 'dsh-desktop.db'),
    join(appdata, 'com.dsh.desktop', 'dsh-desktop.db'),
    join(dshHome, 'dsh-desktop.db')
  ]
  for (const p of candidates) if (existsSync(p)) return p
  return candidates[0] // 不存在时返回第一个候选，让后续尝试打开时报清晰错误
}

// ─── 数据采集 ───────────────────────────────────────────────────────────────

/** 读 profile package.json，失败返回 null */
function readProfile() {
  if (!existsSync(profilePkgPath)) return { exists: false, path: profilePkgPath }
  try {
    const doc = JSON.parse(readFileSync(profilePkgPath, 'utf-8'))
    return {
      exists: true,
      path: profilePkgPath,
      dependencies: doc.dependencies ?? {},
      bundles: doc.dsh?.profile?.bundles ?? []
    }
  } catch (err) {
    return { exists: true, path: profilePkgPath, parseError: (err instanceof Error ? err.message : String(err)) }
  }
}

/** 扫描 node_modules 下所有 dsh- 前缀与 @scope 作用域下的 dsh 插件包（含 pnpm 软链穿透） */
function scanNodeModules(root) {
  if (!existsSync(root)) return { exists: false, dir: root, packages: [], errors: [] }
  const packages = []
  const errors = []
  const seen = new Set()

  // 顶层 node_modules
  const topEntries = safeReaddir(root)
  for (const entry of topEntries) {
    if (entry.startsWith('.')) continue
    const full = join(root, entry)
    collectPluginFromDir(full, entry, packages, errors)
    // scoped: @scope
    if (entry.startsWith('@') && safeStat(full)?.isDirectory()) {
      const scopedEntries = safeReaddir(full)
      for (const sub of scopedEntries) {
        if (sub.startsWith('.')) continue
        const scopedFull = join(full, sub)
        collectPluginFromDir(scopedFull, `${entry}/${sub}`, packages, errors)
      }
    }
  }

  // pnpm store 软链：node_modules/.pnpm/<name>@<version>/node_modules/<name>
  const pnpmStore = join(root, '.pnpm')
  if (existsSync(pnpmStore)) {
    const pnpmDirs = safeReaddir(pnpmStore)
    for (const dir of pnpmDirs) {
      const inner = join(pnpmStore, dir, 'node_modules')
      if (!existsSync(inner)) continue
      for (const sub of safeReaddir(inner)) {
        if (sub.startsWith('.')) continue
        const full = join(inner, sub)
        collectPluginFromDir(full, sub, packages, errors, /*pnpmLink=*/true)
      }
    }
  }

  return { exists: true, dir: root, packages, errors }
}

function collectPluginFromDir(dir, pkgName, packages, errors, pnpmLink = false) {
  if (!isSafePkgName(pkgName)) return
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return
  try {
    const doc = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    // 启发式：dsh 插件通常在 name 或 keywords 含 dsh/plugin；不强制，以免漏判
    const looksLikePlugin =
      pkgName.startsWith('dsh-') ||
      pkgName.includes('/dsh-') ||
      (Array.isArray(doc.keywords) && doc.keywords.some((k) => typeof k === 'string' && (k.includes('dsh') || k.includes('cordis')))) ||
      doc.cordis?.id ||
      doc.dsh
    if (!looksLikePlugin) return
    packages.push({
      name: doc.name ?? pkgName,
      version: doc.version ?? '',
      description: doc.description ?? '',
      main: doc.main ?? '',
      keywords: Array.isArray(doc.keywords) ? doc.keywords : [],
      hasCordis: !!(doc.cordis?.id || doc.dsh),
      path: dir,
      viaPnpmLink: pnpmLink,
      // 用于去重的 key
      key: pkgName
    })
  } catch (err) {
    errors.push({ pkgPath, message: err instanceof Error ? err.message : String(err) })
  }
}

const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
function isSafePkgName(n) {
  return NPM_NAME_RE.test(n) && !n.includes('..') && !n.includes('\\')
}

function safeReaddir(p) { try { return readdirSync(p) } catch { return [] } }
function safeStat(p) { try { return statSync(p) } catch { return null } }

// dsh 框架自身的核心 bundle：由 dsh 启动器自带的嵌套 node_modules 提供
// （@deepseek-ai/dsh 包内的 node_modules/@deepseek-ai/dsh-{base,web-app}），
// 它们刻意不出现在 profile 顶层 dependencies 中，但内核启动「必须」挂载，
// 否则会丢失 webServer/apiProxy/settings/sessions/tools 等核心服务而崩溃。
// 绝不能把它们当作"幽灵挂载项"误删。
const CORE_FRAMEWORK_BUNDLES = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app'
])

/** 读 SQLite DB 的 installed_plugins / plugin_cache */
function readDb(path) {
  if (!existsSync(path)) return { exists: false, path, installed: [], cache: [] }
  let Database
  try {
    Database = require('better-sqlite3')
  } catch (err) {
    return { exists: true, path, openError: 'better-sqlite3 不可用：' + (err instanceof Error ? err.message : String(err)), installed: [], cache: [] }
  }
  let db
  try {
    db = new Database(path, { readonly: true, fileMustExist: true })
  } catch (err) {
    return { exists: true, path, openError: (err instanceof Error ? err.message : String(err)), installed: [], cache: [] }
  }
  try {
    const installed = db.prepare(
      'SELECT name, version, spec, kind, enabled, installed_at AS installedAt, category FROM installed_plugins ORDER BY installed_at DESC'
    ).all().map((r) => ({ ...r, enabled: r.enabled === 1 }))
    const cache = db.prepare(
      'SELECT name, length(data) AS size, fetched_at AS fetchedAt FROM plugin_cache ORDER BY fetched_at DESC'
    ).all()
    return { exists: true, path, installed, cache }
  } catch (err) {
    return { exists: true, path, queryError: (err instanceof Error ? err.message : String(err)), installed: [], cache: [] }
  } finally {
    try { db.close() } catch { /* ignore */ }
  }
}

/** 检测并发安装迹象（pnpm lock / .pnpm-store 文件锁） */
function detectConcurrency(root) {
  const indicators = []
  const lockFile = join(root, '.pnpm-store', 'lock')
  if (existsSync(lockFile)) indicators.push({ kind: 'pnpm-store-lock', path: lockFile })
  const staging = join(root, '.pnpm', '.staging')
  if (existsSync(staging) && safeStat(staging)?.isDirectory()) {
    indicators.push({ kind: 'pnpm-staging', path: staging, note: '可能正在执行 pnpm install，需等其结束后再扫描' })
  }
  return indicators
}

// ─── 对账 ───────────────────────────────────────────────────────────────────

function buildReport(profile, nodeMods, db) {
  const profileNames = new Set(Object.keys(profile.dependencies ?? {}))
  const fsNames = new Set(nodeMods.packages.map((p) => p.key))
  const dbNames = new Set(db.installed.map((p) => p.name))

  // ghost: DB 里有但 profile 没有（除非是 builtin）
  const ghosts = db.installed.filter((p) => p.kind !== 'builtin' && !profileNames.has(p.name))
  // broken: profile 里有但 node_modules 找不到对应目录
  const broken = []
  for (const [name, spec] of Object.entries(profile.dependencies ?? {})) {
    if (!fsNames.has(name)) {
      const looksLikeLink = spec.startsWith('link:')
      broken.push({ name, spec, reason: looksLikeLink ? '本地链接路径不存在' : '依赖声明但文件缺失' })
    }
  }
  // unregistered: node_modules 有但 profile 未声明
  const unregistered = nodeMods.packages
    .filter((p) => !profileNames.has(p.key) && !dbNames.has(p.name))
    .map((p) => ({ name: p.name, version: p.version, path: p.path, viaPnpmLink: p.viaPnpmLink }))
  // metadata 解析错误
  const metaErrors = nodeMods.errors.map((e) => ({ pkg: e.pkgPath, error: e.message }))
  // 仅在 DB、仅在 fs（属于 ghost/unregistered 已涵盖）、profile 三方都在的"健康"集合
  const healthy = []
  for (const name of profileNames) {
    if (fsNames.has(name) && dbNames.has(name)) {
      const row = db.installed.find((p) => p.name === name)
      healthy.push({ name, version: row?.version ?? '', enabled: !!row?.enabled, kind: row?.kind ?? 'npm' })
    }
  }

  // bundles drift: bundles 里有但 dependencies 没有。
  // 注意：dsh 框架核心 bundle（CORE_FRAMEWORK_BUNDLES）刻意不在 dependencies 中，
  // 必须由 dsh 启动器自身提供，因此要从孤儿判定中排除，否则会误报/误删。
  const bundlesSet = new Set(profile.bundles ?? [])
  const bundlesOrphans = [...bundlesSet].filter(
    (n) => !profileNames.has(n) && !CORE_FRAMEWORK_BUNDLES.has(n)
  )

  // 计数偏差
  const fsCount = nodeMods.packages.length
  const uiCount = db.installed.filter((p) => p.kind !== 'builtin').length // UI「已安装(N)」= DB 中的非 builtin 记录数
  const bundlesCount = bundlesSet.size

  return {
    summary: {
      profileDeps: profileNames.size,
      fsInstalled: fsCount,
      dbInstalled: uiCount,
      bundles: bundlesCount,
      bundlesOrphans: bundlesOrphans.length,
      ghostsCount: ghosts.length,
      brokenCount: broken.length,
      unregisteredCount: unregistered.length,
      metaErrorsCount: metaErrors.length,
      concurrency: detectConcurrency(profileDir)
    },
    profile,
    healthy,
    ghosts,
    broken,
    unregistered,
    bundlesOrphans,
    metaErrors,
    db
  }
}

// ─── 输出 ───────────────────────────────────────────────────────────────────

function printHuman(report) {
  const { summary, profile, healthy, ghosts, broken, unregistered, metaErrors, db } = report
  const c = (color, s) => process.stdout.isTTY ? `\x1b[${color}m${s}\x1b[0m` : s
  const red = (s) => c('31', s)
  const yel = (s) => c('33', s)
  const grn = (s) => c('32', s)
  const dim = (s) => c('2', s)

  console.log('\n=== 插件管理诊断报告 ===')
  console.log(`profile:        ${profile.path ?? profilePkgPath}${profile.exists ? '' : ' ' + red('(不存在)')}`)
  console.log(`node_modules:   ${nodeModulesDir}${existsSync(nodeModulesDir) ? '' : ' ' + red('(不存在)')}`)
  console.log(`SQLite DB:      ${db.path}${db.exists ? '' : ' ' + red('(不存在)')}`)
  if (db.openError) console.log(red(`DB 打开失败: ${db.openError}`))
  if (profile.parseError) console.log(red(`profile 解析失败: ${profile.parseError}`))

  console.log('\n— 计数 —')
  console.log(`  profile 依赖声明数:     ${summary.profileDeps}`)
  console.log(`  node_modules 实际包数:  ${summary.fsInstalled}`)
  console.log(`  DB 已安装记录数 (= UI 已安装标签): ${summary.dbInstalled}`)
  console.log(`  bundles (内核挂载清单): ${summary.bundles}`)
  if (summary.bundlesOrphans > 0) console.log(yel(`  ⚠ bundles 比 dependencies 多 ${summary.bundlesOrphans} 个孤儿挂载项`))
  if (summary.profileDeps !== summary.dbInstalled || summary.profileDeps !== summary.fsInstalled) {
    console.log(red(`  ⚠ profile/DB/fs 三方计数不一致`))
  }
  if (summary.concurrency.length) {
    console.log(yel(`  ⚠ 检测到并发安装迹象:`), summary.concurrency)
  }

  console.log('\n— 健康（profile ∩ fs ∩ db）—')
  if (!healthy.length) console.log(dim('  (空)'))
  for (const p of healthy) console.log(`  ${grn('✓')} ${p.name}  ${p.version}  ${p.enabled ? '启用' : '禁用'}  (${p.kind})`)

  console.log('\n— 孤儿记录（DB 有 / profile 无）—')
  if (!ghosts.length) console.log(dim('  (无)'))
  for (const p of ghosts) console.log(`  ${red('✗')} ${p.name}  ${p.version}  spec=${p.spec}  kind=${p.kind}`)

  console.log('\n— 依赖声明但文件缺失（profile ∩ fs 缺失）—')
  if (!broken.length) console.log(dim('  (无)'))
  for (const p of broken) console.log(`  ${yel('!')} ${p.name}  spec=${p.spec}  ${p.reason}`)

  console.log('\n— bundles 孤儿挂载项（bundles 有 / dependencies 无）—')
  if (!report.bundlesOrphans?.length) console.log(dim('  (无)'))
  else for (const name of report.bundlesOrphans) console.log(`  ${yel('!')} ${name}`)

  console.log('\n— 未注册（fs 有 / profile 无 / DB 也无）—')
  if (!unregistered.length) console.log(dim('  (无)'))
  for (const p of unregistered) console.log(`  ${yel('?')} ${p.name}  ${p.version}  viaPnpmLink=${p.viaPnpmLink}`)

  console.log('\n— package.json 解析错误 —')
  if (!metaErrors.length) console.log(dim('  (无)'))
  for (const e of metaErrors) console.log(`  ${red('!')} ${e.pkg}: ${e.error}`)

  console.log('\n— 可能原因 & 修复建议 —')
  if (ghosts.length) {
    console.log(yel('  1. 孤儿记录原因：'))
    console.log('     • 用户用 dsh CLI 或其他方式卸载了插件，但应用 DB 未同步')
    console.log('     • 之前版本 syncInstalled 只增不删，已在新版本 manager.ts 修复（启动对账 + 按 profile 清理）')
    console.log('     • 建议：升级到 0.1.7+，或手动运行 `node scripts/plugin-diagnostics.mjs --prune-ghosts --yes`')
  }
  if (broken.length) {
    console.log(yel('  2. 缺失文件原因：'))
    console.log('     • pnpm install 中途失败 / node_modules 被部分清理')
    console.log('     • 建议：dsh plugin add <name> --force，或直接 pnpm install 重装')
  }
  if (report.bundlesOrphans?.length) {
    console.log(yel('  3. bundles 孤儿挂载项原因：'))
    console.log('     • profile.dsh.profile.bundles 中残留了已从 dependencies 移除的插件名')
    console.log('     • 内核启动时会尝试挂载但找不到文件，常见于手动编辑过 package.json 或跨版本升级')
    console.log(`     • 建议：编辑 ${profilePkgPath}，删除 dsh.profile.bundles 中多余的项`)
  }
  if (unregistered.length) {
    console.log(yel('  4. 未注册原因：'))
    console.log('     • 手动 cp 到 node_modules、pnpm link、git clone 后未 dsh plugin add 注册')
    console.log('     • 建议：用 dsh plugin --profile web add link:<路径> 或 --add <name>')
  }
  if (metaErrors.length) {
    console.log(yel('  5. 元数据解析失败：'))
    console.log('     • 包 package.json 损坏或编码异常')
    console.log('     • 建议：删除该包目录后重装')
  }
  if (summary.concurrency.length) {
    console.log(yel('  6. 并发安装：'))
    console.log('     • 当前可能正在安装/卸载，建议等结束后再扫描')
  }
  if (!ghosts.length && !broken.length && !unregistered.length && !metaErrors.length && !summary.concurrency.length && !(report.bundlesOrphans?.length) && !db.openError && !db.queryError) {
    console.log(grn('  一切正常，三方完全一致 ✓'))
  } else if ((db.openError || db.queryError) && !ghosts.length && !broken.length && !unregistered.length && !metaErrors.length) {
    console.log(yel('  ⚠ profile 与 node_modules 一致，但 DB 未成功打开，DB 对比被跳过'))
  }

  console.log('\n— 重新加载 / 强制刷新 —')
  console.log('  应用内：进入「插件市场」即触发 syncInstalled；可在 0.1.7+ 重启软件自动对账')
  console.log('  命令行：node scripts/plugin-diagnostics.mjs --sync           # 写一次对账语义到 DB')
  console.log('         node scripts/plugin-diagnostics.mjs --fix-cache      # 清空 plugin_cache')
  console.log('         node scripts/plugin-diagnostics.mjs --prune-ghosts --yes  # 清理 DB 孤儿')
  console.log()
}

function printJson(report) {
  console.log(JSON.stringify(report, (k, v) => {
    // 不打印 profile 完整路径避免噪音（保留 exists/parseError）
    if (k === 'path' && v && typeof v === 'string' && v === profilePkgPath) return '<profile-pkg>'
    return v
  }, 2))
}

function printHelp() {
  console.log(`用法：node scripts/plugin-diagnostics.mjs [选项]

选项：
  --json               JSON 输出
  --list               仅打印真实安装列表（node_modules）
  --fix-cache          清空 plugin_cache 表（市场搜索缓存）
  --prune-ghosts       删除 DB 中孤儿记录（需 --yes）
  --prune-bundles      清理 profile.bundles 中无依赖的幽灵挂载项（需 --yes）
  --sync               按 profile 对 DB 执行一次 syncInstalled 语义
  --dsh-home <path>    覆盖 DSH_HOME（默认 ~/.dsh）
  --profile <name>     profile 名（默认 web）
  --db <path>          覆盖 DB 路径
  --yes                跳过交互确认（用于写操作）
  -h, --help           显示帮助
`)
}

// ─── 写操作（--fix-cache / --prune-ghosts / --sync） ─────────────────────────

function openDbWritable(path) {
  let Database
  try {
    Database = require('better-sqlite3')
  } catch (err) {
    console.error('better-sqlite3 不可用：', err instanceof Error ? err.message : String(err))
    process.exit(3)
  }
  return new Database(path)
}

async function actionFixCache(report) {
  if (!report.db.exists) { console.error('DB 不存在，跳过'); return }
  if (!opts.yes) {
    console.error('清空 plugin_cache 表需要 --yes 确认')
    process.exit(2)
  }
  const db = openDbWritable(dbPath)
  try {
    const removed = db.prepare('DELETE FROM plugin_cache').run().changes
    console.log(`✓ 已清空 plugin_cache，删除 ${removed} 行`)
  } finally { db.close() }
}

async function actionPruneGhosts(report) {
  if (!report.db.exists) { console.error('DB 不存在，跳过'); return }
  if (!opts.yes) {
    console.error('清理孤儿记录需要 --yes 确认（仅删除 DB 中非 builtin 且不在 profile 的条目）')
    process.exit(2)
  }
  const ghosts = report.ghosts
  if (!ghosts.length) { console.log('无孤儿记录，跳过'); return }
  const db = openDbWritable(dbPath)
  try {
    const stmt = db.prepare('DELETE FROM installed_plugins WHERE name = ?')
    let n = 0
    db.transaction(() => { for (const g of ghosts) { stmt.run(g.name); n++ } })()
    console.log(`✓ 已清理 ${n} 条孤儿记录:`, ghosts.map((g) => g.name).join(', '))
  } finally { db.close() }
}

/**
 * 清理 profile.bundles 中无对应 dependencies 声明的幽灵挂载项。
 * 保证 bundles ⊆ dependencies：内核只挂载有依赖声明的插件，避免启动时报缺失包。
 * 写前先备份 package.json，再重写（需 --yes）。
 */
async function actionPruneBundles(report) {
  const profile = report.profile
  if (!profile.exists) { console.error('profile 不存在，跳过'); return }
  if (profile.parseError) { console.error('profile 解析失败，跳过:', profile.parseError); return }
  if (!opts.yes) {
    console.error('清理 bundles 孤儿挂载项需要 --yes 确认')
    process.exit(2)
  }
  const deps = profile.dependencies ?? {}
  const bundles = profile.bundles ?? []
  // 关键：永远不要清理 dsh 框架核心 bundle——
  // 它们不在 dependencies 中，但由 dsh 启动器自带，内核必须挂载。
  const orphans = bundles.filter((b) => !deps[b] && !CORE_FRAMEWORK_BUNDLES.has(b))
  if (!orphans.length) { console.log('bundles 中无孤儿挂载项，跳过'); return }

  // 先备份，再重写
  const bak = `${profilePkgPath}.bak-${Date.now()}`
  try {
    copyFileSync(profilePkgPath, bak)
  } catch (err) {
    console.error('备份失败，已中止以免损坏 profile:', err instanceof Error ? err.message : String(err))
    process.exit(3)
  }
  try {
    const doc = JSON.parse(readFileSync(profilePkgPath, 'utf-8'))
    doc.dsh = doc.dsh ?? {}
    doc.dsh.profile = doc.dsh.profile ?? {}
    doc.dsh.profile.bundles = bundles.filter((b) => deps[b])
    writeFileSync(profilePkgPath, JSON.stringify(doc, null, 2) + '\n', 'utf-8')
    console.log(`✓ 已清理 ${orphans.length} 个 bundles 孤儿挂载项:`, orphans.join(', '))
    console.log(`  备份文件: ${bak}`)
  } catch (err) {
    console.error('重写 profile 失败:', err instanceof Error ? err.message : String(err))
    process.exit(3)
  }
}

/** 按 profile 重新对 DB 执行 syncInstalled 语义 */
async function actionSync(report) {
  if (!report.db.exists) { console.error('DB 不存在，跳过'); return }
  if (!opts.yes) {
    console.error('--sync 需要 --yes 确认')
    process.exit(2)
  }
  const profile = report.profile
  if (!profile.exists) { console.error('profile 不存在，无法 sync'); return }
  const fsByName = new Map(report.unregistered.concat([]).map(() => [])) // 复用扫描结果
  // 直接从 node_modules 读版本
  const nodeMods = scanNodeModules(nodeModulesDir)
  const fsVersionMap = new Map(nodeMods.packages.map((p) => [p.key, p.version]))

  const bundles = new Set(profile.bundles ?? [])
  const db = openDbWritable(dbPath)
  try {
    const existing = new Map(db.prepare('SELECT name FROM installed_plugins').all().map((r) => [r.name, true]))
    const upsert = db.prepare(
      `INSERT INTO installed_plugins (name, version, spec, kind, enabled, installed_at, category)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET version = excluded.version, spec = excluded.spec,
         kind = excluded.kind, enabled = excluded.enabled, installed_at = excluded.installed_at,
         category = excluded.category`
    )
    const now = Date.now()
    let added = 0, updated = 0
    db.transaction(() => {
      for (const [name, spec] of Object.entries(profile.dependencies)) {
        const kind = spec.startsWith('link:') ? 'link' : 'npm'
        const linkName = spec.replace(/^link:/, '')
        const enabled = bundles.has(name) || bundles.has(linkName) ? 1 : 0
        const version = fsVersionMap.get(name) ?? ''
        if (existing.has(name)) updated++
        else added++
        upsert.run(name, version, spec, kind, enabled, now, 'other')
      }
    })()
    console.log(`✓ sync 完成：新增 ${added} 条，更新 ${updated} 条`)
  } finally { db.close() }
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

const profile = readProfile()
const nodeMods = scanNodeModules(nodeModulesDir)
const db = readDb(dbPath)
const report = buildReport(profile, nodeMods, db)

// --list 模式
if (opts.list) {
  console.log(`真实安装（${nodeMods.packages.length}） from ${nodeModulesDir}:`)
  for (const p of nodeMods.packages.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${p.name.padEnd(40)} ${p.version.padEnd(12)} ${p.viaPnpmLink ? '[pnpm-link]' : ''}`)
  }
  process.exit(0)
}

if (opts.json) printJson(report)
else printHuman(report)

if (opts.fixCache) await actionFixCache(report)
if (opts.pruneGhosts) await actionPruneGhosts(report)
if (opts.pruneBundles) await actionPruneBundles(report)
if (opts.sync) await actionSync(report)

process.exit(0)