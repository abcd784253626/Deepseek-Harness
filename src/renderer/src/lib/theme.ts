/**
 * 主题应用库：ThemeDefinition → CSS 变量
 * 应用到（1）桌面壳 document；（2）内嵌官方 Web UI 的 webview 文档。
 */
import type { ThemeDefinition } from '@shared/types'

export function tokensToVars(t: ThemeDefinition['tokens']): Record<string, string> {
  return {
    '--bg': t.bg,
    '--bg-subtle': t.bgSubtle,
    '--bg-elevated': t.bgElevated,
    '--fg': t.fg,
    '--fg-2': t.fgSecondary,
    '--fg-3': t.fgDisabled,
    '--border': t.border,
    '--accent': t.accent,
    '--accent-fg': t.accentFg,
    '--danger': t.danger,
    '--success': t.success,
    '--radius': `${t.radius}px`,
    '--font-size': `${t.fontSize}px`,
    '--font-family': t.fontFamily
  }
}

export function applyThemeToDocument(theme: ThemeDefinition, customCss: string): void {
  const root = document.documentElement
  const vars = tokensToVars(theme.tokens)
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
  root.dataset.themeType = theme.type
  root.style.colorScheme = theme.type
  // 全局自定义 CSS 注入
  let styleEl = document.getElementById('dsh-custom-css') as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'dsh-custom-css'
    document.head.appendChild(styleEl)
  }
  styleEl.textContent = customCss
}

/**
 * 注入到官方 Web UI（webview）文档的样式脚本。
 * 由 webview.executeJavaScript 执行：设置 CSS 变量 + 暗色偏好 + 自定义 CSS。
 */
export function buildWebviewThemeScript(theme: ThemeDefinition, customCss: string): string {
  const vars = tokensToVars(theme.tokens)
  const decl = Object.entries(vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join('\n')
  const css = `
:root {
  ${decl}
}
html, body {
  background: ${theme.tokens.bg} !important;
  color: ${theme.tokens.fg} !important;
  font-family: ${theme.tokens.fontFamily} !important;
}
${theme.type === 'dark' ? `html { filter: none; }` : ''}
${customCss}`
  const script = `(() => {
    let el = document.getElementById('dsh-desktop-theme');
    if (!el) { el = document.createElement('style'); el.id = 'dsh-desktop-theme'; document.head.appendChild(el); }
    el.textContent = ${JSON.stringify(css)};
    document.documentElement.style.colorScheme = ${JSON.stringify(theme.type)};
  })();`
  return script
}
