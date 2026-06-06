# doc-pi

`doc-pi` is a Bun-based CLI document server for Markdown book projects. It renders a content directory with chapter navigation, source/raw views, Mermaid/KaTeX support, comments, and optional AI Ask powered by an OMP agent config.

## Usage

```bash
bun run bin/doc-pi.js --root ./docs --port 3000
bun run bin/doc-pi.js --root ../es_arch_book --port 4000
bun run bin/doc-pi.js --config ./doc-pi.config.js
```

After linking the package:

```bash
bun link
doc-pi --root . --port 3000
```

## CLI options

|Option|Description|Default|
|---|---|---|
|`--root <dir>`|Markdown content root|`.`|
|`--port <port>`|Preferred server port; occupied ports auto-increment up to `port + 99`|`3000` or `PORT`|
|`--config <file>`|Runtime config file (`.js`, `.mjs`, `.cjs`, `.json`)|none|
|`--comments-data-dir <dir>`|Comments JSON directory|`<root>/data/comments`|
|`--ai-agent-dir <dir>`|OMP agent directory for AI Ask|`<root>/config/ai-qa/omp/agent`|
|`--ai-history-dir <dir>`|AI Ask conversation history directory|`<root>/data/ai-qa`|
|`--no-comments`|Disable comments|enabled|
|`--no-ai`|Disable AI Ask without warning|enabled when agent dir exists|

## Config file

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

Path resolution rules:

- Relative `--config` is resolved from the process current working directory.
- Relative `root` / `--root` is resolved from the process current working directory.
- Relative `comments.dataDir`, `aiQa.agentDir`, and `aiQa.historyDir` are resolved from the resolved content root.
- The config file directory is not an implicit base for content paths.
- CLI flags override config file values.

## AI Ask

AI Ask is registered only when it is enabled and the resolved `aiQa.agentDir` exists. If the directory is missing, `doc-pi` logs a warning and omits the AI button, panel tab, and API routes. Use `--no-ai` to disable it intentionally without a warning.

A generic example agent config lives at:

```text
examples/ai-qa/omp/agent/models.yml.example
```

Copy it into a content project such as:

```text
<content-root>/config/ai-qa/omp/agent/models.yml
```

Conversation history is runtime data and is written to `aiQa.historyDir`; it is never written to the `doc-pi` package root unless explicitly configured there.

## Comments

Comments are stored as JSON files under `comments.dataDir`. The default is content-local:

```text
<content-root>/data/comments
```

Use `--comments-data-dir` when a project wants comments outside the content tree.
