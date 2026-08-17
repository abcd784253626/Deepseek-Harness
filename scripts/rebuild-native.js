/**
 * 原生模块重建：为 Electron ABI 安装 better-sqlite3 预编译二进制。
 * 无需 VS Build Tools —— 直接从镜像下载 electron 运行时预编译包。
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const root = path.join(__dirname, '..')
const electronPkgPath = path.join(root, 'node_modules', 'electron', 'package.json')
const prebuildBin = path.join(root, 'node_modules', 'prebuild-install', 'bin.js')
const targetDir = path.join(root, 'node_modules', 'better-sqlite3')

if (!fs.existsSync(electronPkgPath) || !fs.existsSync(prebuildBin) || !fs.existsSync(targetDir)) {
  console.log('[dsh-desktop] 依赖未就绪，跳过原生模块重建')
  process.exit(0)
}

const electronVersion = JSON.parse(fs.readFileSync(electronPkgPath, 'utf-8')).version

try {
  execFileSync(
    process.execPath,
    [prebuildBin, '--runtime=electron', `--target=${electronVersion}`, '--tag-prefix=v'],
    {
      cwd: targetDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_better_sqlite3_binary_host_mirror:
          process.env.BETTER_SQLITE3_MIRROR || 'https://npmmirror.com/mirrors/better-sqlite3/'
      }
    }
  )
  console.log(`[dsh-desktop] better-sqlite3 electron ABI (${electronVersion}) 预编译二进制就绪`)
} catch (err) {
  console.warn('[dsh-desktop] better-sqlite3 预编译下载失败:', err.message)
  console.warn('[dsh-desktop] 备选方案：安装 VS Build Tools 后运行 npm run rebuild:native；或设置 BETTER_SQLITE3_MIRROR')
  process.exit(1)
}
