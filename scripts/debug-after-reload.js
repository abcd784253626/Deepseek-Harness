// 检查重载后内核状态与聊天页 DOM
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
  const evaluate = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    return r.result?.value
  }

  const kernel = await evaluate('window.dsh.kernel.state()')
  console.log('KERNEL:', JSON.stringify(kernel))
  const dom = await evaluate(`(() => {
    const main = document.querySelector('main')
    return {
      hasMain: !!main,
      mainText: main ? main.innerText.slice(0, 120) : null,
      hasWebview: !!document.querySelector('webview'),
      hasStartBtn: !!(main && /启动内核/.test(main.innerText))
    }
  })()`, false)
  console.log('DOM:', JSON.stringify(dom))
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
