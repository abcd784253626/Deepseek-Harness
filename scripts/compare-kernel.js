// 对比 node24 与 electron-node20 的内核启动行为
const { spawn } = require('node:child_process')
const path = require('node:path')

const bin = 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/lib/bin.js'
const electron = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe')
const args = ['--profile', 'web', '--host', '127.0.0.1', '--port', '0']

function run(label, execPath, useElectronNode) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      DSH_HOME: path.join(process.env.USERPROFILE, '.dsh'),
      NO_COLOR: '1',
      FORCE_COLOR: '0'
    }
    if (useElectronNode) env.ELECTRON_RUN_AS_NODE = '1'
    const child = spawn(execPath, useElectronNode ? [bin, ...args] : [bin, ...args], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    const started = Date.now()
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (err += c))
    const timer = setTimeout(() => {
      child.kill()
    }, 40000)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ label, code, out, err, ms: Date.now() - started })
    })
  })
}

async function main() {
  const a = await run('node24', process.execPath, false)
  console.log(`===== ${a.label} exit=${a.code} in ${a.ms}ms =====`)
  console.log('STDOUT:', a.out.slice(0, 1500))
  console.log('STDERR:', a.err.slice(0, 1500))
  const b = await run('electron-node20', electron, true)
  console.log(`===== ${b.label} exit=${b.code} in ${b.ms}ms =====`)
  console.log('STDOUT:', b.out.slice(0, 1500))
  console.log('STDERR:', b.err.slice(0, 1500))
}

main().catch((e) => {
  console.error('runner failed', e)
  process.exit(1)
})
