// 最终透明度拖拽验证：切到设置页 → 真实鼠标点击 slider 最左端 → DB 应变 5
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

  // 切设置页
  await evaluate(`(() => { Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent.includes('设置'))?.click(); return true })()`)
  await new Promise((r) => setTimeout(r, 800))

  const rect = await evaluate(`(() => {
    const s = Array.from(document.querySelectorAll('input[type="range"]')).find(x => x.max === '100')
    if (!s) return null
    const r = s.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })()`)
  console.log('SLIDER:', JSON.stringify(rect))
  if (!rect) process.exit(1)

  // 点击最左端 → 值应跳 5
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x + 2, y: rect.y + rect.h / 2, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + 2, y: rect.y + rect.h / 2, button: 'left', clickCount: 1 })
  await new Promise((r) => setTimeout(r, 600))

  const state = await evaluate(`(async () => {
    const s = await window.dsh.settings.get()
    const dom = Array.from(document.querySelectorAll('input[type="range"]')).find(x => x.max === '100')
    return { saved: s.wallpaperOpacity, dom: dom ? dom.value : null }
  })()`)
  console.log('AFTER_CLICK_LEFT:', JSON.stringify(state))
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
