# DSH Desktop 架构设计

## 1. 总体架构：三层进程模型

参照 Codex 桌面端（Electron + 内核子进程 + React 渲染层）设计：

```
┌──────────────────────────────────────────────────────────┐
│ 渲染进程（Renderer，sandbox:true, nodeIntegration:false）│
│  React 19 + Tailwind v4 + Zustand                        │
│  ┌──────────┐   ┌────────────────────────────────────┐   │
│  │ 桌面壳 UI │   │ 官方 DSH Web UI（<webview> 内嵌）  │   │
│  │ 侧栏/命令 │◄──┤ 会话/工具/轨迹/审批 —— 官方 100%    │   │
│  │ 面板/主题 │   │ 主题经 executeJavaScript 注入       │   │
│  └────┬─────┘   └────────────────────────────────────┘   │
└───────┼──────────────────────────────────────────────────┘
        │ contextBridge: window.dsh.*（仅白名单 API）
┌───────▼──────────────────────────────────────────────────┐
│ 主进程（Main）                                            │
│  窗口/托盘/菜单/对话框 · IPC 鉴权中转 · better-sqlite3    │
│  内核子进程生命周期（spawn/restart/崩溃恢复）             │
│  插件管理（官方 dsh plugin ⇄ pnpm）· 主题管理 · 凭据加密  │
└───────┬──────────────────────────────────────────────────┘
        │ spawn  dsh --profile web --host 127.0.0.1 --port <n>
        │ env   DSH_HOME=<home>  cwd=<workspace>
┌───────▼──────────────────────────────────────────────────┐
│ 内核子进程（官方 @deepseek-ai/dsh，零修改）               │
│  Cordis 插件树装载 · LLM 路由 · 工具调用 · 沙箱执行       │
│  HTTP 服务 127.0.0.1:<port>（官方 Web UI / API）          │
└──────────────────────────────────────────────────────────┘
```

### 隔离原则

- 渲染进程零 Node 能力：所有文件/进程操作经主进程 IPC 鉴权（`security.ts` 路径白名单、凭据只写不回读）。
- 内核子进程 stdout/stderr 环形缓冲（2000 行）供"内核日志"面板；HTTP 轮询判定就绪。
- 官方内核源码**零修改**；一切扩展走官方插件机制（`dsh plugin --profile web add <pkg>`）。

## 2. 内核集成（真实接口）

调研自官方 `@deepseek-ai/dsh`（v0.1.0-rc.x）CLI 源码：

| 能力 | 官方命令 | 桌面端用法 |
|------|---------|-----------|
| 启动 Web UI | `dsh --profile web --host 127.0.0.1 --port <n>` | `kernel/manager.ts`，`--port 0` 由主进程先探空闲端口 |
| 插件安装 | `dsh plugin --profile web add <spec>` | 转发 pnpm；支持 npm 包与 `link:<本地目录>` |
| 插件卸载 | `dsh plugin --profile web remove <pkg>` | 同上 |
| 配置导出 | `dsh --profile web --dump-config` | 终端面板预设命令 |
| 模式切换 | settings.yaml `agent-presets.default` | `kernel/manager.ts#applyModeToSettings` |

### 关键路径

- **DSH_HOME**：默认 `~/.dsh`（与官方 CLI 完全互通，已装的插件/模型配置直接可用）；工作区可指定独立 DSH_HOME 实现插件集与配置隔离。
- **profile 目录**：`$DSH_HOME/profiles/web/`，其中 `package.json` 的 `dsh.profile.bundles` 是官方"挂载中的插件"列表 —— 启用/禁用 = 编辑该数组。
- **四种运行模式**：官方 `config/agent-presets/{standard,code,minimal,cordis}`，通过 `settings.yaml` 的 `agent-presets.default` 切换，重启内核生效。

### 内核生命周期

```
start(workspaceId)
  ├─ 解析 dsh 路径（设置覆盖 → 环境变量 → PATH/全局 npm → 捆绑目录）
  ├─ 探空闲端口（偏好 settings.kernelPort，0=自动）
  ├─ 写模式 → settings.yaml（agent-presets.default）
  ├─ spawn（DSH_HOME / cwd 按工作区）
  ├─ HTTP 轮询就绪（90s 超时）
  └─ 异常退出 → 指数退避自动重启（1s→20s），restartAttempt 归零于稳定运行
stop()    → 优雅 kill + Windows taskkill /T 兜底
restart() → stop + start（安装插件/切模式/切工作区后调用）
```

## 3. 数据层（better-sqlite3）

`userData/dsh-desktop.db`，WAL 模式。表：

| 表 | 用途 |
|----|------|
| settings | 桌面设置（JSON 值） |
| workspaces | 工作区（name/path/dsh_home/时间戳） |
| installed_plugins | 已安装插件缓存（来源 `profiles/web/package.json` 同步） |
| themes | 用户主题（token JSON） |
| plugin_cache | 市场检索缓存（TTL 10min，防 GitHub API 限流） |

凭据独立存储 `credentials.enc.json`：`safeStorage`（Windows DPAPI）加密 base64，明文永不经过 IPC。

## 4. 主题系统

- 令牌 → CSS 变量：`ThemeTokens` → `--bg/--fg/--accent/--radius/...`，见 `renderer/src/lib/theme.ts`。
- 双端应用：桌面壳 `document.documentElement` 直接设变量；官方 Web UI 通过 webview `executeJavaScript` 注入 `<style id="dsh-desktop-theme">`。
- `.dsh-theme` 交换格式：`{ format:"dsh-desktop-theme", version:1, theme: ThemeDefinition }`。

## 5. 安全

| 项 | 措施 |
|----|------|
| 渲染进程 | sandbox + contextIsolation，仅 `window.dsh` 白名单 |
| 外部链接 | setWindowOpenHandler 一律外开系统浏览器 |
| 导航 | will-navigate 白名单（file:// / localhost dev） |
| 路径 | `assertPathInside` 拒绝工作区外路径 |
| 凭据 | DPAPI 加密落盘，明文只进不出 |
| 插件 | 安装前扫描 install/preinstall/postinstall 脚本、许可证、归档状态、作者 |
| 内核 | 仅绑定 127.0.0.1（官方对 0.0.0.0 本身即拒绝） |

## 6. 性能预算

- 空闲内存 < 200MB（内核子进程除外），单会话 < 500MB。
- 首屏：应用壳 < 2s（内核异步就绪，不阻塞 UI）。
- 主题切换：纯 CSS 变量替换，无重排无闪烁（`theme-transition` 0.15s）。
- 市场页：SQLite 缓存命中 < 500ms；冷启动 GitHub API ≤ 15s 超时兜底。
