# 构建与打包

## 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | ≥ 20（开发机 24 已验证） | 构建与内核 CLI 运行 |
| npm | ≥ 10 | 包管理 |
| pnpm | 全局安装 | 官方插件机制（`dsh plugin` 转发）依赖 |
| @deepseek-ai/dsh | 最新 RC | `npm install -g @deepseek-ai/dsh` |
| VS Build Tools | 不需要 | better-sqlite3 使用预编译二进制（见下） |

> 无 VS Build Tools 也可完整构建：`scripts/rebuild-native.js` 通过 prebuild-install 从
> npmmirror 下载 Electron ABI（v130）预编译包，无需本地编译器。

## 开发

```powershell
npm install          # 含 postinstall 原生模块重建
npm run dev          # electron-vite dev（HMR）
```

## 构建

```powershell
npm run build        # typecheck（node+web 双工程）+ electron-vite build → out/
npm run preview      # 以生产构建预览
```

产物：
- `out/main/index.js` — 主进程
- `out/preload/index.js` — preload
- `out/renderer/` — 渲染层静态资源

## 打包（Windows）

```powershell
npm run package           # NSIS 安装包 → release/DSH-Desktop-<ver>-<arch>.exe
npm run package:portable  # 便携版 → release/DSH-Desktop-<ver>-portable-<arch>.exe
npm run package:all       # 两者
```

electron-builder 配置（package.json `build` 字段）要点：

- `asarUnpack: better-sqlite3`（原生模块必须解包）
- NSIS：可选安装目录、桌面+开始菜单快捷方式、卸载程序
- 图标：`resources/icon.ico`（scripts/generate-icon.ps1 生成，PNG-in-ICO 格式）

### 打包常见问题

| 问题 | 处理 |
|------|------|
| electron 二进制下载超时 | `.npmrc` 已配 npmmirror；重跑 `npm install` |
| better-sqlite3 ABI 不匹配 | `npm run rebuild:native`（自动按 electron 版本下载预编译） |
| 签名警告 | 未配置证书属正常；生产发布建议购买 EV 签名 |
| 安装后内核找不到 | 打包机需 `npm install -g @deepseek-ai/dsh`，或在应用设置中指定 dsh 路径 |

## 发布清单

1. `npm run build` 全绿
2. `npm run package:all`
3. 在干净 Windows 10/11（x64）虚拟机安装验证：首启、内核拉起、会话、装插件、换主题
4. 便携版解压后直接运行验证（注意 portable 版不写注册表，数据在 `%APPDATA%/dsh-desktop`）

## 自动更新

electron-builder `publish` 未配置（`null`）。接入 GitHub Releases / 自建源时：
设置 `publish: { provider: "github" | "generic", ... }`，主进程引入 `electron-updater`
并在 `app.whenReady` 中调用 `autoUpdater.checkForUpdatesAndNotify()`。
