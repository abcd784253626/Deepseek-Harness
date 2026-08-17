/**
 * 修复验证：jpg 识别 + 官方 UI 白色调统一
 * 用法: node scripts/verify-fixes.js [debugPort]
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
  const wvEval = (code) => evaluate(`document.querySelector('webview').executeJavaScript(${JSON.stringify(code)})`)

  // 1. jpg 识别（工作区扫描）
  const scan = await evaluate(`(async () => {
    const list = await window.dsh.wallpaper.search(['H:\\\\deep程序实体桌面版\\\\resources'])
    return list.map(w => ({ name: w.name, format: w.format, w: w.width, h: w.height, kb: Math.round(w.sizeBytes / 1024) }))
  })()`)
  console.log('JPEG_SCAN:', JSON.stringify(scan))
  const jpg = Array.isArray(scan) ? scan.find((s) => s.format === 'jpeg') : null
  console.log(jpg ? '✅ JPG 识别成功: ' + JSON.stringify(jpg) : '❌ 未识别到 jpg')

  // 2. 官方 UI 白色调
  const ui = await wvEval(`(() => {
    const style = getComputedStyle(document.body)
    return {
      darkAttr: document.body.hasAttribute('data-ds-dark-theme'),
      bodyBg: style.backgroundColor,
      colorScheme: document.documentElement.style.colorScheme,
      aliasBg: style.getPropertyValue('--dsw-alias-bg-base').trim().slice(0, 60),
      aliasFg: style.getPropertyValue('--dsw-alias-label-primary').trim().slice(0, 60),
      aliasAccent: style.getPropertyValue('--dsw-alias-brand-primary').trim().slice(0, 60),
      themeStyle: !!document.getElementById('dsh-desktop-theme')
    }
  })()`)
  console.log('OFFICIAL_UI_THEME:', JSON.stringify(ui, null, 2))

  // 3. settings.yaml 的 ui-theme 偏好
  const settings = await evaluate(`window.dsh.settings.get()`)
  console.log('DESKTOP_THEME_ID:', settings.themeId)

  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
