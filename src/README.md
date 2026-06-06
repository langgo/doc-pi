# src/ — 源码目录

## 架构

三层架构：`core/`（框架） + `plugins/`（插件） + `server.js`（组装入口）。

```
src/
├── server.js              # 组装入口：路由、handler 分发、启动逻辑
├── core/
│   ├── server/            # 后端模块
│   │   ├── config.js      # 端口、marked.js 配置、ROOT_DIR
│   │   ├── plugins.js     # 插件系统：注册、路由匹配、注入收集
│   │   ├── server.js      # HTTP 工具函数：resolveSafePath, serveStatic, parseBody, json
│   │   ├── render.js      # EJS 模板渲染、escapeHtml
│   │   ├── markdown.js    # Markdown 处理：TOC 提取、Mermaid/KaTeX 保护
│   │   ├── navigation.js  # 章节发现、前后导航、文件列表 TOC
│   │   └── __tests__/     # 单测（旁置）
│   └── public/            # 前端静态资源
│       ├── template/
│       │   └── page.ejs   # EJS 页面模板
│       ├── style.css
│       ├── core-state.js
│       ├── dom-utils.js
│       ├── selection-popup.js
│       ├── floating-actions.js
│       ├── panel.js
│       └── article-source.js
└── plugins/
    └── comments/          # 评论插件
        ├── index.js       # 插件入口
        ├── comments-spec.md
        ├── server/        # 后端：API 路由 + 数据存储
        │   ├── api.js
        │   ├── store.js
        │   └── __tests__/
        └── client/        # 前端：CSS + JS
            ├── comment.css
            └── comment.js
```

## 模块职责

|模块|职责|
|---|---|
|`core/server/config.js`|`ROOT_DIR`、`PORT`、`SITE_TITLE`、marked.js 配置|
|`core/server/plugins.js`|插件注册、API 路由匹配、页面注入收集|
|`core/server/server.js`|路径安全校验、静态文件服务、JSON 解析/响应|
|`core/server/render.js`|EJS 模板渲染、HTML 转义|
|`core/server/markdown.js`|BOM 剥离、slug 生成、TOC 提取、Markdown→HTML（含 Mermaid/KaTeX）|
|`core/server/navigation.js`|章节文件发现、前后导航、文件列表 TOC|
|`plugins/comments/server/api.js`|评论 CRUD API（GET/POST/PATCH/DELETE）|
|`plugins/comments/server/store.js`|评论 JSON 文件读写|

## 插件系统

插件导出 `{ name, apiRoutes, pageInjections }`：

- **apiRoutes** — `[{ method, path, handler(req, res, params) }]`，path 支持 `:param` 段
- **pageInjections** — `{ cssUrls, jsUrls, data(file) }`，注入到每个页面

在 `src/server.js` 中调用 `registerPlugin(plugin)` 注册。
