import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

let serverProcess;
const BASE_URL = 'http://localhost:3099';

function api(path, options) {
  return fetch(`${BASE_URL}${path}`, options);
}

beforeAll(async () => {
  serverProcess = Bun.spawn(['bun', 'run', 'src/server.js'], {
    env: { ...process.env, PORT: '3099' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  for (let i = 0; i < 50; i++) {
    try {
      const resp = await fetch(`${BASE_URL}/api/ai-qa/status`);
      if (resp.ok) return;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Server failed to start on port 3099');
}, 30000);

afterAll(() => {
  if (serverProcess) serverProcess.kill();
});

describe('AI QA API integration', () => {
  let conversationId;

  // ── Status ────────────────────────────────────────────────────────────
  it('GET /api/ai-qa/status should return available', async () => {
    const resp = await api('/api/ai-qa/status');
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.available).toBe(true);
    expect(data.activeSessions).toBe(0);
    expect(data.maxSessions).toBe(5);
  });

  // ── Sessions CRUD ─────────────────────────────────────────────────────
  it('POST /api/ai-qa/sessions should create a conversation', async () => {
    const resp = await api('/api/ai-qa/sessions', { method: 'POST' });
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.session).toBeObject();
    expect(data.session.id).toBeString();
    expect(data.session.title).toBe('新对话');
    expect(data.session.messages).toBeArray();
    expect(data.session.messages.length).toBe(0);
    conversationId = data.session.id;
  });

  it('GET /api/ai-qa/sessions should list conversations', async () => {
    const resp = await api('/api/ai-qa/sessions');
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.sessions).toBeArray();
    expect(data.sessions.length).toBeGreaterThanOrEqual(1);
    const found = data.sessions.find(s => s.id === conversationId);
    expect(found).toBeDefined();
    expect(found.messageCount).toBe(0);
  });

  it('GET /api/ai-qa/sessions/:id should get conversation', async () => {
    const resp = await api(`/api/ai-qa/sessions/${conversationId}`);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.session.id).toBe(conversationId);
    expect(data.session.messages).toBeArray();
  });

  it('GET /api/ai-qa/sessions/:id should return 404 for unknown', async () => {
    const resp = await api('/api/ai-qa/sessions/nonexistent-id');
    expect(resp.status).toBe(404);
  });

  it('PATCH /api/ai-qa/sessions/:id should rename conversation', async () => {
    const resp = await api(`/api/ai-qa/sessions/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '测试会话' }),
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.session.title).toBe('测试会话');
  });

  it('PATCH /api/ai-qa/sessions/:id should return 400 for missing title', async () => {
    const resp = await api(`/api/ai-qa/sessions/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(400);
  });

  it('PATCH /api/ai-qa/sessions/:id should return 404 for unknown', async () => {
    const resp = await api('/api/ai-qa/sessions/nonexistent-id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    expect(resp.status).toBe(404);
  });

  // ── Chat ──────────────────────────────────────────────────────────────
  it('POST /api/ai-qa/chat should return SSE stream with text deltas', async () => {
    const resp = await api('/api/ai-qa/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        question: 'Say "test ok"',
        context: { chapterFile: '01-概述.md' },
      }),
    });

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toContain('text/event-stream');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    const start = Date.now();

    while (Date.now() - start < 60000) {
      const { done, value } = await reader.read();
      if (value) fullText += decoder.decode(value, { stream: true });
      if (done || fullText.includes('event: done')) break;
    }

    expect(fullText).toContain('event: text_delta');
    expect(fullText).toContain('event: done');
  }, 90000);

  it('POST /api/ai-qa/chat should persist messages', async () => {
    // After the chat above, the conversation should have messages
    const resp = await api(`/api/ai-qa/sessions/${conversationId}`);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.session.messages.length).toBeGreaterThanOrEqual(2);
    // First message should be user
    expect(data.session.messages[0].role).toBe('user');
    // Title should have been auto-generated from first question
    expect(data.session.title).not.toBe('新对话');
  });

  it('POST /api/ai-qa/chat should return 400 for missing fields', async () => {
    const resp = await api('/api/ai-qa/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(400);
    const data = await resp.json();
    expect(data.error).toContain('Missing');
  });

  it('POST /api/ai-qa/chat should return 400 for invalid JSON', async () => {
    const resp = await api('/api/ai-qa/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(resp.status).toBe(400);
  });

  // ── Delete ────────────────────────────────────────────────────────────
  it('DELETE /api/ai-qa/sessions/:id should delete conversation', async () => {
    const resp = await api(`/api/ai-qa/sessions/${conversationId}`, { method: 'DELETE' });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.deleted).toBe(conversationId);
  });

  it('DELETE /api/ai-qa/sessions/:id should return 404 for unknown', async () => {
    const resp = await api('/api/ai-qa/sessions/nonexistent-id', { method: 'DELETE' });
    expect(resp.status).toBe(404);
  });

  it('GET /api/ai-qa/sessions/:id should return 404 after delete', async () => {
    const resp = await api(`/api/ai-qa/sessions/${conversationId}`);
    expect(resp.status).toBe(404);
  });

  it('GET /api/ai-qa/status should show 0 sessions after dispose', async () => {
    const resp = await api('/api/ai-qa/status');
    const data = await resp.json();
    expect(data.activeSessions).toBe(0);
  });
});
