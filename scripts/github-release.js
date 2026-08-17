/**
 * 创建/更新 GitHub Release 并上传安装包资产
 * 用法: node scripts/github-release.js [tag]
 *   tag 缺省时取 package.json 的 version（推荐：每次发版先升版本号再执行）
 * 规则：每个版本号对应独立 tag 与独立 Release，历史 Release 永不修改
 * 环境: GH_TOKEN（GCM 提取的 PAT）
 */
const fs = require('node:fs')
const path = require('node:path')

const OWNER = 'abcd784253626'
const REPO = 'Deepseek-Harness'
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'))
const VERSION = pkg.version
const TAG = process.argv[2] ? process.argv[2].replace(/^v/, 'v') : `v${VERSION}`
const TOKEN = process.env.GH_TOKEN
if (!TOKEN) {
  console.error('缺少 GH_TOKEN')
  process.exit(1)
}

const API = `https://api.github.com/repos/${OWNER}/${REPO}`
const H = { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-desktop-release' }

/** 上传重定向跟随：307/308 时解析 location 并重发（Node fetch 跨源不自动重发 body） */
async function uploadWithRedirect(url, headers, body) {
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, { method: 'POST', headers, body })
    if ((res.status === 307 || res.status === 308) && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url).toString()
      console.log('跟随重定向 →', url.slice(0, 120))
      continue
    }
    return res
  }
  throw new Error('重定向次数过多')
}

async function main() {
  // 1. 创建/获取 Release
  let release = await fetch(`${API}/releases/tags/${TAG}`, { headers: H })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  if (!release) {
    const created = await fetch(`${API}/releases`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: TAG,
        name: `DSH Desktop ${TAG}`,
        body: [
          `## DSH Desktop ${TAG} — DeepSeek Harness Windows 桌面客户端`,
          '',
          '- 基于官方 DeepSeek Harness（MIT）封装的 Windows 原生桌面应用，无浏览器运行',
          '- 插件安装市场（GitHub topic + npm 双源、一键装卸、版本回滚、安全扫描）',
          '- 皮肤系统（3 套预设 + 可视化编辑器 + .dsh-theme 导入导出 + 自定义 CSS）',
          '- 壁纸系统（本地磁盘图片搜索、全格式识别、透明度调节）',
          '- 官方版本实时更新检查、API 凭据本地加密存储',
          '- 完整架构文档：docs/（架构 / 构建 / 插件开发 / 主题开发）',
          '',
          '### 安装说明',
          `- \`DSH-Desktop-${VERSION}-x64.exe\`：NSIS 安装包（请复制到纯英文路径后运行，见 BUILD.md）`,
          `- \`DSH-Desktop-${VERSION}-portable-x64.exe\`：便携版，解压即用（中文路径可直接运行）`,
          '- 前置要求：Node.js 18+、`npm install -g @deepseek-ai/dsh`、pnpm'
        ].join('\n')
      })
    })
    if (!created.ok) {
      console.error('创建 Release 失败:', created.status, await created.text())
      process.exit(1)
    }
    release = await created.json()
  }
  console.log('Release:', release.html_url)

  // 2. 上传资产（资产名带版本号，历史 Release 天然互不冲突）
  const assets = [
    { file: `release/DSH-Desktop-${VERSION}-x64.exe`, name: `DSH-Desktop-${VERSION}-x64.exe` },
    { file: `release/DSH-Desktop-${VERSION}-portable-x64.exe`, name: `DSH-Desktop-${VERSION}-portable-x64.exe` }
  ]
  for (const asset of assets) {
    const filePath = path.join(__dirname, '..', asset.file)
    if (!fs.existsSync(filePath)) {
      console.warn('跳过缺失资产:', asset.file)
      continue
    }
    // 删除同名旧资产后重新上传（保证 release 资产与本地一致）
    const existing = await fetch(`${API}/releases/${release.id}/assets`, { headers: H }).then((r) => r.json())
    if (Array.isArray(existing)) {
      for (const a of existing) {
        if (a.name === asset.name) {
          console.log('删除旧资产:', asset.name)
          await fetch(`${API}/releases/assets/${a.id}`, { method: 'DELETE', headers: H })
        }
      }
    }
    const data = fs.readFileSync(filePath)
    console.log(`上传 ${asset.name} (${(data.length / 1024 / 1024).toFixed(1)}MB)...`)
    // 分块上传失败自动重试 3 次
    let up = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        up = await uploadWithRedirect(
          `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`,
          { ...H, 'Content-Type': 'application/octet-stream' },
          data
        )
        if (up.ok) break
        console.warn(`第 ${attempt} 次尝试 HTTP ${up.status}，重试...`)
      } catch (err) {
        console.warn(`第 ${attempt} 次尝试网络错误: ${err.cause?.code ?? err.message}，重试...`)
      }
      await new Promise((r) => setTimeout(r, 3000 * attempt))
    }
    if (!up || !up.ok) {
      console.error('上传失败:', up ? `${up.status} ${(await up.text()).slice(0, 200)}` : '网络错误')
      process.exit(1)
    }
    const info = await up.json()
    console.log('✓', info.browser_download_url)
  }
  console.log('完成:', release.html_url)
}

main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
