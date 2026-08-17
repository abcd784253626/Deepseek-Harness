/**
 * webview 内部验证：官方 UI 是否加载、主题样式是否注入。
 * 用法: node scripts/verify-webview.js [debugPort]
 */
const debugPort = Number(process.argv[2] ?? 9222)

async function main() {
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()
  const page = pages.find((p) => p.type === 'page' && !p.url.startsWith('devtools'))
  if (!page) {
    console.log('NO_PAGE')
    return
  }
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
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result)
    }
  }
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  const expr = `(async () => {
    const wv = document.querySelector('webview')
    if (!wv) return { error: 'no webview' }
    const result = {}
    try { result.url = wv.getURL() } catch (e) { result.url = 'n/a' }
    try { result.title = wv.getTitle() } catch (e) { result.title = 'n/a' }
    try {
      result.themeInjected = await wv.executeJavaScript("!!document.getElementById('dsh-desktop-theme')")
      result.bg = await wv.executeJavaScript("getComputedStyle(document.body).backgroundColor")
      result.bodyText = await wv.executeJavaScript("document.body ? document.body.innerText.slice(0, 160) : 'NO_BODY'")
    } catch (e) {
      result.injectError = String(e)
    }
    return result
  })()`
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  console.log(JSON.stringify(r.result?.value ?? r, null, 2))
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
