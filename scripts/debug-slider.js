// 真实鼠标拖拽 slider 验证透明度（CDP Input.dispatchMouseEvent）
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

  // 1. 切到设置页 + 找到 slider 坐标
  await evaluate(`(() => { Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent.includes('设置'))?.click(); return true })()`)
  await new Promise((r) => setTimeout(r, 800))
  const rect = await evaluate(`(() => {
    const s = Array.from(document.querySelectorAll('input[type="range"]')).find(x => x.max === '100')
    if (!s) return null
    const r = s.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, value: s.value }
  })()`)
  console.log('SLIDER_RECT:', JSON.stringify(rect))
  if (!rect) process.exit(1)

  // 2. 真实鼠标拖拽到 70% 位置
  const sx = rect.x + rect.w * 0.7
  const sy = rect.y + rect.h / 2
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 6; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx + i * 3, y: sy, button: 'left', buttons: 1 })
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx + 18, y: sy, button: 'left', clickCount: 1 })
  await new Promise((r) => setTimeout(r, 600))

  // 3. 读取 DB 与 DOM
  const after = await evaluate(`(async () => {
    const s = await window.dsh.settings.get()
    const dom = Array.from(document.querySelectorAll('input[type="range"]')).find(x => x.max === '100')
    return { saved: s.wallpaperOpacity, domValue: dom ? dom.value : null }
  })()`)
  console.log('AFTER_DRAG:', JSON.stringify(after))
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
