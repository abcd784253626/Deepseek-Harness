# 插件开发规范（面向 dsh 生态开发者）

DSH Desktop 的插件体系与官方 DeepSeek Harness **完全同构**：桌面端不引入任何私有插件格式。
你在官方 CLI / Web UI 下开发的插件，桌面端开箱即用；反之亦然。

## 1. 插件本质

官方内核是 Cordis 插件树：每个插件是一个 npm 包，通过 profile 的 `package.json`
`dsh.profile.bundles` 列表挂载。桌面端插件市场 = 发现渠道 + 安装执行器，装载语义全部由官方内核负责。

```
$DSH_HOME/profiles/web/
├── package.json        # dependencies + dsh.profile.bundles（挂载列表）
├── cordis.yml          # 根组合（官方生成，勿手改）
├── cordis.patch.yml    # 用户补丁层（官方文档推荐手改处）
└── node_modules/       # pnpm 安装的插件
```

## 2. 插件形态（三选一）

| 形态 | 安装方式 | 场景 |
|------|---------|------|
| npm 包 | `dsh plugin --profile web add <pkg>` | 发布到 npm，市场自动收录（见 §5） |
| GitHub 仓库 | package.json 依赖 URL / marketplace 检索 | 未发布 npm，源码分发 |
| 本地目录 | `dsh plugin --profile web add link:<绝对路径>` | 开发中热迭代 |

桌面端 UI 的「导入本地插件」即第三种：选择目录 → 主进程执行 `add link:<dir>` → 自动重启内核。

## 3. 最小插件骨架

```jsonc
// package.json
{
  "name": "@your-scope/dsh-hello",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "keywords": ["dsh-plugin", "tool"],   // ← 市场分类依据
  "license": "MIT"
}
```

```js
// lib/index.js — Cordis 插件：注册一个工具
import { definePlugin } from '@deepseek-ai/cordis' // 或项目内任意 cordis 兼容入口

export const name = 'dsh-hello'

export const apply = (ctx) => {
  ctx.on('ready', () => ctx.logger.info('hello from dsh-hello'))
  // 工具 / 服务 / UI 挂载点参考官方 dsh-tool-*、dsh-client-ui-* 系列包
}
```

```yaml
# 本地测试：cordis.patch.yml 追加补丁层（官方机制，桌面端/CLI 一致）
# - id: my-plugin
#   name: '@your-scope/dsh-hello'
```

## 4. 开发循环（桌面端）

1. 开发目录初始化 `dsh plugin --profile web add link:C:\dev\dsh-hello`（或桌面端「导入本地插件」）
2. 内核重启后插件即挂载；`--dump-config` 可验证组合树
3. 修改代码：官方内置 HMR（@deepseek-ai/cordis-plugin-hmr）支持热更新
4. 就绪后 `npm publish` → 市场自动出现（GitHub topic + npm keywords）

## 5. 市场收录规则（桌面端市场数据源）

| 源 | 收录条件 |
|----|---------|
| GitHub | 仓库带 `dsh-plugin` topic；解析 HEAD 分支 package.json 的 `name` 与 `keywords` |
| npm | `keywords` 含 `dsh-plugin`，或名称匹配 `dsh-*` / `@scope/dsh-*` |

分类映射：`keywords` 命中 `model/llm` → 模型；`skill` → 技能；`ui/theme` → 界面；
`sandbox/fs/shell` → 沙箱；`tool/agent` → 工具；其余 → 其他。

安全扫描自动标记：install/preinstall/postinstall 脚本（danger）、无许可证（warn）、
仓库归档（warn）、作者缺失（info）。**请勿**在安装脚本中执行下载执行类行为，否则会被标记为高风险。

## 6. 兼容性铁律

- 不要依赖桌面端特有 API（`window.dsh` 仅桌面壳使用，官方 UI 内不可用）
- UI 插件请使用官方 `dsh-client-ui-*` 原语与主题令牌（CSS 变量），保证皮肤系统适配
- 保持 MIT 等宽松许可证，方便社区复用
