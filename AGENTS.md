# Repository Guidelines

## Project Overview

`doc-pi` is a Bun-based CLI document server for Markdown book projects. It renders a content directory as a local documentation site with chapter navigation, rendered/raw Markdown views, Mermaid/KaTeX support, comments, and optional AI Ask backed by an OMP agent config.

## Architecture & Data Flow

- CLI entry: `bin/doc-pi.js` loads runtime config and calls `startServer(config)` from `src/server.js`.
- Config flow: `src/runtime/config.js` parses CLI flags/config files, resolves paths, and `src/core/server/runtime-state.js` stores a frozen singleton config.
- Request flow in `src/server.js`:
  1. Try plugin API routes via `tryPluginApiRoutes()`.
  2. Serve package assets from `/core/public/` and `/plugins/` using package source paths, not the content root.
  3. Render `/` from `<root>/README.md` with a file-list TOC.
  4. Render `*.md` through the Markdown pipeline and EJS template.
  5. Serve other safe content-root files as binary.
- Markdown flow in `src/core/server/markdown.js`: strip BOM → protect Mermaid/math blocks → `marked` render → heading IDs → restore Mermaid → render KaTeX.
- Plugin flow: plugins expose `{ name, apiRoutes, pageInjections }`; `apiRoutes` handle server APIs, `pageInjections` add CSS/JS/data scripts to every rendered page.
- Frontend flow: plain browser scripts, no bundler. Core modules extend `window.__core__`; plugins register selection actions, floating buttons, and panel tabs after `core:ready`.

## Key Directories

- `bin/` — CLI executable (`doc-pi`).
- `src/server.js` — server assembly, routing, plugin registration, listen/port retry logic.
- `src/runtime/` — CLI/config-file parsing and path resolution.
- `src/core/server/` — server utilities: Markdown, render, navigation, plugins, safe static serving, runtime state.
- `src/core/public/` — browser-side core UI: state, TOC sync, selection popup, floating actions, panel, article annotation.
- `src/plugins/comments/` — comments plugin: API, JSON store, client UI, comment workflow spec.
- `src/plugins/ai-qa/` — AI Ask plugin: REST/SSE API, OMP SDK session manager, history store, client UI.
- `tests/integration/` — real-server HTTP tests.
- `tests/e2e/` — Playwright browser tests.
- `tests/fixtures/` — sample content and comment data.
- `examples/ai-qa/` — example AI Ask OMP agent config files.

## Development Commands

Use Bun for all local work.

```bash
bun run bin/doc-pi.js --root ./docs --port 3000
bun run dev --root ./docs
bun test
bun run test:integration
bun run test:e2e
bun run test:self-check
bun run test:all
```

Package scripts:

- `bun start` — start the CLI entry with defaults.
- `bun run dev` — watch mode server restart.
- `bun test` — unit tests in `src/core/server/__tests__/` and plugin server tests.
- `bun run test:integration` — integration tests under `tests/integration/`.
- `bun run test:e2e` — Playwright tests under `tests/e2e/`.
- `bun run test:self-check` — structural repository checks.
- `bun run test:all` — all suites sequentially.

## Code Conventions & Common Patterns

- ESM only: `package.json` has `"type": "module"`; use `import`/`export`.
- Runtime is Bun, not Node. Prefer Bun APIs where existing code does (`Bun.spawn`, `bun:test`).
- No TypeScript and no bundler; source files are `.js`.
- Keep server modules small and explicit. Put assembly in `src/server.js`, reusable HTTP helpers in `src/core/server/server.js`.
- Runtime config is immutable after `setRuntimeConfig()`. Do not mutate `getRuntimeConfig()` results.
- Resolve user-facing filesystem paths with `resolveSafePath()` or `serveStatic()` to preserve path-traversal protections.
- Plugin API route shape:

```js
{
  method: 'GET',
  path: '/api/example/:file',
  async handler(req, res, params) { /* write response */ }
}
```

- Plugin client scripts should register through `window.__core__`, not global ad-hoc DOM wiring.
- Frontend core modules use IIFEs and namespace state under `window.__core__`.
- For new panel features, use `core.panel.addTab({ id, icon, label, render })`.
- For text-selection features, use `core.selection.addAction(...)` and article helpers in `core.article`.
- Markdown extensions should use the existing placeholder-before-`marked`, restore-after-`marked` pattern.
- Error handling is explicit: API routes return JSON errors; page/file handlers return status + plain text on failures.
- Data persistence is JSON-on-disk. Keep runtime data under the configured content root unless explicitly overridden.

## Important Files

- `package.json` — Bun scripts, CLI bin, dependencies.
- `bin/doc-pi.js` — executable entrypoint.
- `README.md` / `README_CN.md` — CLI usage and config behavior.
- `src/server.js` — primary server/router/plugin assembly.
- `src/runtime/config.js` — CLI/config-file parsing, defaults, path resolution.
- `src/core/server/runtime-state.js` — frozen singleton runtime config.
- `src/core/server/plugins.js` — plugin registry, route matching, page injection collection.
- `src/core/server/server.js` — safe path/static serving, JSON body parser, JSON response helper.
- `src/core/server/markdown.js` — Markdown, Mermaid, TOC, KaTeX processing.
- `src/core/server/navigation.js` — chapter discovery and prev/next navigation.
- `src/core/public/template/page.ejs` — HTML shell and script/CSS load order.
- `src/core/public/panel.js` — shared panel/dialog/notice system.
- `src/core/public/article-source.js` — source text locating and annotation.
- `src/plugins/comments/server/api.js` — comments CRUD API.
- `src/plugins/comments/server/store.js` — per-chapter comments JSON persistence.
- `src/plugins/comments/comments-spec.md` — canonical agent workflow for resolving comments.
- `src/plugins/ai-qa/server/api.js` — conversations API and SSE chat endpoint.
- `src/plugins/ai-qa/server/session-manager.js` — OMP SDK runtime session lifecycle.
- `src/plugins/ai-qa/server/history-store.js` — AI conversation history JSON store.
- `examples/ai-qa/omp/agent/models.yml.example` — example AI Ask model config.

## Runtime/Tooling Preferences

- Required runtime/package manager: Bun. Do not introduce npm, pnpm, yarn, webpack, Vite, or TypeScript unless explicitly requested.
- Lockfile: `bun.lock`.
- CLI config supports `.js`, `.mjs`, `.cjs`, and `.json` config files.
- Config path rules matter:
  - `--config` is resolved from process CWD.
  - `root` / `--root` is resolved from process CWD.
  - `comments.dataDir`, `aiQa.agentDir`, and `aiQa.historyDir` are resolved from the resolved content root.
- AI Ask is registered whenever enabled; startup creates `aiQa.agentDir` automatically. Use `--no-ai-qa` to disable it.
- AI Ask model setup is file-based. `doc-pi` passes `<aiQa.agentDir>/models.yml` into the OMP SDK model registry; use `examples/ai-qa/omp/agent/models.yml.example` as the template for provider/model configuration.
- Default runtime data paths:
  - Comments: `<root>/data/comments/`
  - AI history: `<root>/data/ai-qa/sessions.json`
  - AI model config: `<root>/config/ai-qa/omp/agent/models.yml`
  - AI credentials/cache: `<root>/config/ai-qa/omp/agent/agent.db`, `<root>/config/ai-qa/omp/agent/models.db`

## Testing & QA

- Test runner: `bun test` with `bun:test` (`describe`, `it`, `expect`, `mock`, `mock.module`).
- Unit tests live near source in `src/**/__tests__/`; add or update these for pure server utilities and plugin server logic.
- Integration tests in `tests/integration/` spawn real servers with `Bun.spawn` and poll fixed local ports.
- E2E tests in `tests/e2e/` use Playwright/Chromium for panel, selection, annotation, and plugin UI behavior.
- Self-check tests in `tests/self-check/` enforce package scripts, script load order, namespaced frontend APIs, and plugin seams.
- Common test patterns:
  - Use temp dirs and `setRuntimeConfig()` for file-backed stores.
  - Mock HTTP req/res with `EventEmitter` for API unit tests.
  - Mock `@oh-my-pi/pi-coding-agent` with `mock.module()` for AI session tests.
  - Use `tests/fixtures/` as content root for integration coverage.
- Run the narrowest relevant suite first, then broader suites when touching routing, plugin registration, or frontend behavior.
