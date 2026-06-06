import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import { ROOT_DIR } from '../../src/core/server/config.js';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { writeFile } from 'fs/promises';

let serverProcess;
const BASE_URL = 'http://localhost:3098';
const TEST_FILE = 'sample-chapter.md';
const COMMENTS_DIR = path.join(ROOT_DIR, 'data', 'comments');
const TEST_JSON = path.join(COMMENTS_DIR, 'test-chapter.json');

function api(path, options) {
  return fetch(`${BASE_URL}${path}`, options);
}

beforeAll(async () => {
  if (!existsSync(COMMENTS_DIR)) {
    mkdirSync(COMMENTS_DIR, { recursive: true });
  }

  serverProcess = Bun.spawn(['bun', 'run', 'src/server.js'], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: '3098' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE_URL}/`);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Server failed to start on port 3098');
}, 30000);

afterAll(() => {
  if (serverProcess) serverProcess.kill();
  if (existsSync(TEST_JSON)) unlinkSync(TEST_JSON);
});

describe('Comments API integration', () => {
  let createdId;

  it('GET /api/comments/sample-chapter.md should return empty initially', async () => {
    const res = await api('/api/comments/sample-chapter.md');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comments).toEqual([]);
  });

  it('POST /api/comments/sample-chapter.md should create a comment', async () => {
    const res = await api('/api/comments/sample-chapter.md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedText: 'integration test text',
        comment: 'This is an integration test comment',
        author: 'IntegrationTester',
        sectionHeading: 'Section 1',
        sectionLevel: 2,
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toHaveLength(8);
    expect(data.author).toBe('IntegrationTester');
    expect(data.selectedText).toBe('integration test text');
    expect(data.comment).toBe('This is an integration test comment');
    createdId = data.id;
  });

  it('GET should return the created comment', async () => {
    const res = await api('/api/comments/sample-chapter.md');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comments).toHaveLength(1);
    expect(data.comments[0].id).toBe(createdId);
  });

  it('POST should return 400 when missing required fields', async () => {
    const res = await api('/api/comments/sample-chapter.md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment: 'no selectedText' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Missing required fields');
  });

  it('POST should return 400 for invalid JSON', async () => {
    const res = await api('/api/comments/sample-chapter.md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json',
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid JSON');
  });

  it('PATCH should update resolved status', async () => {
    const res = await api(`/api/comments/sample-chapter.md?id=${createdId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: true }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.resolved).toBe(true);
  });

  it('PATCH should return 404 for non-existent comment', async () => {
    const res = await api('/api/comments/sample-chapter.md?id=nonexistent', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: true }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE should remove the comment', async () => {
    const res = await api(`/api/comments/sample-chapter.md?id=${createdId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(createdId);
  });

  it('GET should return empty after delete', async () => {
    const res = await api('/api/comments/sample-chapter.md');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comments).toEqual([]);
  });

  it('DELETE should return 400 when missing id', async () => {
    const res = await api('/api/comments/sample-chapter.md', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});

describe('Comments summary API', () => {
  let createdId;

  afterAll(() => {
    if (existsSync(TEST_JSON)) unlinkSync(TEST_JSON);
  });

  it('GET /api/comments/summary should return valid chapters array', async () => {
    const res = await api('/api/comments/summary');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.chapters)).toBe(true);
    // Each chapter entry should have file, count, latestAt
    for (const c of data.chapters) {
      expect(typeof c.file).toBe('string');
      expect(typeof c.count).toBe('number');
      expect(c.count).toBeGreaterThan(0);
      expect(typeof c.latestAt).toBe('string');
    }
  });

  it('summary should include chapter after comment created', async () => {
    // Create a comment
    const createRes = await api('/api/comments/sample-chapter.md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedText: 'summary test text',
        comment: 'Summary test comment',
        author: 'SummaryTester',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    createdId = created.id;

    // Check summary
    const res = await api('/api/comments/summary');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.chapters.length).toBeGreaterThanOrEqual(1);
    const chapter = data.chapters.find(c => c.file === 'sample-chapter.md');
    expect(chapter).toBeDefined();
    expect(chapter.count).toBeGreaterThanOrEqual(1);
    expect(chapter.latestAt).toBeTruthy();
  });

  it('summary should remove chapter after all comments deleted', async () => {
    // Delete the comment
    const delRes = await api(`/api/comments/sample-chapter.md?id=${createdId}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(200);

    // Check summary — chapter should be gone
    const res = await api('/api/comments/summary');
    expect(res.status).toBe(200);
    const data = await res.json();
    const chapter = data.chapters.find(c => c.file === 'sample-chapter.md');
    expect(chapter).toBeUndefined();
  });

  it('summary should ignore malformed JSON files', async () => {
    // Write a malformed JSON file directly
    const badPath = path.join(COMMENTS_DIR, 'bad-chapter.json');
    await writeFile(badPath, 'not valid json', 'utf-8');

    const res = await api('/api/comments/summary');
    expect(res.status).toBe(200);
    const data = await res.json();
    // Should not crash; bad-chapter should not appear
    const badChapter = data.chapters.find(c => c.file === 'bad-chapter.md');
    expect(badChapter).toBeUndefined();

    // Cleanup
    unlinkSync(badPath);
  });
});
