# DSH Desktop

基于官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）封装的 **Windows 原生桌面客户端**。
保留官方全部 Agent 能力，无浏览器运行；额外提供 **插件安装市场** 与 **皮肤自定义系统**，遵循 Codex 级极简设计语言。

## 功能总览

| 模块 | 说明 |
|------|------|
| 内核封装 | 启动即自动拉起 `dsh --profile web` 内核子进程，崩溃自动恢复，多工作区管理 |
| 官方 UI | 内嵌官方 Web UI（webview），会话/工具/轨迹/审批/模型配置 100% 官方能力 |
| 运行模式 | 标准 / 代码 / 极简 / 创造（对应官方 agent-presets，写入 settings.yaml 互通） |
| 插件市场 | GitHub topic:dsh-plugin + npm 双源检索、分类筛选、一键安装/卸载/更新/回滚、本地目录导入、安全扫描 |
| 皮肤系统 | 纯净白 / 深空黑 / 护眼灰 3 套预设 + 可视化编辑器（即时预览）+ `.dsh-theme` 导入导出 + 自定义 CSS 注入 + 跟随系统 |
| 壁纸系统 | 本地磁盘图片搜索（jpg/png/gif/bmp/webp/tiff/ico，文件头魔数识别 + 宽高解析）、全盘/指定目录扫描、网格预览一键应用、透明度调节 |
| 官方更新 | 与 npm 官方源实时对比 dsh 版本，一键更新内核，更新日志直达 |
| 阿里百炼 | DashScope 接入向导：Key 经 DPAPI 加密、配置写入官方 settings.yaml、真实对话测试连接 |
| 终端面板 | 直接调用 dsh CLI 命令（`--dump-config`、`plugin` 等），输出流式回显 |
| 命令面板 | `Ctrl+Shift+P` 执行全部核心功能；无干扰沉浸模式；系统托盘后台运行；开机自启 |
| 配置互通 | settings.yaml 导入/导出，API Key 经 Windows DPAPI 本地加密存储 |

## 快速开始

```powershell
# 0. 前置：安装官方内核 CLI（需 Node.js 18+）
npm install -g @deepseek-ai/dsh
# 插件安装依赖 pnpm（dsh plugin 命令转发给 pnpm）
npm install -g pnpm

# 1. 安装依赖（自动下载 Electron 与 better-sqlite3 预编译二进制）
npm install

# 2. 开发运行
npm run dev

# 3. 构建与打包
npm run build          # 类型检查 + 构建
npm run package        # NSIS 安装包 (release/)
npm run package:portable   # 便携版 exe
```

> 国内网络：`.npmrc` 已配置 Electron / electron-builder / better-sqlite3 镜像。

## 目录结构

```
src/
├── main/               # Electron 主进程
│   ├── index.ts        # 入口（单实例、生命周期）
│   ├── window.ts       # 无边框主窗口
│   ├── menu.ts / tray.ts
│   ├── ipc.ts          # 全部 IPC 处理器（鉴权）
│   ├── security.ts     # 凭据加密 + 路径安全
│   ├── kernel/         # 内核子进程：resolver（dsh 定位）/ manager（生命周期+崩溃恢复）/ presets（四模式）
│   ├── plugins/        # registry（GitHub/npm 市场源+安全扫描）/ manager（官方 pnpm 装卸）
│   ├── themes/         # 皮肤管理器（预设/导入导出/自定义 CSS）
│   ├── terminal/       # CLI 流式执行器
│   └── store/          # better-sqlite3（设置/工作区/插件/主题/缓存）
├── preload/            # contextBridge（window.dsh，类型安全）
├── shared/             # 主/渲染共享类型契约（IPC 通道、模型）
└── renderer/           # React 19 + Tailwind v4 渲染层
    └── src/
        ├── stores/     # Zustand（app / plugins）
        ├── components/ # TitleBar / Sidebar / CommandPalette / ui 基元
        ├── pages/      # Chat / Plugins / Themes / Terminal / Workspaces / Settings
        └── lib/theme.ts# 主题 → CSS 变量（壳 + 官方 UI 双端注入）
resources/              # 图标、内置主题
scripts/                # 图标生成 / 原生模块重建 / 冒烟测试
docs/                   # 架构、构建、插件开发、主题开发文档
```

## 架构速览

```
┌─────────────────────────────────────────────────────┐
│ Electron 渲染进程（沙箱，无 Node）                    │
│  React UI（壳） ←webview→ 官方 DSH Web UI          │
└───────────────┬─────────────────────────────────────┘
                │ IPC（contextBridge）
┌───────────────▼─────────────────────────────────────┐
│ Electron 主进程                                      │
│  窗口/托盘/菜单 · 插件管理 · 主题管理 · 终端 · SQLite │
└───────────────┬─────────────────────────────────────┘
                │ spawn: dsh --profile web --port <n>
┌───────────────▼─────────────────────────────────────┐
│ DSH 内核子进程（官方 @deepseek-ai/dsh）              │
│  Cordis 插件树 · 模型接入 · 工具调用 · 沙箱执行      │
└─────────────────────────────────────────────────────┘
```

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [构建与打包](docs/BUILD.md)
- [插件开发规范](docs/PLUGIN_DEV.md)
- [主题开发规范](docs/THEME_DEV.md)

## 许可证

MIT — 保留 DeepSeek Harness 全部版权声明；内核源码零修改，所有扩展通过官方插件机制实现。
