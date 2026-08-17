/**
 * 壁纸渲染验证（UI 路径）：重载页面后检查壁纸层
 * 用法: node scripts/verify-wallpaper.js [debugPort]
 */
const debugPort = Number(process.argv[2] ?? 9222)

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

  // 确保设置持久化
  await evaluate(`(async () => {
    await window.dsh.wallpaper.set('H:\\\\deep程序实体桌面版\\\\resources\\\\sample-wallpaper.png')
    await window.dsh.wallpaper.opacity(45)
  })()`)

  // 重载页面 → bootstrap 重新读取 → UI 应用壁纸
  await send('Page.reload')
  await new Promise((r) => setTimeout(r, 6000))

  const dom = await evaluate(`(() => {
    const layer = document.querySelector('.wallpaper-layer')
    const mask = document.querySelector('.wallpaper-mask')
    return {
      hasClass: document.body.classList.contains('has-wallpaper'),
      layerBg: layer ? getComputedStyle(layer).backgroundImage.slice(0, 140) : null,
      maskOpacity: mask ? getComputedStyle(mask).opacity : null,
      sidebarBg: getComputedStyle(document.querySelector('.app-sidebar')).backgroundColor,
      titlebarBg: getComputedStyle(document.querySelector('.titlebar-bg')).backgroundColor,
      pageVisible: !!document.querySelector('.app-page-bg')
    }
  })()`)
  console.log('DOM:', JSON.stringify(dom, null, 2))
  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
