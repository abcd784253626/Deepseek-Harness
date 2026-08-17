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
 * 由 webview.executeJavaScript 执行：
 *  1. 同步官方暗色属性（body[data-ds-dark-theme]）与桌面主题一致 —— 系统暗色下
 *     官方默认跟随 system 变灰，这里强制统一为桌面主题的明暗
 *  2. 用我们的令牌覆盖官方语义别名令牌（--dsw-alias-*），整站与桌面壳同色调
 *  3. 注入自定义 CSS
 */
export function buildWebviewThemeScript(theme: ThemeDefinition, customCss: string): string {
  const t = theme.tokens
  const dark = theme.type === 'dark'
  // 官方 dsw 语义别名令牌 → 我们的令牌（浅色值；深色主题时用深色令牌）
  const alias = dark
    ? {
        '--dsw-alias-bg-base': t.bg,
        '--dsw-alias-bg-layer-1': t.bg,
        '--dsw-alias-bg-layer-2': t.bgElevated,
        '--dsw-alias-bg-layer-3': t.bgElevated,
        '--dsw-alias-bg-overlay': t.bgElevated,
        '--dsw-alias-bg-module-platform': t.bgSubtle,
        '--dsw-alias-bg-multi-select': t.bgSubtle,
        '--dsw-alias-bg-skeleton': t.border,
        '--dsw-alias-label-primary': t.fg,
        '--dsw-alias-label-primary-foreground': t.accentFg,
        '--dsw-alias-label-primary-inverted': t.accentFg,
        '--dsw-alias-label-secondary': t.fgSecondary,
        '--dsw-alias-label-tertiary': t.fgSecondary,
        '--dsw-alias-label-caption': t.fgDisabled,
        '--dsw-alias-label-dimmed': t.fgDisabled,
        '--dsw-alias-label-primary-dimmed': t.fgSecondary,
        '--dsw-alias-border-l1': t.border,
        '--dsw-alias-border-l2': t.border,
        '--dsw-alias-border-l2-darkmode-thin': t.border,
        '--dsw-alias-border-l3': t.border,
        '--dsw-alias-border-l4': t.border,
        '--dsw-alias-border-inverted': t.border,
        '--dsw-alias-border-inverted2': t.border,
        '--dsw-alias-brand-primary': t.accent,
        '--dsw-alias-brand-primary-new-colorprimary-new-color': t.accent,
        '--dsw-alias-brand-text': t.accent,
        '--dsw-alias-brand-primary-invert': t.accentFg,
        '--dsw-alias-button-primary-fill': t.accent,
        '--dsw-alias-button-primary-hover': t.accent,
        '--dsw-alias-button-primary-dimmed': t.bgSubtle,
        '--dsw-alias-button-contrast-fill': t.fg,
        '--dsw-alias-button-elevated-fill': t.bgElevated,
        '--dsw-alias-button-floating-fill': t.bgElevated,
        '--dsw-alias-button-floating-hover': t.bgSubtle,
        '--dsw-alias-button-info-fill': t.accent,
        '--dsw-alias-button-info-hover': t.accent,
        '--dsw-alias-button-ghost-active-fill': t.bgSubtle,
        '--dsw-alias-button-ghost-active-hover': t.bgSubtle,
        '--dsw-alias-button-ghost-active-border': t.border,
        '--dsw-alias-interactive-bg-hover': t.bgSubtle,
        '--dsw-alias-interactive-bg-active': t.bgSubtle,
        '--dsw-alias-interactive-bg-hover-accent': t.bgSubtle,
        '--dsw-alias-interactive-bg-hover-solid': t.bgSubtle,
        '--dsw-alias-markdown-code-block': t.bgSubtle,
        '--dsw-alias-markdown-code-block-banner': t.bgSubtle,
        '--dsw-alias-markdown-inline-code': t.bgSubtle,
        '--dsw-alias-markdown-citation': t.bgSubtle,
        '--dsw-alias-markdown-placeholder': t.fgDisabled,
        '--dsw-alias-markdown-code-segment-selected': t.bgElevated,
        '--dsw-alias-markdown-code-segment-unselected': t.bgSubtle
      }
    : {
        // 浅色：整体换为纯净白 + 我们的强调色
        '--dsw-alias-bg-base': t.bg,
        '--dsw-alias-bg-layer-1': t.bg,
        '--dsw-alias-bg-layer-2': t.bg,
        '--dsw-alias-bg-layer-3': t.bg,
        '--dsw-alias-bg-overlay': t.bgElevated,
        '--dsw-alias-bg-module-platform': t.bgSubtle,
        '--dsw-alias-bg-multi-select': t.bgSubtle,
        '--dsw-alias-bg-skeleton': t.border,
        '--dsw-alias-label-primary': t.fg,
        '--dsw-alias-label-primary-foreground': t.accentFg,
        '--dsw-alias-label-primary-inverted': t.accentFg,
        '--dsw-alias-label-secondary': t.fgSecondary,
        '--dsw-alias-label-tertiary': t.fgSecondary,
        '--dsw-alias-label-caption': t.fgDisabled,
        '--dsw-alias-label-dimmed': t.fgDisabled,
        '--dsw-alias-label-primary-dimmed': t.fgSecondary,
        '--dsw-alias-border-l1': t.border,
        '--dsw-alias-border-l2': t.border,
        '--dsw-alias-border-l2-darkmode-thin': t.border,
        '--dsw-alias-border-l3': t.border,
        '--dsw-alias-border-l4': t.border,
        '--dsw-alias-border-inverted': t.border,
        '--dsw-alias-border-inverted2': t.border,
        '--dsw-alias-brand-primary': t.accent,
        '--dsw-alias-brand-primary-new-colorprimary-new-color': t.accent,
        '--dsw-alias-brand-text': t.accent,
        '--dsw-alias-brand-primary-invert': t.accentFg,
        '--dsw-alias-button-primary-fill': t.accent,
        '--dsw-alias-button-primary-hover': t.accent,
        '--dsw-alias-button-primary-dimmed': t.bgSubtle,
        '--dsw-alias-button-contrast-fill': t.fg,
        '--dsw-alias-button-elevated-fill': t.bgElevated,
        '--dsw-alias-button-floating-fill': t.bgElevated,
        '--dsw-alias-button-floating-hover': t.bgSubtle,
        '--dsw-alias-button-info-fill': t.accent,
        '--dsw-alias-button-info-hover': t.accent,
        '--dsw-alias-button-ghost-active-fill': t.bgSubtle,
        '--dsw-alias-button-ghost-active-hover': t.bgSubtle,
        '--dsw-alias-button-ghost-active-border': t.border,
        '--dsw-alias-interactive-bg-hover': t.bgSubtle,
        '--dsw-alias-interactive-bg-active': t.bgSubtle,
        '--dsw-alias-interactive-bg-hover-accent': t.bgSubtle,
        '--dsw-alias-interactive-bg-hover-solid': t.bgSubtle,
        '--dsw-alias-markdown-code-block': t.bgSubtle,
        '--dsw-alias-markdown-code-block-banner': t.bgSubtle,
        '--dsw-alias-markdown-inline-code': t.bgSubtle,
        '--dsw-alias-markdown-citation': t.bgSubtle,
        '--dsw-alias-markdown-placeholder': t.fgDisabled,
        '--dsw-alias-markdown-code-segment-selected': t.bgElevated,
        '--dsw-alias-markdown-code-segment-unselected': t.bgSubtle
      }
  const decl = Object.entries(alias)
    .map(([k, v]) => `${k}: ${v};`)
    .join('\n')
  const css = `
/* 桌面主题令牌（壳层） */
:root {
  ${Object.entries(tokensToVars(t))
    .map(([k, v]) => `${k}: ${v};`)
    .join('\n')}
}
/* 官方 dsw 语义令牌统一（html body 提升优先级，压过官方样式表） */
html body {
  ${decl}
}
html body {
  background: ${t.bg} !important;
  color: ${t.fg} !important;
  font-family: ${t.fontFamily} !important;
}
${customCss}`
  const script = `(() => {
    // 官方明暗属性与桌面主题同步（清除 system 跟随导致的灰色暗色模式）
    document.body.toggleAttribute('data-ds-dark-theme', ${dark});
    document.documentElement.style.colorScheme = ${JSON.stringify(theme.type)};
    let el = document.getElementById('dsh-desktop-theme');
    if (!el) { el = document.createElement('style'); el.id = 'dsh-desktop-theme'; document.head.appendChild(el); }
    el.textContent = ${JSON.stringify(css)};
  })();`
  return script
}
