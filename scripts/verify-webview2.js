// 切回会话页验证 webview + 官方 UI 白色调
const debugPort = Number(process.argv[2] ?? 9222)

async function main() {
  const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()
  const page = pages.find((p) => p.type === 'page' && !p.url.startsWith('devtools'))
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

  await evaluate(`(() => { const items = Array.from(document.querySelectorAll('.nav-item')); items.find(b => b.textContent.includes('会话'))?.click(); return true })()`)
  await new Promise((r) => setTimeout(r, 2500))

  const wv = await evaluate(`(async () => {
    const wv = document.querySelector('webview')
    if (!wv) return { hasWv: false }
    const themed = await wv.executeJavaScript("(() => { const s = getComputedStyle(document.body); return { darkAttr: document.body.hasAttribute('data-ds-dark-theme'), bg: s.backgroundColor, aliasBg: s.getPropertyValue('--dsw-alias-bg-base').trim().slice(0,20) } })()")
    return { hasWv: true, url: wv.getURL(), title: wv.getTitle(), themed }
  })()`)
  console.log(JSON.stringify(wv, null, 2))
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
