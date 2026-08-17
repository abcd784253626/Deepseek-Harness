/**
 * 皮肤系统 — 主进程侧
 * 内置 3 套官方极简预设（纯净白 / 深空黑 / 护眼灰），
 * 用户主题存 SQLite，.dsh-theme 文件为 JSON 交换格式。
 *
 * 安全：令牌值在入库前统一净化（颜色/字号/字体白名单 + CSS 注入字符拒绝），
 * 因为令牌会作为 CSS 注入壳层与官方 UI 文档。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { ThemeDefinition, ThemeTokens } from '@shared/types'
import { getSettings, patchSettings, listThemes, getTheme, upsertTheme, removeTheme as dbRemoveTheme } from '../store/database'

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^(?:rgb|hsl)a?\([0-9.,\s%]+\)$|^[a-z]+$/i
const FONT_OPTIONS = new Set([
  '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif',
  '"Microsoft YaHei", "Segoe UI", sans-serif',
  '"Segoe UI", sans-serif',
  '"Consolas", "Cascadia Mono", monospace'
])
const CSS_INJECT_RE = /[{};\\]|@import|url\s*\(|expression\s*\(|<\/?style|<\/?script/i

/**
 * 净化令牌：非法值回退默认，杜绝 CSS 注入。
 * 返回 { tokens, issues } —— issues 非空时调用方应拒绝保存。
 */
export function sanitizeTokens(tokens: unknown): { tokens: ThemeTokens; issues: string[] } {
  const issues: string[] = []
  const src = (tokens && typeof tokens === 'object' ? tokens : {}) as Record<string, unknown>
  const fallback = BUILTIN_THEMES[0].tokens
  const str = (k: keyof ThemeTokens): string => {
    const v = src[k]
    return typeof v === 'string' ? v.trim() : ''
  }
  const color = (k: keyof ThemeTokens, def: string): string => {
    const v = str(k) || def
    if (!COLOR_RE.test(v) || CSS_INJECT_RE.test(v)) {
      issues.push(`令牌 ${k} 含非法字符，已回退默认`)
      return def
    }
    return v
  }
  const num = (k: 'radius' | 'fontSize', def: number, min: number, max: number): number => {
    const n = Number(src[k])
    if (!Number.isFinite(n) || n < min || n > max) {
      issues.push(`令牌 ${k} 超出范围，已回退默认`)
      return def
    }
    return Math.round(n)
  }
  let fontFamily = str('fontFamily')
  if (!fontFamily || !FONT_OPTIONS.has(fontFamily) || CSS_INJECT_RE.test(fontFamily)) {
    if (fontFamily) issues.push('字体不在白名单，已回退默认')
    fontFamily = fallback.fontFamily
  }
  return {
    tokens: {
      bg: color('bg', fallback.bg),
      bgSubtle: color('bgSubtle', fallback.bgSubtle),
      bgElevated: color('bgElevated', fallback.bgElevated),
      fg: color('fg', fallback.fg),
      fgSecondary: color('fgSecondary', fallback.fgSecondary),
      fgDisabled: color('fgDisabled', fallback.fgDisabled),
      border: color('border', fallback.border),
      accent: color('accent', fallback.accent),
      accentFg: color('accentFg', fallback.accentFg),
      danger: color('danger', fallback.danger),
      success: color('success', fallback.success),
      radius: num('radius', fallback.radius, 0, 32),
      fontSize: num('fontSize', fallback.fontSize, 10, 24),
      fontFamily
    },
    issues
  }
}

/** 净化 customCss：拒绝明显危险的 CSS 注入结构并限长 */
export function sanitizeCustomCss(css: unknown): string {
  if (typeof css !== 'string') return ''
  const trimmed = css.slice(0, 64 * 1024)
  if (/@import|expression\s*\(|<\/?script/i.test(trimmed)) return ''
  return trimmed
}

export const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    id: 'pure-white',
    name: '纯净白',
    type: 'light',
    author: 'DSH Desktop',
    description: '默认主题，对标 Codex 浅色：画布留白、黑白灰 + 单一低饱和强调色。',
    source: 'builtin',
    tokens: {
      bg: '#ffffff',
      bgSubtle: '#f7f7f5',
      bgElevated: '#ffffff',
      fg: '#1a1a1a',
      fgSecondary: '#6b6b6b',
      fgDisabled: '#b0b0b0',
      border: '#eaeae8',
      accent: '#5a67d8',
      accentFg: '#ffffff',
      danger: '#d64545',
      success: '#3d9a50',
      radius: 10,
      fontSize: 14,
      fontFamily: '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif'
    },
    customCss: ''
  },
  {
    id: 'deep-black',
    name: '深空黑',
    type: 'dark',
    author: 'DSH Desktop',
    description: '深色模式：低对比度暗色画布，适合夜间与沉浸编码。',
    source: 'builtin',
    tokens: {
      bg: '#0d0d0d',
      bgSubtle: '#151515',
      bgElevated: '#1b1b1b',
      fg: '#e8e8e6',
      fgSecondary: '#9a9a96',
      fgDisabled: '#565654',
      border: '#262624',
      accent: '#7d8cff',
      accentFg: '#0d0d0d',
      danger: '#e5534b',
      success: '#4cb963',
      radius: 10,
      fontSize: 14,
      fontFamily: '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif'
    },
    customCss: ''
  },
  {
    id: 'eye-care',
    name: '护眼灰',
    type: 'light',
    author: 'DSH Desktop',
    description: '低对比度暖灰：柔化对比、减少眩光，适合长时间阅读。',
    source: 'builtin',
    tokens: {
      bg: '#f2f1ec',
      bgSubtle: '#e9e7df',
      bgElevated: '#f8f7f3',
      fg: '#3b3b35',
      fgSecondary: '#73736a',
      fgDisabled: '#aeada3',
      border: '#dddcd2',
      accent: '#6d7a5f',
      accentFg: '#ffffff',
      danger: '#b3503f',
      success: '#5c8a5c',
      radius: 12,
      fontSize: 14,
      fontFamily: '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif'
    },
    customCss: ''
  }
]

export function allThemes(): ThemeDefinition[] {
  return [...BUILTIN_THEMES, ...listThemes().filter((t) => t.source === 'user')]
}

export function getThemeSafe(id: string): ThemeDefinition | null {
  return getTheme(id) ?? BUILTIN_THEMES.find((t) => t.id === id) ?? null
}

export function applyTheme(id: string): ThemeDefinition | null {
  const theme = getThemeSafe(id)
  if (!theme) return null
  patchSettings({ themeId: id })
  return theme
}

export function saveUserTheme(theme: ThemeDefinition): ThemeDefinition {
  const sanitized = sanitizeTokens(theme.tokens)
  const saved: ThemeDefinition = {
    ...theme,
    source: 'user',
    tokens: sanitized.tokens,
    customCss: sanitizeCustomCss(theme.customCss)
  }
  upsertTheme(saved)
  return saved
}

export function removeUserTheme(id: string): boolean {
  const theme = getTheme(id)
  if (!theme || theme.source !== 'user') return false
  dbRemoveTheme(id)
  const settings = getSettings()
  if (settings.themeId === id) patchSettings({ themeId: 'pure-white' })
  return true
}

/** 导出为 .dsh-theme（JSON 交换格式） */
export function exportTheme(id: string, filePath: string): boolean {
  const theme = getThemeSafe(id)
  if (!theme) return false
  writeFileSync(
    filePath,
    JSON.stringify(
      {
        format: 'dsh-desktop-theme',
        version: 1,
        theme
      },
      null,
      2
    ),
    'utf-8'
  )
  return true
}

/** 导入 .dsh-theme 文件 */
export function importThemeFile(filePath: string): ThemeDefinition | null {
  const doc = JSON.parse(readFileSync(filePath, 'utf-8')) as {
    format?: string
    theme?: ThemeDefinition
  }
  const theme = doc.theme
  if (!theme?.tokens) throw new Error('不是有效的 .dsh-theme 文件')
  const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const saved = saveUserTheme({
    ...theme,
    id,
    source: 'user',
    customCss: theme.customCss ?? ''
  })
  return saved
}

export function getCustomCss(): string {
  return getSettings().customCss
}

export function setCustomCss(css: string): void {
  // 显式自定义 CSS 功能保留任意性，但限长并拒绝 script 注入
  const cleaned = typeof css === 'string' ? css.slice(0, 64 * 1024) : ''
  const safe = /<\/?script/i.test(cleaned) ? cleaned.replace(/<\/?script[^>]*>/gi, '') : cleaned
  patchSettings({ customCss: safe })
}
