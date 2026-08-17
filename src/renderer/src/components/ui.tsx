/**
 * 极简 UI 基元：药丸按钮 / 开关 / 分段选择 / 徽章 / 弹窗
 */
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function Button({
  children,
  onClick,
  variant,
  disabled,
  small,
  title,
  className = ''
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger'
  disabled?: boolean
  small?: boolean
  title?: string
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`btn-pill ${variant === 'primary' ? 'primary' : ''} ${variant === 'danger' ? 'danger' : ''} ${small ? 'sm' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  )
}

export function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 cursor-pointer select-none"
    >
      <span
        className="inline-flex h-[18px] w-8 items-center rounded-full px-[2px] transition-colors"
        style={{ background: checked ? 'var(--accent)' : 'var(--border)' }}
      >
        <span
          className="h-[14px] w-[14px] rounded-full bg-white transition-transform"
          style={{ transform: checked ? 'translateX(14px)' : 'translateX(0)' }}
        />
      </span>
      {label && <span className="text-[13px] fg-2">{label}</span>}
    </button>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div className="inline-flex rounded-full bg-subtle p-[3px] gap-[2px]">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className="cursor-pointer rounded-full px-3 py-[3px] text-[12px] border-none transition-colors"
          style={
            opt.value === value
              ? { background: 'var(--bg-elevated)', color: 'var(--fg)', boxShadow: '0 0 0 1px var(--border)' }
              : { background: 'transparent', color: 'var(--fg-2)' }
          }
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger'
}): React.JSX.Element {
  const colors: Record<string, string> = {
    neutral: 'var(--fg-2)',
    accent: 'var(--accent)',
    success: 'var(--success)',
    warn: 'var(--fg-2)',
    danger: 'var(--danger)'
  }
  const bg: Record<string, string> = {
    neutral: 'var(--bg-subtle)',
    accent: 'color-mix(in srgb, var(--accent) 12%, transparent)',
    success: 'color-mix(in srgb, var(--success) 12%, transparent)',
    warn: 'color-mix(in srgb, var(--fg) 8%, transparent)',
    danger: 'color-mix(in srgb, var(--danger) 12%, transparent)'
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-[1px] text-[11px] whitespace-nowrap"
      style={{ color: colors[tone], background: bg[tone] }}
    >
      {children}
    </span>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 720
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  width?: number
}): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'color-mix(in srgb, var(--bg) 55%, transparent)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex max-h-[82vh] w-full flex-col overflow-hidden rounded-2xl"
        style={{ width, background: 'var(--bg-elevated)', boxShadow: '0 12px 48px color-mix(in srgb, var(--fg) 14%, transparent)' }}
      >
        <div className="flex items-center justify-between px-5 py-3">
          <h2 className="text-[14px] font-medium" style={{ color: 'var(--fg)' }}>
            {title}
          </h2>
          <button type="button" className="btn-pill sm" onClick={onClose} title="关闭 (Esc)">
            <X size={14} />
          </button>
        </div>
        <div className="hairline" />
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body
  )
}

export function EmptyState({ icon, text }: { icon: ReactNode; text: string }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 fg-3">
      {icon}
      <span className="text-[13px]">{text}</span>
    </div>
  )
}

/**
 * RangeSlider —— 非受控 + 原生 input 事件监听。
 * React 19 对受控 range input 的 onChange 存在已知问题（事件处理期间 DOM 值被
 * 受控回滚、异步 onChange 链失效），此组件用原生监听器绕开 React 事件系统，
 * 保证拖动即时生效；外部 value 变化时（非聚焦状态）同步 DOM。
 */
export function RangeSlider({
  min,
  max,
  value,
  onChange,
  className = '',
  title
}: {
  min: number
  max: number
  value: number
  onChange: (v: number) => void
  className?: string
  title?: string
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)

  // 外部值变化（如 store 刷新）时同步 DOM；聚焦拖动中不打断用户
  useEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el) {
      el.value = String(value)
    }
  }, [value])

  // 原生 input 事件直连（不依赖 React 合成事件）
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onInput = (): void => {
      onChange(Number(el.value))
    }
    el.addEventListener('input', onInput)
    return () => el.removeEventListener('input', onInput)
  }, [onChange])

  return (
    <input
      ref={ref}
      type="range"
      min={min}
      max={max}
      defaultValue={value}
      className={className}
      title={title}
    />
  )
}
