import { describe, it, expect } from 'bun:test';
import { existsSync } from 'fs';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { startServer } from '../../../../server.js';
import { getPlugins } from '../../../../core/server/plugins.js';

async function withServer(config, fn) {
  const started = await startServer(config);
  try {
    await fn(started);
  } finally {
    await new Promise(resolve => started.server.close(resolve));
  }
}

describe('AI QA plugin registration', () => {
  it('creates the agent directory and registers AI routes when the agent directory is missing', async () => {
    const tmpRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-ai-registration-'));
    const missingAgentDir = path.join(tmpRoot, 'missing-agent');
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(message);

    try {
      await withServer({
        rootDir: tmpRoot,
        root: tmpRoot,
        port: 0,
        siteTitle: 'Test Docs',
        aiQa: {
          enabled: true,
          agentDir: missingAgentDir,
          historyDir: path.join(tmpRoot, 'history'),
        },
      }, async ({ url }) => {
        expect(getPlugins().some(plugin => plugin.name === 'ai-qa')).toBe(true);
        expect(existsSync(missingAgentDir)).toBe(true);

        const statusResp = await fetch(`${url}/api/ai-qa/status`);
        expect(statusResp.status).toBe(200);
      });
    } finally {
      console.warn = originalWarn;
      await rm(tmpRoot, { recursive: true, force: true });
    }

    expect(warnings).toEqual([]);
  });

  it('does not register AI and does not warn when AI is explicitly disabled', async () => {
    const tmpRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-ai-registration-'));
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (message) => warnings.push(message);

    try {
      await withServer({
        rootDir: tmpRoot,
        root: tmpRoot,
        port: 0,
        siteTitle: 'Test Docs',
        aiQa: {
          enabled: false,
          agentDir: path.join(tmpRoot, 'missing-agent'),
          historyDir: path.join(tmpRoot, 'history'),
        },
      }, async () => {
        expect(getPlugins().some(plugin => plugin.name === 'ai-qa')).toBe(false);
      });
    } finally {
      console.warn = originalWarn;
      await rm(tmpRoot, { recursive: true, force: true });
    }

    expect(warnings).toEqual([]);
  });

  it('registers AI with the configured history directory when the agent directory exists', async () => {
    const tmpRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-ai-registration-'));
    const agentDir = path.join(tmpRoot, 'agent');
    const historyDir = path.join(tmpRoot, 'history');
    await mkdir(agentDir, { recursive: true });

    try {
      await withServer({
        rootDir: tmpRoot,
        root: tmpRoot,
        port: 0,
        siteTitle: 'Test Docs',
        aiQa: {
          enabled: true,
          agentDir,
          historyDir,
        },
      }, async ({ url }) => {
        const aiPlugin = getPlugins().find(plugin => plugin.name === 'ai-qa');
        expect(aiPlugin).toBeDefined();
        expect(aiPlugin.pageInjections.jsUrls).toContain('/plugins/ai-qa/client/register.js');

        const createResp = await fetch(`${url}/api/ai-qa/sessions`, { method: 'POST' });
        expect(createResp.status).toBe(201);
        const historyFile = path.join(historyDir, 'sessions.json');
        expect(await Bun.file(historyFile).exists()).toBe(true);
      });
    } finally {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
