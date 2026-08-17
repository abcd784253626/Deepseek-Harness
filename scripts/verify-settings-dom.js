/**
 * 设置页 DOM 检查：无阿里百炼区块、有壁纸/更新/凭据区块
 * 用法: node scripts/verify-settings-dom.js [debugPort]
 */
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

  // 切到设置页
  await evaluate(`useAppSetPage()`).catch(() => undefined)
  // 通过点击侧栏导航切页更真实
  await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('.nav-item'))
    const btn = items.find(b => b.textContent.includes('设置'))
    if (btn) btn.click()
    return !!btn
  })()`)
  await new Promise((r) => setTimeout(r, 800))

  const sections = await evaluate(`Array.from(document.querySelectorAll('section h2')).map(h => h.textContent.trim())`)
  console.log('SETTINGS_SECTIONS:', JSON.stringify(sections))
  const hasAliyun = await evaluate(`document.body.innerText.includes('阿里百炼') || document.body.innerText.includes('DashScope')`)
  console.log('HAS_ALIYUN_TEXT:', hasAliyun)
  const hasCredentialSection = await evaluate(`document.body.innerText.includes('API 凭据')`)
  console.log('HAS_CREDENTIALS:', hasCredentialSection)
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
