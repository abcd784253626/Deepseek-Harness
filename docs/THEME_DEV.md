# 主题开发规范（.dsh-theme）

## 1. 主题 = 一套令牌 + 可选 CSS

主题系统以 **CSS 变量**为唯一底层机制：桌面壳与官方 Web UI 都消费同一组变量名，
因此任何主题（内置/社区/自制）天然适配全部界面 —— 无样式错乱。

## 2. 令牌清单

```jsonc
{
  "format": "dsh-desktop-theme",
  "version": 1,
  "theme": {
    "id": "user-abc123",              // 导入时自动生成
    "name": "我的主题",
    "type": "light",                  // light | dark
    "author": "作者名",
    "description": "一句话描述",
    "source": "user",                 // builtin | user
    "tokens": {
      "bg": "#ffffff",                // 主背景
      "bgSubtle": "#f7f7f5",          // 次级背景（侧栏/hover）
      "bgElevated": "#ffffff",        // 浮层背景（命令面板/菜单）
      "fg": "#1a1a1a",                // 主文本
      "fgSecondary": "#6b6b6b",       // 次级文本
      "fgDisabled": "#b0b0b0",        // 禁用文本
      "border": "#eaeae8",            // 1px 分割线
      "accent": "#5a67d8",            // 唯一强调色（低饱和度）
      "accentFg": "#ffffff",          // 强调色上的文本
      "danger": "#d64545",
      "success": "#3d9a50",
      "radius": 10,                   // 控件圆角 px
      "fontSize": 14,                 // 基准字号 px
      "fontFamily": "\"Segoe UI\", \"Microsoft YaHei\", sans-serif"
    },
    "customCss": "/* 可选：本主题附加 CSS */"
  }
}
```

## 3. 设计原则（Codex 极简）

- 主界面仅黑白灰；**仅 1 种**低饱和度强调色标记操作状态与激活项
- 无渐变、无大面积彩色、无阴影（浮层可用极淡阴影辅助层级）
- 文本层级只靠 字号/字重/灰度（fg → fgSecondary → fgDisabled）
- 暗色主题请保证 `type:"dark"`，跟随系统时自动匹配

## 4. 高级自定义

- **全局自定义 CSS**：桌面端「主题」页底部可注入全局 CSS（独立于主题，持久保存）。
  用途示例：`body { letter-spacing: 0.2px }`、`.nav-item { border-radius: 4px }`。
- **官方 UI 注入**：同一份 CSS 变量 + customCss 会在 webview 的官方界面中
  以 `#dsh-desktop-theme` style 注入，保证双端观感一致。
- **窗口标题栏**：无边框窗口由桌面壳绘制，颜色取自 `--bg` 与 `--fg-2`，随主题自动适配。

## 5. 分享与市场

- 导出：主题页 → 导出 → 生成 `<名称>.dsh-theme`（JSON）
- 导入：主题页 → 导入（或双击文件后从设置导入）
- 发布：将 `.dsh-theme` 附于你的 dsh 插件仓库（keywords 加 `theme` 会进入「界面」分类），
  社区即可一键下载应用

## 6. 校验

| 检查项 | 要求 |
|--------|------|
| 令牌齐全 | 缺少令牌时渲染器自动回退默认值（不报错） |
| 对比度 | 主文本与背景对比 ≥ 4.5:1（WCAG AA） |
| 强调色 | 与背景对比 ≥ 3:1（控件可辨识） |
| customCss | 建议限定 `#root`/`.app-*` 作用域，避免污染 webview 注入 |
