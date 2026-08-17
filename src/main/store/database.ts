/**
 * 本地存储 — better-sqlite3
 * 存储主题、插件列表、工作区、设置；与官方 DSH 配置（YAML/JSON）互不干扰。
 */
import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type {
  AgentMode,
  DesktopSettings,
  ThemeDefinition,
  WorkspaceInfo
} from '@shared/types'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  db = new Database(join(dir, 'dsh-desktop.db'))
  db.pragma('journal_mode = WAL')
  migrate(db)
  return db
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      path        TEXT NOT NULL,
      dsh_home    TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS installed_plugins (
      name        TEXT PRIMARY KEY,
      version     TEXT NOT NULL,
      spec        TEXT NOT NULL,
      kind        TEXT NOT NULL DEFAULT 'npm',
      enabled     INTEGER NOT NULL DEFAULT 1,
      installed_at INTEGER NOT NULL,
      category    TEXT NOT NULL DEFAULT 'other'
    );

    CREATE TABLE IF NOT EXISTS themes (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL,
      author      TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      source      TEXT NOT NULL DEFAULT 'user',
      tokens      TEXT NOT NULL,
      custom_css  TEXT NOT NULL DEFAULT '',
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plugin_cache (
      name      TEXT PRIMARY KEY,
      data      TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
  `)
}

// ─── 设置 ─────────────────────────────────────────────────────

const DEFAULT_SETTINGS: DesktopSettings = {
  followSystemTheme: true,
  themeId: 'pure-white',
  autoStartKernel: true,
  minimizeToTray: true,
  kernelPort: 0,
  dshPathOverride: '',
  dshHomeOverride: '',
  lastWorkspaceId: '',
  lastMode: 'standard',
  customCss: ''
}

export function getSettings(): DesktopSettings {
  const d = getDb()
  const rows = d.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string
    value: string
  }>
  const merged: DesktopSettings = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    try {
      ;(merged as unknown as Record<string, unknown>)[row.key] = JSON.parse(row.value)
    } catch {
      /* 忽略损坏项 */
    }
  }
  return merged
}

export function patchSettings(patch: Partial<DesktopSettings>): DesktopSettings {
  const d = getDb()
  const stmt = d.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const tx = d.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      stmt.run(key, JSON.stringify(value))
    }
  })
  tx()
  return getSettings()
}

// ─── 工作区 ───────────────────────────────────────────────────

export function listWorkspaces(): WorkspaceInfo[] {
  const d = getDb()
  return (
    d
      .prepare(
        'SELECT id, name, path, dsh_home AS dshHome, created_at AS createdAt, last_used_at AS lastUsedAt FROM workspaces ORDER BY last_used_at DESC'
      )
      .all() as WorkspaceInfo[]
  )
}

export function getWorkspace(id: string): WorkspaceInfo | null {
  const d = getDb()
  return (
    (d
      .prepare(
        'SELECT id, name, path, dsh_home AS dshHome, created_at AS createdAt, last_used_at AS lastUsedAt FROM workspaces WHERE id = ?'
      )
      .get(id) as WorkspaceInfo | undefined) ?? null
  )
}

export function createWorkspace(info: Omit<WorkspaceInfo, 'createdAt' | 'lastUsedAt'>): WorkspaceInfo {
  const d = getDb()
  const now = Date.now()
  const row: WorkspaceInfo = { ...info, createdAt: now, lastUsedAt: now }
  d.prepare(
    'INSERT INTO workspaces (id, name, path, dsh_home, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(row.id, row.name, row.path, row.dshHome, row.createdAt, row.lastUsedAt)
  return row
}

export function updateWorkspace(
  id: string,
  patch: Partial<Pick<WorkspaceInfo, 'name' | 'path' | 'dshHome'>>
): WorkspaceInfo | null {
  const d = getDb()
  const existing = getWorkspace(id)
  if (!existing) return null
  const next = { ...existing, ...patch }
  d.prepare('UPDATE workspaces SET name = ?, path = ?, dsh_home = ? WHERE id = ?').run(
    next.name,
    next.path,
    next.dshHome,
    id
  )
  return getWorkspace(id)
}

export function touchWorkspace(id: string): void {
  getDb().prepare('UPDATE workspaces SET last_used_at = ? WHERE id = ?').run(Date.now(), id)
}

export function removeWorkspace(id: string): void {
  getDb().prepare('DELETE FROM workspaces WHERE id = ?').run(id)
}

// ─── 插件 ─────────────────────────────────────────────────────

export interface InstalledPluginRow {
  name: string
  version: string
  spec: string
  kind: 'npm' | 'link' | 'builtin'
  enabled: boolean
  installedAt: number
  category: string
}

export function listInstalledPlugins(): InstalledPluginRow[] {
  const d = getDb()
  return (
    d
      .prepare(
        'SELECT name, version, spec, kind, enabled, installed_at AS installedAt, category FROM installed_plugins ORDER BY installed_at DESC'
      )
      .all() as Array<{
        name: string
        version: string
        spec: string
        kind: 'npm' | 'link' | 'builtin'
        enabled: number
        installedAt: number
        category: string
      }>
  ).map((r) => ({ ...r, enabled: r.enabled === 1 }))
}

export function upsertInstalledPlugin(row: InstalledPluginRow): void {
  getDb()
    .prepare(
      `INSERT INTO installed_plugins (name, version, spec, kind, enabled, installed_at, category)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET version = excluded.version, spec = excluded.spec,
         kind = excluded.kind, enabled = excluded.enabled, installed_at = excluded.installed_at,
         category = excluded.category`
    )
    .run(row.name, row.version, row.spec, row.kind, row.enabled ? 1 : 0, row.installedAt, row.category)
}

export function setPluginEnabled(name: string, enabled: boolean): void {
  getDb().prepare('UPDATE installed_plugins SET enabled = ? WHERE name = ?').run(enabled ? 1 : 0, name)
}

export function removeInstalledPlugin(name: string): void {
  getDb().prepare('DELETE FROM installed_plugins WHERE name = ?').run(name)
}

// ─── 主题 ─────────────────────────────────────────────────────

export function listThemes(): ThemeDefinition[] {
  const d = getDb()
  const rows = d
    .prepare(
      'SELECT id, name, type, author, description, source, tokens, custom_css AS customCss FROM themes ORDER BY created_at'
    )
    .all() as Array<{
    id: string
    name: string
    type: string
    author: string
    description: string
    source: string
    tokens: string
    customCss: string
  }>
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type as 'light' | 'dark',
    author: r.author,
    description: r.description,
    source: r.source as 'builtin' | 'user',
    tokens: JSON.parse(r.tokens),
    customCss: r.customCss
  }))
}

export function getTheme(id: string): ThemeDefinition | null {
  return listThemes().find((t) => t.id === id) ?? null
}

export function upsertTheme(theme: ThemeDefinition): void {
  getDb()
    .prepare(
      `INSERT INTO themes (id, name, type, author, description, source, tokens, custom_css, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type,
         author = excluded.author, description = excluded.description,
         tokens = excluded.tokens, custom_css = excluded.custom_css`
    )
    .run(
      theme.id,
      theme.name,
      theme.type,
      theme.author,
      theme.description,
      theme.source,
      JSON.stringify(theme.tokens),
      theme.customCss,
      Date.now()
    )
}

export function removeTheme(id: string): void {
  getDb().prepare('DELETE FROM themes WHERE id = ?').run(id)
}

// ─── 插件市场缓存 ─────────────────────────────────────────────

export function getCache<T>(name: string): { data: T; fetchedAt: number } | null {
  const row = getDb()
    .prepare('SELECT data, fetched_at AS fetchedAt FROM plugin_cache WHERE name = ?')
    .get(name) as { data: string; fetchedAt: number } | undefined
  if (!row) return null
  try {
    return { data: JSON.parse(row.data) as T, fetchedAt: row.fetchedAt }
  } catch {
    return null
  }
}

export function setCache(name: string, data: unknown): void {
  getDb()
    .prepare(
      'INSERT INTO plugin_cache (name, data, fetched_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at'
    )
    .run(name, JSON.stringify(data), Date.now())
}

// ─── 便捷 ─────────────────────────────────────────────────────

export function resolveModeId(id: AgentMode): void {
  /* 类型占位，防止未使用告警 */
}
