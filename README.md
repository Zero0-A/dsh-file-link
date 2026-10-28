# dsh-file-link-menu

在 DSH（DeepSeek Harness）Web 聊天里**右键文件链接**，弹出与 DSH 同风格的菜单：

| 菜单项 | 行为 |
|---|---|
| 打开文件 | 用系统默认程序打开该文件（桌面宿主不可用时自动隐藏此项） |
| 打开文件所在目录 | 在资源管理器 / Finder 中定位该文件 |
| 复制文件地址 | 把文件的**绝对路径**复制到剪贴板（成功后顶部 toast 提示） |

支持的链接形态（都是 DSH 自己渲染出来的文件链接）：

- Markdown 文件链接，例如 `[报告](docs/07-并发测试报告.md)`
- 消息里的行内产物引用，例如 `docs/07-并发测试报告.md`、`tools/concurrency-test.js`
- 图片文件链接（有缩略图预览的那种）
- “已编辑 N 个文件”卡片里的文件行
- 交付物（presented）卡片

## 实现要点

- 纯客户端插件：`lib/client.js` 通过 `window.__ModuleLoader__.load` 注册，向 `shell.overlay` 槽位挂一个全局右键菜单宿主。
- 菜单外观、键盘操作（↑/↓/Home/End/Esc/Enter）、点击外部关闭都复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Menu` / `MenuItemButton` / `Toast`，因此和 DSH 原生菜单完全一致。
- 打开 / 定位走宿主 Remote `session.openWorkspacePath({ path, action? })`（与官方“打开 / 显示文件位置”同一套 API）；相对路径会用当前会话的 `cwd` 补成绝对路径。
- 复制地址用 primitives 的 `writeClipboard`（优先 Clipboard API，失败回退 execCommand）。
- 宿主半侧 `lib/index.js` 是空插件：本功能不需要宿主代码，条目存在只为把包纳入 Loader 组合。

## 安装

插件目录放到 DSH 插件目录（本机为 `C:\Users\Administrator\.dsh\plugins\dsh-file-link-menu`），然后：

1. 在 profile（`C:\Users\Administrator\.dsh\profiles\web`）的 `package.json` 里加依赖：

   ```json
   "dsh-file-link-menu": "file:../../plugins/dsh-file-link-menu"
   ```

2. 把 `"dsh-file-link-menu"` 追加到同文件 `dsh.profile.bundles` 数组末尾。
3. 在 profile 目录执行 `pnpm install`（或使用 `dsh plugin --profile web add <绝对路径>`）。
4. 重启 `dsh web` / 刷新页面。

## 启用 / 停用

- 停用：从 `dsh.profile.bundles` 移除，或在 `cordis.patch.yml` 写入
  `- id: file-link-menu\n  disabled: true` 后重启。
- 本插件不修改任何 DSH 原生行为，只监听文件链接上的 `contextmenu`；普通文本、外链右键仍是浏览器/DSH 原生菜单。

## 兼容性

- 目标：DSH `0.2.0-rc.2`（Web 组合，`shell.overlay` 槽位 + `session.openWorkspacePath` Remote）。
- 无第三方依赖；只 `require` 平台种子模块 `react` 与 `@deepseek-ai/dsh-client-ui-primitives`。

## License

MIT
