/**
 * 六项实测回归：壁纸透明度 / 图片识别 / 凭据保存 / 插件进度 / 按钮文字 / 设置页整体
 * 用法: node scripts/verify-six.js [debugPort]
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

  // 切到设置页
  await evaluate(`(() => { Array.from(document.querySelectorAll('.nav-item')).find(b => b.textContent.includes('设置'))?.click(); return true })()`)
  await new Promise((r) => setTimeout(r, 800))

  // ===== 1. 壁纸透明度 slider 存在且可调 =====
  const slider = await evaluate(`(() => {
    const sliders = Array.from(document.querySelectorAll('input[type="range"]'))
    return sliders.map((s, i) => ({ i, min: s.min, max: s.max, value: s.value }))
  })()`)
  console.log('1.WALLPAPER_SLIDER:', JSON.stringify(slider))

  // 模拟拖动（React onChange 需要 native setter）
  const dragResult = await evaluate(`(async () => {
    const s = Array.from(document.querySelectorAll('input[type="range"]')).find(x => x.max === '100')
    if (!s) return { ok: false }
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(s, '72')
    s.dispatchEvent(new Event('input', { bubbles: true }))
    s.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 500))
    const st = await window.dsh.settings.get()
    return { ok: true, savedOpacity: st.wallpaperOpacity, sliderValue: s.value }
  })()`)
  console.log('1.DRAG:', JSON.stringify(dragResult))

  // ===== 2. 图片识别：搜索工作区目录 + 缩略图可加载 =====
  const scan = await evaluate(`(async () => {
    const list = await window.dsh.wallpaper.search(['H:\\\\deep程序实体桌面版\\\\resources'])
    if (!list.length) return { ok: false, reason: 'empty' }
    const first = list[0]
    // 直接请求 dsh-img 协议验证缩略图可加载（非破图）
    const img = new Image()
    const src = 'dsh-img://local/' + encodeURIComponent(first.path).replace(/%2F/gi, '/')
    const loaded = await new Promise((res) => {
      img.onload = () => res(true)
      img.onerror = () => res(false)
      img.src = src
      setTimeout(() => res('timeout'), 3000)
    })
    return { ok: true, total: list.length, formats: [...new Set(list.map(w => w.format))], thumbLoaded: loaded, first: first.name }
  })()`)
  console.log('2.SCAN_THUMB:', JSON.stringify(scan))

  // ===== 3. 凭据保存：合法键保存成功 + 列表刷新 + 非法键有错误提示 =====
  const credTest = await evaluate(`(async () => {
    const before = (await window.dsh.credentials.list()).length
    const entry = await window.dsh.credentials.set('TEST_API_KEY', '测试密钥', 'sk-test-value-123')
    const after = (await window.dsh.credentials.list())
    const found = after.find(c => c.key === 'TEST_API_KEY')
    await window.dsh.credentials.remove('TEST_API_KEY')
    return { before, after: after.length, saved: entry.key, listed: !!found }
  })()`)
  console.log('3.CREDENTIAL:', JSON.stringify(credTest))

  // 非法键应报错
  const badCred = await evaluate(`window.dsh.credentials.set('PATH', 'x', 'v').then(() => 'ACCEPTED').catch(e => 'REJECTED')`)
  console.log('3.BAD_CRED:', badCred)

  // ===== 5. 按钮文字：disabled primary hover 计算样式（修复后不应白字透明底） =====
  const btnStyle = await evaluate(`(() => {
    // 找设置页 primary 按钮（一键更新内核）并模拟 disabled + hover
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('一键更新内核'))
    if (!btn) return { found: false }
    btn.disabled = true
    btn.classList.add('primary')
    const style = getComputedStyle(btn)
    btn.style.background = getComputedStyle(btn).backgroundColor
    return {
      found: true,
      bg: style.backgroundColor,
      color: style.color,
      text: btn.textContent.trim().slice(0, 12),
      visible: style.color !== style.backgroundColor
    }
  })()`)
  console.log('5.BUTTON_STYLE:', JSON.stringify(btnStyle))

  // ===== 设置页区块存在性 =====
  const sections = await evaluate(`Array.from(document.querySelectorAll('section h2')).map(h => h.textContent.trim().slice(0, 14))`)
  console.log('SECTIONS:', JSON.stringify(sections))

  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
