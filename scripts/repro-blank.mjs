/**
 * CDP 驱动：复现「设置 → 会话」白屏问题并抓取渲染进程真实报错。
 * 用法：node scripts/repro-blank.mjs <wsUrl>
 */
const wsUrl = process.argv[2]
if (!wsUrl) {
  console.error('用法: node scripts/repro-blank.mjs ws://127.0.0.1:9333/devtools/page/<id>')
  process.exit(1)
}

const ws = new WebSocket(wsUrl)
let seq = 0
const pending = new Map()
const events = []

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id) {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error.message))
    else p.resolve(msg.result)
    return
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ')
    events.push(`[console.${msg.params.type}] ${args}`)
  } else if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails
    events.push(`[exception] ${d.text} ${d.exception?.description ?? ''} ${d.url ?? ''}:${d.lineNumber ?? ''}`)
  } else if (msg.method === 'Log.entryAdded') {
    events.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text}`)
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function evalJs(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (res.exceptionDetails) {
    return { evalError: res.exceptionDetails.exception?.description ?? res.exceptionDetails.text }
  }
  return res.result?.value
}

async function waitFor(expr, timeoutMs, label) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const v = await evalJs(expr)
    if (v) return v
    await sleep(300)
  }
  console.error(`⏱ 等待超时: ${label}`)
  return null
}

ws.onopen = async () => {
  try {
    await send('Runtime.enable')
    await send('Log.enable')
    await send('Page.enable')
    console.log('· CDP 已连接，等待应用就绪…')

    // 1) 安装错误收集器
    await evalJs(`(() => {
      window.__dshErr = [];
      window.addEventListener('error', e => window.__dshErr.push('error: ' + e.message + ' @ ' + (e.filename||'') + ':' + e.lineno + ':' + e.colno));
      window.addEventListener('unhandledrejection', e => { const r = e.reason; window.__dshErr.push('rejection: ' + (r && r.stack ? r.stack : String(r))); });
      return 'collector installed';
    })()`)

    // 2) 等侧栏出现（应用就绪）
    await waitFor(`!!document.querySelector('.app-sidebar')`, 30000, '应用就绪')
    console.log('· 应用就绪，当前页面:', await evalJs(`[...document.querySelectorAll('.nav-item')].map(b => b.textContent.trim()).join(',')`))

    // 3) 等 webview 挂载（内核运行、会话页正常）
    await waitFor(`!!document.querySelector('webview')`, 30000, 'webview 挂载')
    console.log('· 会话页 webview 已挂载（首次加载正常）')
    await sleep(2500)

    // 4) 切到设置
    await evalJs(`(() => { const b = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('设置')); if (b) { b.click(); return 'clicked 设置'; } return 'NOT FOUND 设置'; })()`)
    console.log('· 已点击「设置」')
    await sleep(1500)
    const settingsState = await evalJs(`(() => ({
      nav: [...document.querySelectorAll('.nav-item')].map(b => b.textContent.trim()),
      rootLen: (document.getElementById('root')?.innerHTML || '').length,
      hasWallpaper: document.body.classList.contains('has-wallpaper')
    }))()`)
    console.log('· 设置页状态:', JSON.stringify(settingsState))

    // 5) 切回会话（复现点）
    await evalJs(`(() => { const b = [...document.querySelectorAll('.nav-item')].find(x => x.textContent.includes('会话')); if (b) { b.click(); return 'clicked 会话'; } return 'NOT FOUND 会话'; })()`)
    console.log('· 已点击「会话」——观察 5 秒')
    await sleep(5000)

    const after = await evalJs(`(() => ({
      rootLen: (document.getElementById('root')?.innerHTML || '').length,
      rootText: (document.getElementById('root')?.innerText || '').slice(0, 120),
      sidebar: !!document.querySelector('.app-sidebar'),
      titlebar: !!document.querySelector('.titlebar-bg'),
      webview: !!document.querySelector('webview'),
      errs: window.__dshErr || []
    }))()`)
    console.log('=== 切回会话后状态 ===')
    console.log(JSON.stringify(after, null, 2))

    console.log('=== 捕获到的事件 ===')
    for (const e of events) console.log(e)
    if (events.length === 0) console.log('（无 console/exception 事件）')
  } catch (err) {
    console.error('驱动失败:', err.message)
  }
  ws.close()
  process.exit(0)
}
