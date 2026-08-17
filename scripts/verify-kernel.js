/**
 * 内核状态验证：通过 CDP 读取 window.dsh.kernel 的 state 与 logs。
 * 用法: node scripts/verify-kernel.js <debugPort>
 */
const debugPort = Number(process.argv[2] ?? 9222)

async function main() {
  const res = await fetch(`http://127.0.0.1:${debugPort}/json`)
  const pages = await res.json()
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
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.value
  }

  const state = await evaluate('window.dsh.kernel.state()')
  console.log('STATE:', JSON.stringify(state, null, 2))
  const logs = await evaluate('window.dsh.kernel.logs()')
  if (Array.isArray(logs)) {
    console.log('--- kernel log tail ---')
    for (const l of logs.slice(-30)) console.log(`[${new Date(l.time).toLocaleTimeString()}] ${l.level}: ${l.text}`)
  }
  ws.close()
}

main().catch((err) => {
  console.error('VERIFY_FAIL:', err.message)
  process.exit(1)
})
