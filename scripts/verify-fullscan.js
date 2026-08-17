/**
 * 全盘扫描实测：后台执行，输出进度与最终格式统计
 * 用法: node scripts/verify-fullscan.js [debugPort]
 */
const debugPort = Number(process.argv[2] ?? 9222)
const DURATION_MS = Number(process.argv[3] ?? 90000)

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
    return r.result?.value
  }

  const started = Date.now()
  // 通过 IPC 启动全盘扫描（渲染进程订阅进度）
  const result = await evaluate(`(async () => {
    const progress = []
    const off = window.dsh.wallpaper.onProgress((p) => {
      progress.push({ scanned: p.scanned, found: p.found, counts: p.counts })
      if (progress.length > 60) progress.shift()
    })
    try {
      const list = await window.dsh.wallpaper.search(undefined)
      off()
      return { done: true, total: list.length, formats: list.reduce((acc, w) => { acc[w.format] = (acc[w.format] || 0) + 1; return acc }, {}), sample: list.slice(0, 5).map(w => w.name) }
    } catch (e) {
      off()
      return { done: false, error: String(e) }
    }
  })()`)
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`FULL_SCAN (${elapsed}s):`, JSON.stringify(result, null, 2))
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
