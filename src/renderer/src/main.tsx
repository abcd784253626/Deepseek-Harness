import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/main.css'

/**
 * 渲染层错误边界：任何渲染/副作用异常都不再让整窗白屏，
 * 而是显示可恢复的错误页（含报错信息 + 重新加载按钮）。
 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[dsh-desktop] renderer crash:', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      const message = this.state.error?.message || String(this.state.error)
      return (
        <div
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            padding: 24,
            background: 'var(--bg)',
            color: 'var(--fg)',
            fontFamily: 'var(--font-family)',
            fontSize: 13
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 15 }}>界面渲染出错</div>
          <div style={{ color: 'var(--danger)', maxWidth: 560, textAlign: 'center', wordBreak: 'break-all' }}>{message}</div>
          <button
            type="button"
            className="btn-pill primary"
            onClick={() => {
              window.location.reload()
            }}
          >
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
