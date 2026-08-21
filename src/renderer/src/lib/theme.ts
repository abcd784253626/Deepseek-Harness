/**
 * 主题应用库：ThemeDefinition → CSS 变量
 * 应用到（1）桌面壳 document；（2）内嵌官方 Web UI 的 webview 文档。
 */
import type { ThemeDefinition } from '@shared/types'

/** 壁纸路径 → dsh-img:// 原始 URL（供 Image 加载尺寸 / background-image 使用） */
export function wallpaperSrcOf(path: string | null | undefined): string | null {
  if (!path) return null
  return `dsh-img://local/${encodeURIComponent(path).replace(/%2F/gi, '/')}`
}

/** 壁纸路径 → CSS background-image 的 url(...)（空路径返回 null） */
export function wallpaperUrlOf(path: string | null | undefined): string | null {
  const src = wallpaperSrcOf(path)
  return src ? `url("${src}")` : null
}

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

/**
 * 壁纸文字颜色设置 → 实际前景色三元组。
 * 空值 = 跟随主题；否则用主文字色向背景色混合派生次级/弱化色，保持文字层级。
 */
export function resolveTextColors(
  theme: ThemeDefinition,
  textColor: string | null | undefined
): { fg: string; fgSecondary: string; fgDisabled: string } {
  const t = theme.tokens
  const c = (textColor ?? '').trim()
  if (!c) return { fg: t.fg, fgSecondary: t.fgSecondary, fgDisabled: t.fgDisabled }
  return {
    fg: c,
    fgSecondary: `color-mix(in srgb, ${c} 78%, ${t.bg})`,
    fgDisabled: `color-mix(in srgb, ${c} 52%, ${t.bg})`
  }
}

export function applyThemeToDocument(theme: ThemeDefinition, customCss: string, textColor: string = ''): void {
  const root = document.documentElement
  const vars = tokensToVars(theme.tokens)
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
  // 壁纸文字颜色覆盖（壁纸高不透明度时保证文字可读）
  const tc = resolveTextColors(theme, textColor)
  root.style.setProperty('--fg', tc.fg)
  root.style.setProperty('--fg-2', tc.fgSecondary)
  root.style.setProperty('--fg-3', tc.fgDisabled)
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
 * wallpaperUrl 非空时：body 铺壁纸背景（cover 固定），主背景令牌半透明让壁纸透出。
 */
export function buildWebviewThemeScript(
  theme: ThemeDefinition,
  customCss: string,
  wallpaperUrl: string | null = null,
  wallpaperOpacity = 40,
  alignedBg: string | null = null,
  textColor = ''
): string {
  const t = theme.tokens
  const dark = theme.type === 'dark'
  // 壁纸可见度 0-100：遮盖度 = 100 - 不透明度，与壳层 wallpaper-mask 完全一致，
  // 保证 webview 与壳层亮度统一（不设可读性地板——文字可读性交给「文字颜色」设置）。
  const opacity = Number.isFinite(Number(wallpaperOpacity)) ? Math.max(0, Math.min(100, Number(wallpaperOpacity))) : 40
  const cover = wallpaperUrl ? Math.max(0, Math.min(100, 100 - opacity)) : 100
  const cover2 = wallpaperUrl ? Math.min(100, Math.max(35, cover + 6)) : 100
  const mix = (color: string, pct: number): string =>
    wallpaperUrl ? `color-mix(in srgb, ${color} ${pct}%, transparent)` : color
  const bgBase = mix(t.bg, cover)
  const bgLayer1 = mix(t.bg, cover2)
  const bgPlatform = mix(t.bgSubtle, cover2)
  // 官方侧边栏：有壁纸时完全透明，让 frame 的半透明 bg-base 直接透出壁纸，
  // 与主内容区（中心列）保持一致的壁纸可见度；无壁纸时保持官方默认浅灰底。
  const sidebarFill = wallpaperUrl ? 'transparent' : t.bgSubtle
  // 壁纸文字颜色覆盖（空 = 跟随主题）
  const { fg, fgSecondary, fgDisabled } = resolveTextColors(theme, textColor)
  // 官方 dsw 语义别名令牌 → 我们的令牌（浅色值；深色主题时用深色令牌）
  const alias: Record<string, string> = dark
    ? {
        '--dsw-alias-bg-base': bgBase,
        '--dsw-alias-bg-layer-1': bgLayer1,
        '--dsw-alias-bg-layer-2': t.bgElevated,
        '--dsw-alias-bg-layer-3': t.bgElevated,
        '--dsw-alias-bg-overlay': t.bgElevated,
        '--dsw-alias-bg-module-platform': bgPlatform,
        '--dsw-alias-bg-multi-select': t.bgSubtle,
        '--dsw-alias-bg-skeleton': t.border,
        '--dsw-alias-label-primary': fg,
        '--dsw-alias-label-primary-foreground': t.accentFg,
        '--dsw-alias-label-primary-inverted': t.accentFg,
        '--dsw-alias-label-secondary': fgSecondary,
        '--dsw-alias-label-tertiary': fgSecondary,
        '--dsw-alias-label-caption': fgDisabled,
        '--dsw-alias-label-dimmed': fgDisabled,
        '--dsw-alias-label-primary-dimmed': fgSecondary,
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
        '--dsw-alias-button-contrast-fill': fg,
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
        '--dsw-alias-markdown-placeholder': fgDisabled,
        '--dsw-alias-markdown-code-segment-selected': t.bgElevated,
        '--dsw-alias-markdown-code-segment-unselected': t.bgSubtle
      }
    : {
        // 浅色：整体换为纯净白 + 我们的强调色
        '--dsw-alias-bg-base': bgBase,
        '--dsw-alias-bg-layer-1': bgLayer1,
        '--dsw-alias-bg-layer-2': t.bg,
        '--dsw-alias-bg-layer-3': t.bg,
        '--dsw-alias-bg-overlay': t.bgElevated,
        '--dsw-alias-bg-module-platform': bgPlatform,
        '--dsw-alias-bg-multi-select': t.bgSubtle,
        '--dsw-alias-bg-skeleton': t.border,
        '--dsw-alias-label-primary': fg,
        '--dsw-alias-label-primary-foreground': t.accentFg,
        '--dsw-alias-label-primary-inverted': t.accentFg,
        '--dsw-alias-label-secondary': fgSecondary,
        '--dsw-alias-label-tertiary': fgSecondary,
        '--dsw-alias-label-caption': fgDisabled,
        '--dsw-alias-label-dimmed': fgDisabled,
        '--dsw-alias-label-primary-dimmed': fgSecondary,
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
        '--dsw-alias-button-contrast-fill': fg,
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
        '--dsw-alias-markdown-placeholder': fgDisabled,
        '--dsw-alias-markdown-code-segment-selected': t.bgElevated,
        '--dsw-alias-markdown-code-segment-unselected': t.bgSubtle
      }
  // 官方侧边栏填充令牌（官方默认不透明，会遮住壁纸）；有壁纸时透明化露出真实壁纸
  alias['--dsw-specific-sidebar-fill'] = sidebarFill
  // !important 提升自定义属性优先级：官方暗色规则 body[data-ds-dark-theme]
  // 的特异性（0,1,1）高于 html body（0,0,2），不加 !important 会被官方暗色令牌覆盖
  const decl = Object.entries(alias)
    .map(([k, v]) => `${k}: ${v} !important;`)
    .join('\n')
  const css = `
/* 桌面主题令牌（壳层） */
:root {
  ${Object.entries(tokensToVars(t))
    .map(([k, v]) => `${k}: ${v};`)
    .join('\n')}
}
/* 官方 dsw 语义令牌统一（html body + !important，压过官方明暗两套令牌） */
html body {
  ${decl}
}
html body {
  background: ${t.bg} !important;
  color: ${fg} !important;
  font-family: ${t.fontFamily} !important;
}
${
  wallpaperUrl
    ? `/* 壁纸：与壳层对齐的一整张壁纸（alignedBg 提供对齐后的 size/position/repeat；未对齐时回退 cover+fixed） */
html body {
  background-image: ${wallpaperUrl} !important;
  ${
    alignedBg
      ? alignedBg
      : `background-size: cover !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-attachment: fixed !important;`
  }
}
/* 官方 UI 可能的滚动根容器（#root 等）让位给 body 壁纸 */
html body > #root,
html body > #app {
  background: transparent !important;
}`
    : ''
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
