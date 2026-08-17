/**
 * 打包版最终验证：app.info / kernel / webview
 * 用法: node scripts/verify-packaged.js [debugPort]
 */
const debugPort = Number(process.argv[2] ?? 9333)

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
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    return r.result?.value
  }

  const info = await evaluate('window.dsh.app.info()')
  console.log('APP_INFO:', JSON.stringify(info, null, 2))
  const s = await evaluate('window.dsh.kernel.state()')
  console.log('KERNEL:', s.status, 'port:', s.port, 'pid:', s.pid)
  const wv = await evaluate(`(async () => {
    const wv = document.querySelector('webview')
    if (!wv) return 'no-webview'
    const themed = await wv.executeJavaScript("!!document.getElementById('dsh-desktop-theme')")
    return { title: wv.getTitle(), url: wv.getURL(), themed }
  })()`)
  console.log('WEBVIEW:', JSON.stringify(wv))
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
