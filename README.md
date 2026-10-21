# 地城世界2 中文规则库 · 网站

把 Obsidian 库「地城世界2 中文规则库」发布成静态网站，供玩家在线查阅。

- **库保持外置**：库不放进本仓库，构建时按 `VAULT_DIR` 读取。在 Obsidian 里照常编辑，重新构建即可更新。
- **沿用库的外观**：自动读取 `.obsidian/appearance.json` 中启用的社区主题（当前是 Obsidian Nord）和 CSS 片段（「地城阅读」），按 Obsidian 的加载顺序叠加。页面 DOM 与 Obsidian 阅读视图一致（`markdown-preview-view`、`internal-embed markdown-embed`、`callout`、`tag` 等），所以片段里依赖 `cssclasses` 和嵌入 `src` 的选择器可以原样生效。
- **悬浮预览**：鼠标悬停内部链接时弹出 Obsidian 风格的预览卡片，支持多层嵌套、悬停标题链接时自动滚到对应段落，也可以固定成可拖拽、可缩放的浮窗，切换页面后浮窗保留。该组件改写自 Skywrite。
- 支持 wikilink、`![[嵌入]]`（递归嵌入，也支持只嵌入某个标题下的段落）、图片/PDF 嵌入、`#标签`、callout、脚注、中文粗体（CommonMark 的 CJK 强调问题已修正）、文件树（文件夹笔记会作为文件夹本身的链接）、大纲、反向链接、全文搜索（⌘K / Ctrl+K）、明暗主题切换、移动端布局。

## 本地使用

需要 Node ≥ 22.12。

```bash
npm install
cp .env.example .env     # 填写 VAULT_DIR 等
npm run dev              # http://localhost:4321，修改库内文件后浏览器会自动刷新
```

新增或重命名笔记后需要重启 `npm run dev`（页面路由在启动时生成）。

### 配置（`.env`）

| 变量 | 说明 |
|---|---|
| `VAULT_DIR` | 库的绝对路径 |
| `HOME_NOTE` | 显示在 `/` 的笔记，默认 `开始阅读` |
| `SITE_TITLE` | 站点标题 |
| `SITE_URL` | 公开地址（用于 meta 信息） |
| `EXCLUDE` | 不发布的库内路径前缀，逗号分隔，例如 `90 原文附件` |

以 `.` 开头的文件和文件夹（`.obsidian`、`.git`）以及 `.base`、`.canvas` 文件不会发布。

## 部署

构建产物是纯静态文件（`dist/`），任何静态文件服务器都能托管。

```bash
cp deploy/deploy.env.example deploy/deploy.env   # 填写 DEPLOY_TARGET=user@host:/var/www/dw2
npm run deploy                                   # 构建并用 rsync 上传
```

服务器配置示例：`deploy/nginx.conf` 或 `deploy/Caddyfile`。站点使用 `build.format: 'file'`，`/04-动作/动作` 对应 `04-动作/动作.html`，因此服务器需要按 `$uri.html` 回退查找（示例配置里已经写好）。

更新流程：在 Obsidian 中编辑 → `npm run deploy`。

## 开发

```bash
npm run lint && npm run type-check && npm test && npm run build
```

```text
src/
  config.ts                 环境变量配置
  lib/
    vault.ts                扫描库、Obsidian 式链接解析、URL slug
    markdown.ts             Markdown → Obsidian 阅读视图 DOM（wikilink / 嵌入 / 标签 / callout）
    site.ts                 页面合成（标题 id 去重、大纲）、反向链接，构建期缓存
    obsidian-css.ts         读取 .obsidian 中的主题、片段、外观设置
    file-tree.ts            侧栏文件树
    search.ts               搜索打分
    client.ts               浏览器端：主题切换、文件树、标签点击、callout 折叠
    vault-integration.ts    Astro 集成：开发时提供附件并监听库变更，构建时复制附件
  components/
    HoverPopover.tsx        悬浮预览与固定浮窗
    SearchModal.tsx         快速搜索
    FileTree.astro
  layouts/Layout.astro      页面外壳（左侧文件树 | 正文 | 大纲与反向链接）
  pages/
    [...slug].astro         每篇笔记一页
    previews/[...slug].json.ts  悬浮预览数据
    search-index.json.ts    搜索索引
    obsidian.css.ts         基础样式 + 库主题 + 片段，合并成一个样式表
  styles/
    obsidian-base.css       Obsidian CSS 变量与阅读视图基础样式（自行编写，非 Obsidian 源码）
    app.css                 站点外壳样式
```
