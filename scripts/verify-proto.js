// 复测 settings 白名单：JSON.parse 构造的真实 __proto__ / 未知键载荷
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

  const proto = await evaluate(`window.dsh.settings.set(JSON.parse('{"__proto__": {"polluted": true}}')).then(() => 'ACCEPTED').catch(e => 'REJECTED: ' + e.message.slice(0, 50))`)
  console.log('PROTO_POLLUTION_ATTEMPT:', proto)
  const unknown = await evaluate(`window.dsh.settings.set(JSON.parse('{"evilKey": "x"}')).then(() => 'ACCEPTED').catch(e => 'REJECTED: ' + e.message.slice(0, 50))`)
  console.log('UNKNOWN_KEY:', unknown)
  const protoState = await evaluate(`JSON.stringify(Object.prototype.polluted ?? 'not-polluted')`)
  console.log('PROTOTYPE_STATE:', protoState)
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
