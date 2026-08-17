// 捕获阶段探测：input 事件是否到达 document（React 委托监听点）
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

  await evaluate(`(() => {
    window.__cap = []
    document.addEventListener('input', (e) => window.__cap.push('doc-capture:' + e.target.value), true)
    document.addEventListener('input', (e) => window.__cap.push('doc-bubble:' + e.target.value), false)
    return true
  })()`)

  const rect = await evaluate(`(() => {
    const s = Array.from(document.querySelectorAll('input[type="range"]')).find(x => x.max === '100')
    const r = s.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })()`)

  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x + 2, y: rect.y + rect.h / 2, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + 2, y: rect.y + rect.h / 2, button: 'left', clickCount: 1 })
  await new Promise((r) => setTimeout(r, 500))

  const cap = await evaluate(`window.__cap`)
  const db = await evaluate(`(async () => (await window.dsh.settings.get()).wallpaperOpacity)()`)
  console.log('DOC_EVENTS:', JSON.stringify(cap))
  console.log('DB:', db)
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
