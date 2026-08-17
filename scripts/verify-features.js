/**
 * 功能链路验证：模式切换、主题应用、插件市场检索。
 * 用法: node scripts/verify-features.js [debugPort]
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
    if (r.exceptionDetails) return { exception: r.exceptionDetails.text }
    return r.result?.value
  }

  // 1. 主题应用（深空黑 → 检查 CSS 变量）
  const themeResult = await evaluate(
    `(async () => {
      const t = await window.dsh.themes.apply('deep-black')
      await window.dsh.settings.set({ themeId: 'deep-black', followSystemTheme: false })
      return { applied: t?.name, bg: t?.tokens.bg }
    })()`
  )
  console.log('THEME_APPLY:', JSON.stringify(themeResult))
  const bgAfter = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`)
  console.log('CSS_VAR_BG_AFTER:', bgAfter)

  // 2. 运行模式列表 + 切换（切回 standard，避免改动用户环境）
  const modes = await evaluate(`window.dsh.mode.list()`)
  console.log('MODES:', JSON.stringify(Array.isArray(modes) ? modes.map((m) => m.id) : modes))
  const modeSet = await evaluate(`window.dsh.mode.set('standard')`)
  console.log('MODE_SET:', JSON.stringify(modeSet))

  // 3. 插件市场检索（带 20s 超时）
  const market = await evaluate(
    `(async () => {
      const t = setTimeout(() => { throw new Error('market timeout') }, 20000)
      try {
        const list = await window.dsh.plugins.search('')
        clearTimeout(t)
        return { count: list.length, samples: list.slice(0, 5).map(p => p.name) }
      } catch (e) { clearTimeout(t); return { error: String(e) } }
    })()`
  )
  console.log('MARKET:', JSON.stringify(market))

  // 4. 已安装插件同步
  const installed = await evaluate(`window.dsh.plugins.installed()`)
  console.log('INSTALLED:', JSON.stringify(Array.isArray(installed) ? installed.map((p) => p.name) : installed))

  // 5. 凭据列表（不应有明文）
  const creds = await evaluate(`window.dsh.credentials.list()`)
  console.log('CREDENTIALS:', JSON.stringify(creds))

  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
