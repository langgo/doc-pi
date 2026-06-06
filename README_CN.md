# doc-pi

`doc-pi` 是一个基于 Bun 的 Markdown 图书文档服务器 CLI。它可以渲染指定内容目录，并提供章节导航、渲染/源码视图切换、Mermaid/KaTeX 支持、评论，以及可选的基于 OMP agent 配置的 AI 问答。

## 使用方式

```bash
bun run bin/doc-pi.js --root ./docs --port 3000
bun run bin/doc-pi.js --root ../es_arch_book --port 4000
bun run bin/doc-pi.js --config ./doc-pi.config.js
```

如果已经 link 到本地命令：

```bash
bun link
doc-pi --root . --port 3000
```

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
|`--no-ai`|关闭 AI 问答，且不输出缺失 agent 的警告|agent 目录存在时默认开启|

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

只有当 AI 问答开启，且解析后的 `aiQa.agentDir` 存在时，`doc-pi` 才会注册 AI 问答插件。如果目录不存在，`doc-pi` 会输出警告，并且不会注册 AI 按钮、面板页签和 API 路由。使用 `--no-ai` 可以主动关闭 AI 问答，并抑制该警告。

通用示例 agent 配置位于：

```text
examples/ai-qa/omp/agent/models.yml.example
```

可以将它复制到内容项目中，例如：

```text
<content-root>/config/ai-qa/omp/agent/models.yml
```

会话历史属于运行时数据，会写入 `aiQa.historyDir`；除非显式配置，否则不会写入 `doc-pi` 包目录。

## 评论

评论以 JSON 文件形式存储在 `comments.dataDir` 下。默认是内容项目本地目录：

```text
<content-root>/data/comments
```

如果希望把评论数据放在内容目录之外，可以使用 `--comments-data-dir`。 
