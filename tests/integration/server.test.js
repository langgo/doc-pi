import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FIXTURE_ROOT = path.join(PROJECT_ROOT, 'tests', 'fixtures');

let serverProcess;
const BASE_URL = 'http://localhost:13000';

function fetchUrl(path) {
  return fetch(`${BASE_URL}${path}`);
}

beforeAll(async () => {
  serverProcess = Bun.spawn(['bun', 'run', 'src/server.js', '--root', FIXTURE_ROOT], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PORT: '13000' },
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
  throw new Error('Server failed to start on port 13000');
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
    expect(text).toContain('Fixtures');
  });

  it('GET /sample-chapter.md should render fixture markdown from --root', async () => {
    const res = await fetchUrl('/sample-chapter.md');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<!DOCTYPE html>');
    expect(text).toContain('Sample Chapter for Testing');
    expect(text).toContain('<strong>bold</strong>');
  });

  it('GET /sample-chapter.md?raw should return fixture plain text', async () => {
    const res = await fetchUrl('/sample-chapter.md?raw');
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('# Sample Chapter for Testing');
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

  it('GET /plugins/comments/client/comment.js should return JS from package assets while --root is fixtures', async () => {
    const res = await fetchUrl('/plugins/comments/client/comment.js');
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('application/javascript');
  });

  it('GET /api/search should return markdown search results', async () => {
    const res = await fetchUrl('/api/search?q=blockquote');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.query).toBe('blockquote');
    expect(body.results).toContainEqual({
      file: 'sample-chapter.md',
      line: 18,
      title: 'Sample Chapter for Testing',
      snippet: '> A blockquote for testing.',
    });
  });

  it('GET /api/search should reject missing queries', async () => {
    const res = await fetchUrl('/api/search');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('q is required');
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
