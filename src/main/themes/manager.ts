/**
 * 皮肤系统 — 主进程侧
 * 内置 3 套官方极简预设（纯净白 / 深空黑 / 护眼灰），
 * 用户主题存 SQLite，.dsh-theme 文件为 JSON 交换格式。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { ThemeDefinition } from '@shared/types'
import { getSettings, patchSettings, listThemes, getTheme, upsertTheme, removeTheme as dbRemoveTheme } from '../store/database'

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
  const saved: ThemeDefinition = { ...theme, source: 'user' }
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
  patchSettings({ customCss: css })
}
