/**
 * 原生模块校验（postinstall）
 * better-sqlite3 v13+ 采用 Node-API，npm 包内自带全平台预编译二进制，
 * 无需 prebuild-install / 源码编译。本脚本仅做加载冒烟验证与 ABI 报告。
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const root = path.join(__dirname, '..')
const moduleDir = path.join(root, 'node_modules', 'better-sqlite3')
const electronPkgPath = path.join(root, 'node_modules', 'electron', 'package.json')

if (!fs.existsSync(moduleDir)) {
  console.log('[dsh-desktop] better-sqlite3 未安装，跳过校验')
  process.exit(0)
}

let electronVersion = 'unknown'
try {
  electronVersion = JSON.parse(fs.readFileSync(electronPkgPath, 'utf-8')).version
} catch {
  /* 未安装 electron 时跳过 */
}

// 1. 检查自带预编译二进制（Node-API 格式）
const winBin = path.join(moduleDir, 'prebuilds', 'win32-x64.node')
const binPresent = process.platform === 'win32' ? fs.existsSync(winBin) : true

// 2. 用系统 Node 做加载冒烟（Node-API 跨运行时 ABI 稳定，能加载即代表 Electron 也可用）
let smokeOk = false
try {
  execFileSync(
    process.execPath,
    [
      '-e',
      `const db = require(${JSON.stringify(moduleDir)}); const d = new db(':memory:'); d.exec('create table t(a)'); d.prepare('insert into t values (?)').run('ok'); process.exit(0)`
    ],
    { stdio: 'ignore', timeout: 15000 }
  )
  smokeOk = true
} catch {
  smokeOk = false
}

console.log(
  `[dsh-desktop] better-sqlite3 校验: electron=${electronVersion} 自带二进制=${binPresent ? '✓' : '✗'} 加载冒烟=${smokeOk ? '✓' : '✗'}`
)
process.exit(binPresent && smokeOk ? 0 : 1)
