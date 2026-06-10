import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { mkdtemp, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { ROOT_DIR } from '../../src/core/server/config.js';

let enabledServerProcess;
let noAiServerProcess;
let tmpRoot;
let agentDir;
let historyDir;
const ENABLED_BASE_URL = 'http://localhost:13002';
const NO_AI_BASE_URL = 'http://localhost:13003';
const FIXTURE_ROOT = path.join(ROOT_DIR, 'tests', 'fixtures');
const PROJECT_AGENT_DIR = path.join(ROOT_DIR, 'config', 'ai-qa', 'omp', 'agent');
const CONTENT_DEFAULT_HISTORY_FILE = path.join(FIXTURE_ROOT, 'data', 'ai-qa', 'sessions.json');
const PACKAGE_DEFAULT_HISTORY_FILE = path.join(ROOT_DIR, 'data', 'ai-qa', 'sessions.json');

function enabledApi(urlPath, options) {
  return fetch(`${ENABLED_BASE_URL}${urlPath}`, options);
}

function noAiApi(urlPath, options) {
  return fetch(`${NO_AI_BASE_URL}${urlPath}`, options);
}

async function waitForHttp(baseUrl) {
  for (let i = 0; i < 50; i++) {
    try {
      const resp = await fetch(`${baseUrl}/`);
      if (resp.ok) return;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Server failed to start on ${baseUrl}`);
}

beforeAll(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-ai-qa-api-'));
  agentDir = path.join(tmpRoot, 'agent');
  historyDir = path.join(tmpRoot, 'ai-history');
  if (existsSync(PROJECT_AGENT_DIR)) {
    cpSync(PROJECT_AGENT_DIR, agentDir, { recursive: true });
  } else {
    mkdirSync(agentDir, { recursive: true });
  }
  rmSync(CONTENT_DEFAULT_HISTORY_FILE, { force: true });
  rmSync(PACKAGE_DEFAULT_HISTORY_FILE, { force: true });

  enabledServerProcess = Bun.spawn([
    'bun',
    'run',
    'src/server.js',
    '--root',
    'tests/fixtures',
    '--ai-agent-dir',
    agentDir,
    '--ai-history-dir',
    historyDir,
  ], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: '13002' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await waitForHttp(ENABLED_BASE_URL);

  noAiServerProcess = Bun.spawn([
    'bun',
    'run',
    'src/server.js',
    '--root',
    'tests/fixtures',
    '--no-ai-qa',
  ], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: '13003' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await waitForHttp(NO_AI_BASE_URL);
}, 30000);

afterAll(() => {
  if (enabledServerProcess) enabledServerProcess.kill();
  if (noAiServerProcess) noAiServerProcess.kill();
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('AI QA API integration', () => {
  let conversationId;

  it('does not register AI routes or UI when AI is disabled', async () => {
    const statusResp = await noAiApi('/api/ai-qa/status');
    expect(statusResp.status).toBe(404);

    const pageResp = await noAiApi('/sample-chapter.md');
    expect(pageResp.status).toBe(200);
    const html = await pageResp.text();
    expect(html).not.toContain('/plugins/ai-qa/client/ai-qa.css');
    expect(html).not.toContain('/plugins/ai-qa/client/ai-qa.js');
    expect(html).not.toContain('/plugins/ai-qa/client/register.js');
    expect(html).not.toContain('window.__PLUGIN_ai-qa__');
  });

  // ── Status ────────────────────────────────────────────────────────────
  it('GET /api/ai-qa/status should return available', async () => {
    const resp = await enabledApi('/api/ai-qa/status');
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.available).toBe(true);
    expect(data.activeSessions).toBe(0);
    expect(data.maxSessions).toBe(5);
  });

  // ── Sessions CRUD ─────────────────────────────────────────────────────
  it('POST /api/ai-qa/sessions should create a conversation in the configured history directory', async () => {
    const resp = await enabledApi('/api/ai-qa/sessions', { method: 'POST' });
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.session).toBeObject();
    expect(data.session.id).toBeString();
    expect(data.session.title).toBe('新对话');
    expect(data.session.messages).toBeArray();
    expect(data.session.messages.length).toBe(0);
    conversationId = data.session.id;

    const configuredHistoryFile = path.join(historyDir, 'sessions', `${conversationId}.json`);
    expect(existsSync(configuredHistoryFile)).toBe(true);
    expect(existsSync(CONTENT_DEFAULT_HISTORY_FILE)).toBe(false);
    expect(existsSync(PACKAGE_DEFAULT_HISTORY_FILE)).toBe(false);

    const history = JSON.parse(await readFile(configuredHistoryFile, 'utf-8'));
    expect(history.id).toBe(conversationId);
  });

  it('GET /api/ai-qa/sessions should list conversations', async () => {
    const resp = await enabledApi('/api/ai-qa/sessions');
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.sessions).toBeArray();
    expect(data.sessions.length).toBeGreaterThanOrEqual(1);
    const found = data.sessions.find(s => s.id === conversationId);
    expect(found).toBeDefined();
    expect(found.messageCount).toBe(0);
  });

  it('GET /api/ai-qa/sessions/:id should get conversation', async () => {
    const resp = await enabledApi(`/api/ai-qa/sessions/${conversationId}`);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.session.id).toBe(conversationId);
    expect(data.session.messages).toBeArray();
  });

  it('GET /api/ai-qa/sessions/:id should return 404 for unknown', async () => {
    const resp = await enabledApi('/api/ai-qa/sessions/nonexistent-id');
    expect(resp.status).toBe(404);
  });

  it('PATCH /api/ai-qa/sessions/:id should rename conversation', async () => {
    const resp = await enabledApi(`/api/ai-qa/sessions/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '测试会话' }),
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.session.title).toBe('测试会话');
  });

  it('PATCH /api/ai-qa/sessions/:id should return 400 for missing title', async () => {
    const resp = await enabledApi(`/api/ai-qa/sessions/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(400);
  });

  it('PATCH /api/ai-qa/sessions/:id should return 404 for unknown', async () => {
    const resp = await enabledApi('/api/ai-qa/sessions/nonexistent-id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(resp.status).toBe(404);
  });

  // ── Chat ──────────────────────────────────────────────────────────────
  it('POST /api/ai-qa/chat should stream through SDK default model resolution', async () => {
    const resp = await enabledApi('/api/ai-qa/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        question: 'Say "test ok"',
        context: { chapterFile: 'sample-chapter.md' },
      }),
    });

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toContain('text/event-stream');
    const fullText = await resp.text();
    const sessionMatch = fullText.match(/event: session\ndata: ({[^\n]+})/);
    if (sessionMatch) conversationId = JSON.parse(sessionMatch[1]).id;
    expect(fullText).toContain('event: done');
    expect(fullText).not.toContain('请先在 AI 问答设置中配置并选择可用模型');
  }, 90000);

  it('POST /api/ai-qa/chat should persist the user message after SDK streaming', async () => {
    const resp = await enabledApi(`/api/ai-qa/sessions/${conversationId}`);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.session.messages.length).toBeGreaterThanOrEqual(1);
    expect(data.session.messages[0].role).toBe('user');
    expect(data.session.title).not.toBe('新对话');
  });

  it('POST /api/ai-qa/chat should return 400 for missing fields', async () => {
    const resp = await enabledApi('/api/ai-qa/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('Missing');
  });

  it('POST /api/ai-qa/chat should return 400 for invalid JSON', async () => {
    const resp = await enabledApi('/api/ai-qa/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(resp.status).toBe(400);
  });

  // ── Delete ────────────────────────────────────────────────────────────
  it('DELETE /api/ai-qa/sessions/:id should delete conversation', async () => {
    const resp = await enabledApi(`/api/ai-qa/sessions/${conversationId}`, { method: 'DELETE' });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.deleted).toBe(conversationId);
  });

  it('DELETE /api/ai-qa/sessions/:id should return 404 for unknown', async () => {
    const resp = await enabledApi('/api/ai-qa/sessions/nonexistent-id', { method: 'DELETE' });
    expect(resp.status).toBe(404);
  });

  it('GET /api/ai-qa/sessions/:id should return 404 after delete', async () => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const resp = await enabledApi(`/api/ai-qa/sessions/${conversationId}`);
    expect(resp.status).toBe(404);
  });

  it('GET /api/ai-qa/status should show 0 sessions after dispose', async () => {
    const resp = await enabledApi('/api/ai-qa/status');
    const data = await resp.json();
    expect(data.activeSessions).toBe(0);
  });
});
