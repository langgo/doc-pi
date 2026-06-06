import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import { ROOT_DIR } from '../../src/core/server/config.js';

let serverProcess;
const BASE_URL = 'http://localhost:3099';

function fetchUrl(path) {
  return fetch(`${BASE_URL}${path}`);
}

beforeAll(async () => {
  serverProcess = Bun.spawn(['bun', 'run', 'src/server.js'], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: '3099' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetchUrl('/');
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Server failed to start on port 3099');
}, 30000);

afterAll(() => {
  if (serverProcess) serverProcess.kill();
});

describe('HTTP routing integration', () => {
  it('GET / should return 200 with HTML', async () => {
    const res = await fetchUrl('/');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<!DOCTYPE html>');
    expect(text).toContain('ElasticSearch');
  });

  it('GET /01-概述.md should return 200 with HTML', async () => {
    const res = await fetchUrl('/01-概述.md');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<!DOCTYPE html>');
  });

  it('GET /01-概述.md?raw should return plain text', async () => {
    const res = await fetchUrl('/01-概述.md?raw');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('#');
  });

  it('GET /core/public/style.css should return CSS', async () => {
    const res = await fetchUrl('/core/public/style.css');
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('text/css');
  });

  it('GET /core/public/core-state.js should return JS', async () => {
    const res = await fetchUrl('/core/public/core-state.js');
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('application/javascript');
  });

  it('GET /plugins/comments/client/comment.css should return CSS', async () => {
    const res = await fetchUrl('/plugins/comments/client/comment.css');
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('text/css');
  });

  it('GET /nonexistent.md should return 404', async () => {
    const res = await fetchUrl('/nonexistent.md');
    expect(res.status).toBe(404);
  });

  it('GET /../etc/passwd should return 404 (path traversal)', async () => {
    const res = await fetchUrl('/../etc/passwd');
    expect(res.status).toBe(404);
  });
});
