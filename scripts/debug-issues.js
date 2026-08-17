// 调试：透明度 IPC 直调 + dsh-img 协议错误详情
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

  // 1. 透明度 IPC 直调
  const op1 = await evaluate(`window.dsh.wallpaper.opacity(72)`)
  const op2 = await evaluate(`(async () => { const s = await window.dsh.settings.get(); return s.wallpaperOpacity })()`)
  console.log('OPACITY_IPC:', op1, '| DB:', op2)

  // 2. dsh-img fetch 错误详情（CDP 直接发起）
  const fetchTest = await evaluate(`(async () => {
    const path = 'H:\\\\deep程序实体桌面版\\\\resources\\\\test-photo.jpg'
    const src = 'dsh-img://local/' + encodeURIComponent(path).replace(/%2F/gi, '/')
    try {
      const res = await fetch(src)
      return { status: res.status, type: res.type, len: (await res.text()).length }
    } catch (e) {
      return { error: e.message, cause: e.cause ? String(e.cause) : null }
    }
  })()`)
  console.log('FETCH_DSH_IMG:', JSON.stringify(fetchTest))

  // 3. img 元素方式 + performance entries
  const imgTest = await evaluate(`(async () => {
    const path = 'H:\\\\deep程序实体桌面版\\\\resources\\\\test-photo.jpg'
    const src = 'dsh-img://local/' + encodeURIComponent(path).replace(/%2F/gi, '/')
    const result = await new Promise((res) => {
      const img = new Image()
      img.onload = () => res({ loaded: true, w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = () => res({ loaded: false })
      img.src = src
      setTimeout(() => res({ loaded: 'timeout' }), 3000)
    })
    return result
  })()`)
  console.log('IMG_TEST:', JSON.stringify(imgTest))

  // 4. 直接对 win.ini（应 403）验证协议工作
  const denyTest = await evaluate(`(async () => {
    const src = 'dsh-img://local/' + encodeURIComponent('C:\\\\Windows\\\\win.ini').replace(/%2F/gi, '/')
    try {
      const res = await fetch(src)
      return { status: res.status }
    } catch (e) {
      return { error: e.message }
    }
  })()`)
  console.log('DENY_TEST:', JSON.stringify(denyTest))

  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
