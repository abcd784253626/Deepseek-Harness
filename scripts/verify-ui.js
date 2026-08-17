/**
 * 渲染层验证脚本：通过 CDP（remote-debugging-port）检查 DOM 状态。
 * 用法: node scripts/verify-ui.js <debugPort>
 */
const debugPort = Number(process.argv[2] ?? 9222)

async function main() {
  // 1. 获取页面列表
  const res = await fetch(`http://127.0.0.1:${debugPort}/json`)
  const pages = await res.json()
  const page = pages.find((p) => p.type === 'page' && !p.url.startsWith('devtools'))
  if (!page) {
    console.log('NO_PAGE', JSON.stringify(pages.map((p) => ({ type: p.type, url: p.url }))))
    return
  }
  console.log('PAGE:', page.url)

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let seq = 0
  const pending = new Map()

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)))
      else p.resolve(msg.result)
    }
  }

  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true })
    return result.result?.value
  }

  // 2. 检查页面骨架
  const title = await evaluate('document.title')
  const rootChildren = await evaluate("document.getElementById('root')?.children.length ?? -1")
  const sidebarText = await evaluate("document.querySelector('.app-sidebar')?.innerText.slice(0, 300) ?? 'NO_SIDEBAR'")
  const bgVar = await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()")
  const kernelStatusText = await evaluate("document.querySelector('.app-sidebar')?.innerText.includes('内核') ?? false")
  const hasWebview = await evaluate("!!document.querySelector('webview')")
  const webviewSrc = await evaluate("document.querySelector('webview')?.getAttribute('src') ?? 'none'")
  const webviewFavicon = await evaluate("document.querySelector('webview')?.getURL?.() ?? 'n/a'")

  console.log('TITLE:', title)
  console.log('ROOT_CHILDREN:', rootChildren)
  console.log('THEME_BG:', bgVar)
  console.log('SIDEBAR_HAS_KERNEL_TEXT:', kernelStatusText)
  console.log('WEBVIEW_PRESENT:', hasWebview, '| SRC:', webviewSrc)
  console.log('SIDEBAR_TEXT:', JSON.stringify(sidebarText.slice(0, 200)))
  ws.close()
}

main().catch((err) => {
  console.error('VERIFY_FAIL:', err.message)
  process.exit(1)
})
