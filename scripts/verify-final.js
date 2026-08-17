/**
 * 收尾配置：还原主题偏好、创建默认工作区、确认内核绑定工作区。
 * 用法: node scripts/verify-final.js [debugPort]
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

  // 还原主题偏好（跟随系统 + 纯净白）
  await evaluate(`window.dsh.settings.set({ themeId: 'pure-white', followSystemTheme: true })`)

  // 创建默认工作区（若不存在）
  const wsCreate = await evaluate(`(async () => {
    const list = await window.dsh.workspace.list()
    if (list.some(w => w.path === 'H:\\\\deep程序实体桌面版')) return { existing: true }
    const ws = await window.dsh.workspace.create({ name: 'DSH Desktop 开发', path: 'H:\\\\deep程序实体桌面版' })
    await window.dsh.settings.set({ lastWorkspaceId: ws.id })
    return { created: ws.id }
  })()`)
  console.log('WORKSPACE:', JSON.stringify(wsCreate))

  // 重启内核绑定工作区
  const state = await evaluate(`(async () => {
    const s = await window.dsh.settings.get()
    await window.dsh.kernel.restart(s.lastWorkspaceId)
    return s.lastWorkspaceId
  })()`)
  console.log('RESTART_WITH_WS:', JSON.stringify(state))

  ws.close()
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
