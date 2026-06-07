# doc-pi

`doc-pi` 是一个 Markdown 图书文档服务器 CLI。它可以渲染指定内容目录，并提供章节导航、渲染/源码视图切换、Mermaid 和 KaTeX 支持、评论，以及可选的基于 OMP agent 配置的 AI 问答。

## 环境要求

- Node.js `>= 20.0.0`
- 一个 Markdown 内容目录。目录中存在 `README.md` 时会作为首页。
- Bun 是可选项：可以用来安装依赖和运行开发测试，但发布后的 CLI 本身运行在 Node 上。

## 安装

`doc-pi` 运行在 Node 上。npm 和 Bun 都可以作为包安装器使用，按你的工作流选择即可。

### 从 npm registry 安装

包发布到 npm 后，可以使用：

```bash
npm install -g doc-pi
doc-pi --root ./docs
```

使用 Bun 安装同一个 npm registry 包：

```bash
bun add -g doc-pi
doc-pi --root ./docs
```

### 从 GitHub 仓库安装

直接安装 GitHub 最新 `main` 分支：

```bash
bun add -g github:langgo/doc-pi
doc-pi --root ./docs
```

安装指定分支或提交：

```bash
bun add -g github:langgo/doc-pi#stream-markdown-ai-qa
bun add -g github:langgo/doc-pi#<commit-sha>
```

如果希望使用 npm 语法安装同一个 GitHub 源：

```bash
npm install -g github:langgo/doc-pi
npm install -g github:langgo/doc-pi#<branch-or-commit>
```

### 从本地 checkout 安装

本地开发时，可以把仓库 checkout link 到全局：

```bash
git clone https://github.com/langgo/doc-pi.git
cd doc-pi
bun install
bun link
doc-pi --root ./docs
```

等价的 npm 本地安装方式：

```bash
git clone https://github.com/langgo/doc-pi.git
cd doc-pi
npm install
npm install -g .
doc-pi --root ./docs
```

### 安装命令对照

|来源|Bun|npm|
|---|---|---|
|已发布 npm 包|`bun add -g doc-pi`|`npm install -g doc-pi`|
|GitHub `main`|`bun add -g github:langgo/doc-pi`|`npm install -g github:langgo/doc-pi`|
|GitHub 分支/提交|`bun add -g github:langgo/doc-pi#<ref>`|`npm install -g github:langgo/doc-pi#<ref>`|
|本地 checkout|在仓库根目录执行 `bun link`|在仓库根目录执行 `npm install -g .`|

所有安装方式最终都会暴露同一个命令：

```bash
doc-pi --root ./docs
```

## 使用方式

```bash
doc-pi --root ./docs
doc-pi --root ../book --port 4000
doc-pi --config ./doc-pi.config.js
doc-pi --root ./docs --no-ai-qa
```

如果不 link，开发时也可以直接运行仓库中的入口：

```bash
node bin/doc-pi.js --root ./docs --port 3000
bun run bin/doc-pi.js --root ./docs --port 3000
```

默认从端口 `3000` 启动。如果首选端口已被占用，会自动尝试后续端口，最多尝试到 `port + 99`。

## CLI 选项

|选项|说明|默认值|
|---|---|---|
|`--root <dir>`|Markdown 内容根目录|`.`|
|`--port <port>`|优先使用的服务端口；端口占用时会自动递增，最多尝试到 `port + 99`|`3000` 或 `PORT` 环境变量|
|`--config <file>`|运行时配置文件（`.js`、`.mjs`、`.cjs`、`.json`）|无|
|`--comments-data-dir <dir>`|评论 JSON 存储目录|`<root>/data/comments`|
|`--ai-agent-dir <dir>`|AI 问答使用的 OMP agent 目录|`<root>/config/ai-qa/omp/agent`|
|`--ai-history-dir <dir>`|AI 问答会话历史目录|`<root>/data/ai-qa`|
|`--no-comments`|关闭评论功能|默认开启|
|`--no-ai-qa`|关闭 AI QA / AI 问答|默认开启|
|`--help`|显示 CLI 帮助|无|

## 配置文件

```js
export default {
  root: '.',
  port: 3000,
  siteTitle: 'Docs',
  comments: {
    enabled: true,
    dataDir: 'data/comments',
  },
  aiQa: {
    enabled: true,
    agentDir: 'config/ai-qa/omp/agent',
    historyDir: 'data/ai-qa',
  },
};
```

路径解析规则：

- 相对路径形式的 `--config` 基于当前进程工作目录解析。
- 相对路径形式的 `root` / `--root` 基于当前进程工作目录解析。
- 相对路径形式的 `comments.dataDir`、`aiQa.agentDir`、`aiQa.historyDir` 基于解析后的内容根目录解析。
- 配置文件所在目录不会被隐式用作内容路径的基准目录。
- CLI 参数优先级高于配置文件。

## AI 问答

只要 AI 问答开启，`doc-pi` 就会注册 AI 问答插件。启动时会自动创建解析后的 `aiQa.agentDir`，以便 OMP SDK 从该目录读取模型和认证配置。使用 `--no-ai-qa` 可以主动关闭 AI QA / AI 问答。

模型和 Provider 使用文件配置。先复制示例：

```text
examples/ai-qa/omp/agent/models.yml.example
```

到内容项目中：

```text
<content-root>/config/ai-qa/omp/agent/models.yml
```

`doc-pi` 会把 `<aiQa.agentDir>/models.yml` 传给 OMP SDK model registry。内置 Provider 凭证、自定义 Provider、自定义模型和 Provider API Key 都应通过这个 OMP 模型配置文件维护。

会话历史属于运行时数据，会写入 `aiQa.historyDir`；除非显式配置，否则不会写入 `doc-pi` 包目录。

## 评论

评论以 JSON 文件形式存储在 `comments.dataDir` 下。默认是内容项目本地目录：

```text
<content-root>/data/comments
```

如果希望把评论数据放在内容目录之外，可以使用 `--comments-data-dir`。

## 开发

```bash
npm install
npm run start
```

测试目前使用 Bun test runner：

```bash
bun install
bun run test:all
```

常用脚本：

|脚本|说明|
|---|---|
|`npm run start` / `bun run start`|使用 Node 从当前 checkout 运行 CLI|
|`npm run dev` / `bun run dev`|使用 Node watch 模式运行 CLI|
|`bun run test`|运行服务端/单元测试|
|`bun run test:integration`|运行集成 API 测试|
|`bun run test:e2e`|运行浏览器 E2E 测试|
|`bun run test:all`|运行全部维护中的测试套件|

## 发布

发布前先 dry-run 检查包内容：

```bash
npm pack --dry-run
```

发布到 npm：

```bash
npm login
npm publish
```

包通过 `files` 白名单和 `.npmignore` 控制发布内容，测试文件、本地 agent 指令、lockfile 和生成的 tarball 不会进入发布包。
