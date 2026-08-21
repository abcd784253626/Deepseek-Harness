// 一次性探测当前渲染状态：node scripts/probe-state.mjs <wsUrl>
const wsUrl = process.argv[2]
const ws = new WebSocket(wsUrl)
let id = 0
const pending = new Map()
const send = (m, p = {}) =>
  new Promise((res, rej) => {
    const i = ++id
    pending.set(i, { res, rej })
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
  })
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id)
    pending.delete(m.id)
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result)
  }
}
ws.onopen = async () => {
  await send('Runtime.enable')
  const r = await send('Runtime.evaluate', {
    expression: `(() => ({
      rootLen: (document.getElementById('root')?.innerHTML || '').length,
      sidebar: !!document.querySelector('.app-sidebar'),
      webview: !!document.querySelector('webview'),
      bodyClass: document.body.className,
      errs: window.__dshErr || 'no-collector'
    }))()`,
    returnByValue: true
  })
  console.log(JSON.stringify(r.result?.value ?? r, null, 2))
  ws.close()
  process.exit(0)
}
setTimeout(() => {
  console.error('TIMEOUT')
  process.exit(1)
}, 15000)
