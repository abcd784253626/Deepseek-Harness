// 端到端真实对话（v2）：切到会话页 → 等 webview 就绪 → 输入发送 → 轮询回复
const debugPort = Number(process.argv[2] ?? 9222)
const MESSAGE = process.argv[3] ?? '请用一句话介绍你自己，并说明你现在运行在什么环境里。'

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
    if (r.exceptionDetails) return { exception: r.exceptionDetails.text }
    return r.result?.value
  }
  const wvEval = (code) => evaluate(`document.querySelector('webview').executeJavaScript(${JSON.stringify(code)})`)

  // 1. 切会话页
  await evaluate(`(() => { Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent.includes('会话'))?.click(); return true })()`)
  await new Promise((r) => setTimeout(r, 3000))

  // 2. 输入
  const typed = await wvEval(`(() => {
    const ta = Array.from(document.querySelectorAll('textarea')).find(t => t.offsetHeight > 40 && t.offsetWidth > 200)
    if (!ta) return { ok: false }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(MESSAGE)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.focus()
    return { ok: true }
  })()`)
  console.log('TYPED:', JSON.stringify(typed))
  if (!typed?.ok) {
    console.log('E2E_ABORT')
    ws.close()
    return
  }

  // 3. 发送
  const clicked = await wvEval(`(() => {
    const ta = Array.from(document.querySelectorAll('textarea')).find(t => t.offsetHeight > 40 && t.offsetWidth > 200)
    let node = ta
    const candidates = []
    for (let i = 0; i < 6 && node; i++) {
      node = node.parentElement
      if (!node) break
      node.querySelectorAll('button').forEach(b => candidates.push(b))
    }
    const btn = candidates.filter(b => b.offsetHeight > 0 && !b.disabled).pop()
    if (!btn) return { ok: false }
    btn.click()
    return { ok: true }
  })()`)
  console.log('CLICKED:', JSON.stringify(clicked))

  // 4. 轮询回复
  const started = Date.now()
  let reply = null
  while (Date.now() - started < 90_000) {
    await new Promise((r) => setTimeout(r, 4000))
    const body = await wvEval(`document.body ? document.body.innerText : ''`)
    const text = typeof body === 'string' ? body : ''
    const idx = text.indexOf(MESSAGE.slice(0, 15))
    if (idx >= 0) {
      const after = text.slice(idx + 15)
      if (after.length > 120 && !/已停止|已取消/.test(after)) {
        reply = after.slice(0, 400)
        break
      }
    }
  }
  console.log('E2E_REPLY:', reply ? JSON.stringify(reply) : 'NO_REPLY')
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
