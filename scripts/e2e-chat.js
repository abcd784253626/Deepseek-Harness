/**
 * 官方 Web UI 端到端真实对话实测
 * 1. 注入消息到 composer（React 原生 setter）
 * 2. 点击发送按钮
 * 3. 轮询等待模型回复并输出
 * 用法: node scripts/e2e-chat.js [debugPort]
 */
const debugPort = Number(process.argv[2] ?? 9222)
const MESSAGE = process.argv[3] ?? '请用一句话介绍你自己，并说明你现在运行在什么环境里。'

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
    if (r.exceptionDetails) return { exception: r.exceptionDetails.text }
    return r.result?.value
  }
  const wvEval = (code) => evaluate(`document.querySelector('webview').executeJavaScript(${JSON.stringify(code)})`)

  // 1. 输入消息（React 受控组件：原生 setter + input 事件）
  const typed = await wvEval(`(() => {
    const ta = document.querySelector('textarea.uV2eYG_input') ||
      document.querySelector('textarea[placeholder*="描述"]') ||
      Array.from(document.querySelectorAll('textarea')).find(t => t.offsetHeight > 40)
    if (!ta) return { ok: false, err: 'no textarea' }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, ${JSON.stringify(MESSAGE)})
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.focus()
    return { ok: true, value: ta.value.slice(0, 60) }
  })()`)
  console.log('TYPED:', JSON.stringify(typed))
  if (!typed?.ok) {
    console.log('E2E_ABORT: 找不到输入框')
    ws.close()
    return
  }

  // 2. 找发送按钮并点击
  const clicked = await wvEval(`(() => {
    const ta = document.querySelector('textarea.uV2eYG_input') ||
      Array.from(document.querySelectorAll('textarea')).find(t => t.offsetHeight > 40)
    if (!ta) return { ok: false }
    const candidates = []
    // 相邻按钮：从 textarea 向上找容器，收集其中的 button
    let node = ta
    for (let i = 0; i < 6 && node; i++) {
      node = node.parentElement
      if (!node) break
      node.querySelectorAll('button').forEach(b => candidates.push(b))
    }
    const cand = candidates.filter(b => b.offsetHeight > 0 && !b.disabled)
    // 优先选择最后一个可用的（通常是发送键）
    const btn = cand[cand.length - 1]
    if (!btn) return { ok: false, found: cand.length }
    btn.click()
    return { ok: true, clicked: (btn.getAttribute('aria-label') || btn.className || 'button').toString().slice(0, 60), total: cand.length }
  })()`)
  console.log('CLICKED:', JSON.stringify(clicked))

  // 3. 轮询回复（最多 90s）
  const started = Date.now()
  let lastBody = ''
  let reply = null
  while (Date.now() - started < 90_000) {
    await new Promise((r) => setTimeout(r, 4000))
    const body = await wvEval(`document.body ? document.body.innerText : ''`)
    const text = typeof body === 'string' ? body : ''
    if (text !== lastBody) {
      lastBody = text
      // 检测是否出现用户消息之后的助手回复
      const idx = text.indexOf(MESSAGE.slice(0, 20))
      if (idx >= 0) {
        const after = text.slice(idx + 20)
        const stopMarkers = after.match(/(已停止|已取消|出错|error)/i)
        const hasAssistant = after.includes('Assistant') || after.includes('助手') || after.length > 80
        if (hasAssistant && !stopMarkers) {
          reply = after.slice(0, 600)
          break
        }
      }
    }
  }
  console.log('E2E_REPLY:', reply ? JSON.stringify(reply) : 'NO_REPLY (超时或界面结构变化)')
  if (reply) console.log('REPLY_TEXT:', reply.slice(0, 500))
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
