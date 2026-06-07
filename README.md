# doc-pi

`doc-pi` is a Bun-based CLI document server for Markdown book projects. It serves a content directory with chapter navigation, rendered/source views, Mermaid and KaTeX support, comments, and optional AI QA powered by an OMP agent configuration.

## Requirements

- Bun `>= 1.3.0`
- A Markdown content directory. `README.md` is used as the home page when present.

## Install

### Install from npm

After the package is published to npm:

```bash
npm install -g doc-pi
```

Then run:

```bash
doc-pi --root ./docs
```

The CLI entry uses `#!/usr/bin/env bun`, so users installing through npm still need Bun available on `PATH`.

### Install directly from GitHub with Bun

Install the latest `main` branch:

```bash
bun add -g github:langgo/doc-pi
```

Install a specific branch or commit:

```bash
bun add -g github:langgo/doc-pi#stream-markdown-ai-qa
bun add -g github:langgo/doc-pi#<commit-sha>
```

### Link a local checkout

For local development:

```bash
git clone https://github.com/langgo/doc-pi.git
cd doc-pi
bun install
bun link
```

Then use the linked command from any content project:

```bash
doc-pi --root .
```

## Usage

```bash
doc-pi --root ./docs
doc-pi --root ../book --port 4000
doc-pi --config ./doc-pi.config.js
doc-pi --root ./docs --no-ai-qa
```

For development without linking:

```bash
bun run bin/doc-pi.js --root ./docs --port 3000
```

By default `doc-pi` starts from port `3000`. If the preferred port is occupied, it automatically tries the next ports up to `port + 99`.

## CLI options

|Option|Description|Default|
|---|---|---|
|`--root <dir>`|Markdown content root|`.`|
|`--port <port>`|Preferred server port; occupied ports auto-increment up to `port + 99`|`3000` or `PORT`|
|`--config <file>`|Runtime config file (`.js`, `.mjs`, `.cjs`, `.json`)|none|
|`--comments-data-dir <dir>`|Comments JSON directory|`<root>/data/comments`|
|`--ai-agent-dir <dir>`|OMP agent directory for AI QA|`<root>/config/ai-qa/omp/agent`|
|`--ai-history-dir <dir>`|AI QA conversation history directory|`<root>/data/ai-qa`|
|`--no-comments`|Disable comments|enabled|
|`--no-ai-qa`|Disable AI QA / AI Ask|enabled|
|`--help`|Show CLI help|none|

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

## AI QA

AI QA is registered whenever it is enabled. Startup creates the resolved `aiQa.agentDir` automatically so the OMP SDK can read model and auth configuration there. Use `--no-ai-qa` to disable AI QA intentionally.

Model/provider setup is file-based. Copy the example:

```text
examples/ai-qa/omp/agent/models.yml.example
```

into a content project as:

```text
<content-root>/config/ai-qa/omp/agent/models.yml
```

`doc-pi` passes `<aiQa.agentDir>/models.yml` to the OMP SDK model registry. Built-in provider credentials, custom providers, custom models, and provider API keys should be configured through that OMP model configuration file.

Conversation history is runtime data and is written to `aiQa.historyDir`; it is never written to the `doc-pi` package root unless explicitly configured there.

## Comments

Comments are stored as JSON files under `comments.dataDir`. The default is content-local:

```text
<content-root>/data/comments
```

Use `--comments-data-dir` when a project wants comments outside the content tree.

## Development

```bash
bun install
bun run test:all
```

Useful scripts:

|Script|Description|
|---|---|
|`bun run start`|Run the CLI from the current checkout|
|`bun run dev`|Run the CLI in watch mode|
|`bun run test`|Run server/unit tests|
|`bun run test:integration`|Run integration API tests|
|`bun run test:e2e`|Run browser E2E tests|
|`bun run test:all`|Run all maintained test suites|

## Publishing

Dry-run the package contents before publishing:

```bash
npm pack --dry-run
```

Publish to npm:

```bash
npm login
npm publish
```

The package uses a `files` whitelist and `.npmignore` so tests, local agent instructions, lockfiles, and generated tarballs are excluded from the published package.
