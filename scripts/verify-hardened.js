/**
 * 加固后回归验证：内核、终端页（process 修复）、壁纸协议白名单、主题净化、设置白名单
 * 用法: node scripts/verify-hardened.js [debugPort]
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

  // 1. 内核状态
  const kernel = await evaluate('window.dsh.kernel.state()')
  console.log('KERNEL:', kernel.status, kernel.port)

  // 2. 终端页不再白屏（process 引用修复）——导航并检查根节点存活
  await evaluate(`(() => { const items = Array.from(document.querySelectorAll('.nav-item')); items.find(b => b.textContent.includes('终端'))?.click(); return true })()`)
  await new Promise((r) => setTimeout(r, 600))
  const terminalOk = await evaluate(`(() => ({
    hasRoot: !!document.getElementById('root')?.children.length,
    hasInput: !!document.querySelector('.input-pill[placeholder*="输入命令"]'),
    bodyText: document.body.innerText.slice(0, 80)
  }))()`)
  console.log('TERMINAL_PAGE:', JSON.stringify(terminalOk))

  // 3. 设置键白名单：非法键应被拒绝
  const badKey = await evaluate(`window.dsh.settings.set({ '__proto__': { x: 1 } }).then(() => 'ACCEPTED').catch(e => 'REJECTED: ' + e.message.slice(0, 40))`)
  console.log('SETTINGS_ALLOWLIST:', badKey)

  // 4. 凭据键名校验：危险键应被拒绝
  const badCred = await evaluate(`window.dsh.credentials.set('PATH', 'x', 'evil').then(() => 'ACCEPTED').catch(e => 'REJECTED: ' + e.message.slice(0, 40))`)
  console.log('CRED_KEY_CHECK:', badCred)

  // 5. 插件 spec 校验：shell 元字符应被拒绝
  const badSpec = await evaluate(`window.dsh.plugins.install('evil&calc').then(() => 'ACCEPTED').catch(e => 'REJECTED: ' + e.message.slice(0, 40))`)
  console.log('PLUGIN_SPEC_CHECK:', badSpec)

  // 6. dsh-img 白名单：白名单外路径应被拒绝（走渲染 fetch）
  const protoDeny = await evaluate(`(async () => {
    const img = new Image()
    const src = 'dsh-img://local/' + encodeURIComponent('C:\\\\Windows\\\\win.ini').replace(/%2F/gi, '/')
    return await new Promise((res) => {
      let done = false
      const finish = (ok) => { if (!done) { done = true; res(ok) } }
      img.onload = () => finish('LOADED(!!)')
      img.onerror = () => finish('denied')
      img.src = src
      setTimeout(() => finish('timeout'), 3000)
    })
  })()`)
  console.log('DSH_IMG_ALLOWLIST:', protoDeny)

  // 7. 主题净化：恶意令牌应被回退
  const themeSanitize = await evaluate(`(async () => {
    const saved = await window.dsh.themes.save({
      id: 'user-test-x', name: '测试', type: 'light', author: 't', description: '',
      source: 'user',
      tokens: { bg: 'url(javascript:alert(1))', fg: '#1a1a1a', fgSecondary: '#666', fgDisabled: '#aaa', border: '#eee', accent: '#5a67d8', accentFg: '#fff', danger: '#d00', success: '#0a0', bgSubtle: '#f7f7f5', bgElevated: '#fff', radius: 999, fontSize: 14, fontFamily: 'x"} html { background:red } { "' },
      customCss: '@import url(evil); body { background: red }'
    })
    await window.dsh.themes.remove(saved.id)
    return { bg: saved.tokens.bg, radius: saved.tokens.radius, fontFamily: saved.tokens.fontFamily.slice(0, 30), css: saved.customCss.slice(0, 40) }
  })()`)
  console.log('THEME_SANITIZE:', JSON.stringify(themeSanitize))

  // 8. 模式白名单
  const badMode = await evaluate(`window.dsh.mode.set('evil-mode').then(() => 'ACCEPTED').catch(e => 'REJECTED: ' + e.message.slice(0, 40))`)
  console.log('MODE_ALLOWLIST:', badMode)

  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
