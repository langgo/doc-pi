import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { resolveRuntimeConfig } from '../config.js';

let tmpRoot;

async function makeWorkspace() {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-config-'));
  return tmpRoot;
}

async function writeReadme(dir, content) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'README.md'), content, 'utf-8');
}

beforeEach(async () => {
  await makeWorkspace();
});

afterEach(async () => {
  if (tmpRoot) {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

describe('resolveRuntimeConfig', () => {
  it('resolves relative root from cwd', async () => {
    const cwd = tmpRoot;
    const docsDir = path.join(cwd, 'docs');
    await writeReadme(docsDir, '# Relative Docs\n');

    const config = await resolveRuntimeConfig({ argv: ['--root', 'docs'], cwd });

    expect(config.rootDir).toBe(docsDir);
    expect(config.root).toBe(docsDir);
    expect(config.siteTitle).toBe('Relative Docs');
  });

  it('resolves relative comments, agent, and history dirs from rootDir', async () => {
    const cwd = tmpRoot;
    const docsDir = path.join(cwd, 'book');
    await writeReadme(docsDir, '# Book\n');

    const config = await resolveRuntimeConfig({
      cwd,
      configObject: {
        root: 'book',
        comments: { dataDir: 'custom/comments' },
        aiQa: { agentDir: 'agents/main', historyDir: 'histories/main' },
      },
    });

    expect(config.comments.dataDir).toBe(path.join(docsDir, 'custom', 'comments'));
    expect(config.aiQa.agentDir).toBe(path.join(docsDir, 'agents', 'main'));
    expect(config.aiQa.historyDir).toBe(path.join(docsDir, 'histories', 'main'));
  });

  it('lets CLI flags override config object values', async () => {
    const cwd = tmpRoot;
    const docsDir = path.join(cwd, 'docs');
    await writeReadme(docsDir, '# CLI Docs\n');

    const config = await resolveRuntimeConfig({
      cwd,
      argv: [
        '--root', 'docs',
        '--port', '5050',
        '--comments-data-dir', 'cli-comments',
        '--ai-agent-dir', 'cli-agent',
        '--ai-history-dir', 'cli-history',
        '--no-comments',
        '--no-ai',
      ],
      configObject: {
        root: 'ignored-root',
        port: 4040,
        comments: { enabled: true, dataDir: 'object-comments' },
        aiQa: { enabled: true, agentDir: 'object-agent', historyDir: 'object-history' },
      },
    });

    expect(config.rootDir).toBe(docsDir);
    expect(config.port).toBe(5050);
    expect(config.comments.enabled).toBe(false);
    expect(config.comments.dataDir).toBe(path.join(docsDir, 'cli-comments'));
    expect(config.aiQa.enabled).toBe(false);
    expect(config.aiQa.agentDir).toBe(path.join(docsDir, 'cli-agent'));
    expect(config.aiQa.historyDir).toBe(path.join(docsDir, 'cli-history'));
  });

  it('resolves config path from cwd while content paths resolve from rootDir', async () => {
    const cwd = tmpRoot;
    const docsDir = path.join(cwd, 'docs');
    const configDir = path.join(cwd, 'nested');
    await writeReadme(docsDir, '# Config Docs\n');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, 'doc-pi.config.json'),
      JSON.stringify({
        root: 'docs',
        comments: { dataDir: 'comments-from-root' },
        aiQa: { agentDir: 'agent-from-root', historyDir: 'history-from-root' },
      }),
      'utf-8',
    );

    const config = await resolveRuntimeConfig({ argv: ['--config', 'nested/doc-pi.config.json'], cwd });

    expect(config.configPath).toBe(path.join(configDir, 'doc-pi.config.json'));
    expect(config.rootDir).toBe(docsDir);
    expect(config.comments.dataDir).toBe(path.join(docsDir, 'comments-from-root'));
    expect(config.aiQa.agentDir).toBe(path.join(docsDir, 'agent-from-root'));
    expect(config.aiQa.historyDir).toBe(path.join(docsDir, 'history-from-root'));
  });

  it('loads JavaScript config files with dynamic import', async () => {
    const cwd = tmpRoot;
    const docsDir = path.join(cwd, 'js-docs');
    await writeReadme(docsDir, '# JS Docs\n');
    await writeFile(
      path.join(cwd, 'doc-pi.config.js'),
      'export default { root: "js-docs", port: 4545, comments: { dataDir: "js-comments" } };\n',
      'utf-8',
    );

    const config = await resolveRuntimeConfig({ argv: ['--config', 'doc-pi.config.js'], cwd });

    expect(config.rootDir).toBe(docsDir);
    expect(config.port).toBe(4545);
    expect(config.comments.dataDir).toBe(path.join(docsDir, 'js-comments'));
  });

  it('uses Docs when README H1 cannot be extracted', async () => {
    const cwd = tmpRoot;
    const docsDir = path.join(cwd, 'untitled');
    await writeReadme(docsDir, 'No heading here\n');

    const configWithoutHeading = await resolveRuntimeConfig({ argv: ['--root', 'untitled'], cwd });
    expect(configWithoutHeading.siteTitle).toBe('Docs');

    const missingReadmeDir = path.join(cwd, 'missing-readme');
    await mkdir(missingReadmeDir, { recursive: true });
    const configWithoutReadme = await resolveRuntimeConfig({ argv: ['--root', 'missing-readme'], cwd });
    expect(configWithoutReadme.siteTitle).toBe('Docs');
  });
});
