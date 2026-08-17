/**
 * 主题设置页
 * 预设主题（纯净白/深空黑/护眼灰）+ 可视化编辑器（即时预览，零编译）
 * + .dsh-theme 导入导出 + 自定义 CSS 注入 + 跟随系统
 */
import { useEffect, useMemo, useState } from 'react'
import { Palette, Download, Upload, Trash2, Check, Plus, Monitor } from 'lucide-react'
import { useApp } from '../stores/app'
import { applyThemeToDocument, tokensToVars } from '../lib/theme'
import { Badge, Button, RangeSlider, Segmented, Switch } from '../components/ui'
import type { ThemeDefinition, ThemeTokens } from '@shared/types'

const TOKEN_META: Array<{ key: keyof ThemeTokens; label: string }> = [
  { key: 'bg', label: '主背景' },
  { key: 'bgSubtle', label: '次级背景' },
  { key: 'bgElevated', label: '浮层背景' },
  { key: 'fg', label: '主文本' },
  { key: 'fgSecondary', label: '次级文本' },
  { key: 'fgDisabled', label: '禁用文本' },
  { key: 'border', label: '分割线' },
  { key: 'accent', label: '强调色' },
  { key: 'danger', label: '危险色' },
  { key: 'success', label: '成功色' }
]

const FONT_OPTIONS = [
  '"Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif',
  '"Microsoft YaHei", "Segoe UI", sans-serif',
  '"Segoe UI", sans-serif',
  '"Consolas", "Cascadia Mono", monospace'
]

function ColorRow({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-[12px] fg-2">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-8 cursor-pointer rounded border-none bg-transparent p-0"
      />
      <input
        className="input-pill !w-24 !py-1 text-[12px] font-mono"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      <span className="h-4 w-10 rounded-full border" style={{ background: value, borderColor: 'var(--border)' }} />
    </div>
  )
}

export function ThemesPage(): React.JSX.Element {
  const { themes, settings, customCss, activeTheme, refreshThemes, applyThemeById, saveSettings, setCustomCss } = useApp()

  // 编辑器草稿：编辑中实时预览，不落库
  const [draft, setDraft] = useState<ThemeDefinition | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void refreshThemes()
  }, [refreshThemes])

  // 跟随系统
  const [systemDark, setSystemDark] = useState(false)
  useEffect(() => {
    void window.dsh.themes.systemTheme().then((t) => setSystemDark(t === 'dark'))
  }, [])

  const startEdit = (theme: ThemeDefinition): void => {
    setEditingId(theme.id)
    setDraft({ ...theme, tokens: { ...theme.tokens } })
  }

  const patchDraft = (patch: Partial<ThemeTokens>): void => {
    if (!draft) return
    const next = { ...draft, tokens: { ...draft.tokens, ...patch } }
    setDraft(next)
    // 即时预览（不落库）
    applyThemeToDocument(next, customCss)
  }

  const saveDraft = async (): Promise<void> => {
    if (!draft) return
    const saved = await window.dsh.themes.save(draft)
    await refreshThemes()
    await window.dsh.settings.set({ themeId: saved.id, followSystemTheme: false })
    setEditingId(null)
    setDraft(null)
    setNotice(`主题「${saved.name}」已保存并应用`)
  }

  const importTheme = async (): Promise<void> => {
    const result = await window.dsh.themes.import()
    if (result && !('error' in result)) {
      await refreshThemes()
      setNotice(`已导入主题「${result.name}」，可在列表中应用`)
    } else if (result && 'error' in result) {
      setNotice(`导入失败: ${result.error}`)
    }
  }

  const toggleFollow = async (v: boolean): Promise<void> => {
    await saveSettings({ followSystemTheme: v })
    await refreshThemes()
  }

  const previewSwatch = useMemo(() => {
    const t = draft ?? activeTheme
    if (!t) return null
    const v = tokensToVars(t.tokens)
    return { bg: v['--bg'], accent: v['--accent'], fg: v['--fg'], border: v['--border'] }
  }, [draft, activeTheme])

  return (
    <div className="flex h-full">
      {/* 左：主题列表 */}
      <div className="flex w-[300px] shrink-0 flex-col border-r" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[13px] font-medium" style={{ color: 'var(--fg)' }}>主题</span>
          <div className="flex items-center gap-1">
            <Switch checked={settings?.followSystemTheme ?? true} onChange={toggleFollow} />
            <span className="text-[11px] fg-2">跟随系统</span>
            {settings?.followSystemTheme && <Monitor size={12} className="fg-3" />}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {themes.map((theme) => {
            const isActive = draft ? editingId === theme.id : theme.id === activeTheme?.id
            return (
              <div
                key={theme.id}
                className="mb-1.5 cursor-pointer rounded-xl border px-3 py-2.5"
                style={{
                  borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                  background: isActive ? 'color-mix(in srgb, var(--accent) 5%, transparent)' : 'transparent'
                }}
                onClick={() => startEdit(theme)}
              >
                <div className="flex items-center gap-2">
                  <span className="flex gap-1">
                    <span className="h-3 w-3 rounded-full" style={{ background: theme.tokens.bg, boxShadow: `inset 0 0 0 1px ${theme.tokens.border}` }} />
                    <span className="h-3 w-3 rounded-full" style={{ background: theme.tokens.accent }} />
                    <span className="h-3 w-3 rounded-full" style={{ background: theme.tokens.fg }} />
                  </span>
                  <span className="flex-1 truncate text-[13px]" style={{ color: 'var(--fg)' }}>{theme.name}</span>
                  {theme.id === activeTheme?.id && !draft && <Check size={12} className="text-accent" />}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <Badge tone={theme.type === 'dark' ? 'accent' : 'neutral'}>{theme.type === 'dark' ? '深色' : '浅色'}</Badge>
                  {theme.source === 'builtin' ? <span className="text-[10px] fg-3">内置</span> : <span className="text-[10px] fg-3">自定义 · {theme.author}</span>}
                </div>
              </div>
            )
          })}
          <div className="flex gap-1 px-1 pt-1">
            <Button small onClick={() => void importTheme()} title="导入 .dsh-theme">
              <Upload size={12} /> 导入
            </Button>
            <Button small disabled={!activeTheme} onClick={() => void window.dsh.themes.export(activeTheme!.id)} title="导出当前主题">
              <Download size={12} /> 导出
            </Button>
          </div>
        </div>
      </div>

      {/* 右：编辑器 */}
      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        {notice && <div className="mb-3 rounded-xl px-3 py-2 text-[12px]" style={{ color: 'var(--success)', background: 'color-mix(in srgb, var(--success) 8%, transparent)' }}>{notice}</div>}

        {!draft && (
          <div className="flex h-full flex-col items-center justify-center gap-3 fg-3">
            <Palette size={22} />
            <span className="text-[13px]">选择左侧主题开始编辑，修改即时预览</span>
            <span className="text-[11px]">主题以 CSS 变量驱动，导出为 .dsh-theme 即可分享复用</span>
          </div>
        )}

        {draft && (
          <div className="flex max-w-[640px] flex-col gap-5">
            <div className="flex items-center gap-3">
              <input
                className="input-pill !w-40"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="主题名称"
              />
              <Segmented
                options={[
                  { value: 'light', label: '浅色' },
                  { value: 'dark', label: '深色' }
                ]}
                value={draft.type}
                onChange={(v) => setDraft({ ...draft, type: v })}
              />
              <div className="flex-1" />
              <Button small variant="primary" onClick={() => void saveDraft()}>
                <Check size={12} /> {editingId?.startsWith('user-') ? '保存修改' : '保存为新主题'}
              </Button>
              <Button small onClick={() => { setDraft(null); setEditingId(null); if (activeTheme) applyThemeToDocument(activeTheme, customCss) }}>
                取消
              </Button>
            </div>

            {/* 实时预览卡 */}
            {previewSwatch && (
              <div
                className="rounded-2xl border p-4"
                style={{ background: previewSwatch.bg, borderColor: previewSwatch.border, color: previewSwatch.fg }}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: previewSwatch.accent }} />
                  <span className="text-[13px] font-medium">DSH Desktop 预览</span>
                  <span className="flex-1" />
                  <span className="rounded-full px-2 py-[1px] text-[11px]" style={{ background: previewSwatch.accent, color: draft.type === 'dark' ? '#0d0d0d' : '#fff' }}>
                    药丸按钮
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 text-[12px]" style={{ color: 'var(--fg-2)' }}>
                  <span>次级文本</span>
                  <span style={{ color: 'var(--fg-3)' }}>禁用文本</span>
                  <span className="flex-1" />
                  <span className="rounded-full bg-subtle px-3 py-1 text-[12px]" style={{ color: 'var(--fg)' }}>输入框</span>
                </div>
              </div>
            )}

            {/* 颜色令牌 */}
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-medium fg-2">颜色令牌</span>
              {TOKEN_META.map((meta) => (
                <ColorRow
                  key={meta.key}
                  label={meta.label}
                  value={String(draft.tokens[meta.key])}
                  onChange={(v) => patchDraft({ [meta.key]: v } as Partial<ThemeTokens>)}
                />
              ))}
            </div>

            {/* 形状与排版 */}
            <div className="flex flex-col gap-2">
              <span className="text-[12px] font-medium fg-2">形状与排版</span>
              <div className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-[12px] fg-2">圆角</span>
                <RangeSlider
                  min={0}
                  max={24}
                  value={draft.tokens.radius}
                  onChange={(v) => patchDraft({ radius: v })}
                  className="flex-1 accent-[var(--accent)]"
                />
                <span className="w-12 text-[12px] font-mono fg-2">{draft.tokens.radius}px</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-[12px] fg-2">基准字号</span>
                <RangeSlider
                  min={12}
                  max={18}
                  value={draft.tokens.fontSize}
                  onChange={(v) => patchDraft({ fontSize: v })}
                  className="flex-1 accent-[var(--accent)]"
                />
                <span className="w-12 text-[12px] font-mono fg-2">{draft.tokens.fontSize}px</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-[12px] fg-2">字体</span>
                <select
                  className="input-pill !py-1 text-[12px]"
                  value={draft.tokens.fontFamily}
                  onChange={(e) => patchDraft({ fontFamily: e.target.value })}
                >
                  {FONT_OPTIONS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>
            </div>

            {draft.source === 'user' && (
              <div className="flex items-center gap-2">
                <Button small variant="danger" onClick={async () => {
                  await window.dsh.themes.remove(draft.id)
                  await refreshThemes()
                  setDraft(null)
                  setEditingId(null)
                }}>
                  <Trash2 size={12} /> 删除该主题
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
