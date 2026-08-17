/**
 * 新功能验证：壁纸扫描/dsh-img 协议/更新检查/阿里配置读取
 * 用法: node scripts/verify-v2.js [debugPort]
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

  // 1. 壁纸扫描（限定工作区目录，快）
  const scan = await evaluate(`(async () => {
    const list = await window.dsh.wallpaper.search(['H:\\\\deep程序实体桌面版'])
    return list.slice(0, 8).map(w => ({ name: w.name, format: w.format, w: w.width, h: w.height, kb: Math.round(w.sizeBytes / 1024) }))
  })()`)
  console.log('WALLPAPER_SCAN:', JSON.stringify(scan))

  // 2. dsh-img 协议（若有结果）
  if (Array.isArray(scan) && scan.length > 0) {
    const first = await evaluate(`(async () => {
      const list = await window.dsh.wallpaper.search(['H:\\\\deep程序实体桌面版'])
      if (!list.length) return 'no-image'
      await window.dsh.wallpaper.set(list[0].path)
      const img = new Image()
      const src = 'dsh-img://local/' + encodeURIComponent(list[0].path).replace(/%2F/gi, '/')
      await new Promise((res, rej) => { img.onload = () => res(true); img.onerror = () => rej(new Error('img load failed')) ; img.src = src })
      return { loaded: true, path: list[0].path, src }
    })()`)
    console.log('DSH_IMG_PROTOCOL:', JSON.stringify(first))
  }

  // 3. 更新检查
  const upd = await evaluate(`window.dsh.update.check()`)
  console.log('UPDATE_CHECK:', JSON.stringify(upd))

  // 4. 阿里百炼配置读取
  const aliyun = await evaluate(`window.dsh.aliyun.get()`)
  console.log('ALIYUN_GET:', JSON.stringify(aliyun))

  // 5. 开机自启读取
  const settings = await evaluate(`window.dsh.settings.get()`)
  console.log('SETTINGS_WALLPAPER:', JSON.stringify({ wallpaperPath: settings.wallpaperPath, wallpaperOpacity: settings.wallpaperOpacity, openAtLogin: settings.openAtLogin }))

  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
