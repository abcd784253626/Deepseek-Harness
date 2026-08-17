/**
 * 自定义标题栏
 * 无边框窗口的拖拽区与窗口控制按钮；按钮样式跟随主题。
 */
import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { useApp } from '../stores/app'

export function TitleBar(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const page = useApp((s) => s.page)

  useEffect(() => {
    void window.dsh.app.isMaximized().then(setMaximized)
    return window.dsh.app.onMaximized(setMaximized)
  }, [])

  return (
    <div
      className="drag-region flex h-9 shrink-0 items-center justify-between px-2"
      style={{ background: 'var(--bg)' }}
    >
      <div className="flex items-center gap-2 px-2 text-[12px] fg-2 select-none">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: 'var(--accent)' }}
        />
        <span>DSH Desktop</span>
        <span className="fg-3">· {page}</span>
      </div>
      <div className="no-drag flex items-center">
        <button type="button" className="btn-pill sm !px-2" onClick={() => void window.dsh.app.minimize()} title="最小化">
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="btn-pill sm !px-2"
          onClick={() => void window.dsh.app.maximizeToggle()}
          title={maximized ? '还原' : '最大化'}
        >
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          type="button"
          className="btn-pill sm !px-2 hover:!bg-[color-mix(in_srgb,var(--danger)_14%,transparent)]"
          onClick={() => window.close()}
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
