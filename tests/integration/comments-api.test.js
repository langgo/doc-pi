import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import { ROOT_DIR } from '../../src/core/server/config.js';
import { existsSync, mkdirSync, rmSync, unlinkSync } from 'fs';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';

let serverProcess;
let tmpRoot;
let commentsDir;
const BASE_URL = 'http://localhost:3098';
const TEST_FILE = 'sample-chapter.md';
const FIXTURE_ROOT = path.join(ROOT_DIR, 'tests', 'fixtures');
const PACKAGE_DEFAULT_COMMENTS_DIR = path.join(ROOT_DIR, 'data', 'comments');
const CONTENT_DEFAULT_COMMENTS_DIR = path.join(FIXTURE_ROOT, 'data', 'comments');
const TEST_JSON = () => path.join(commentsDir, 'sample-chapter.json');
const PACKAGE_DEFAULT_TEST_JSON = path.join(PACKAGE_DEFAULT_COMMENTS_DIR, 'sample-chapter.json');
const CONTENT_DEFAULT_TEST_JSON = path.join(CONTENT_DEFAULT_COMMENTS_DIR, 'sample-chapter.json');
let oldPackageDefaultJson;
let oldContentDefaultJson;

function api(path, options) {
  return fetch(`${BASE_URL}${path}`, options);
}

beforeAll(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-comments-api-'));
  commentsDir = path.join(tmpRoot, 'comments');
  mkdirSync(commentsDir, { recursive: true });
  if (existsSync(PACKAGE_DEFAULT_TEST_JSON)) {
    oldPackageDefaultJson = await readFile(PACKAGE_DEFAULT_TEST_JSON, 'utf-8');
    unlinkSync(PACKAGE_DEFAULT_TEST_JSON);
  }
  if (existsSync(CONTENT_DEFAULT_TEST_JSON)) {
    oldContentDefaultJson = await readFile(CONTENT_DEFAULT_TEST_JSON, 'utf-8');
    unlinkSync(CONTENT_DEFAULT_TEST_JSON);
  }

  serverProcess = Bun.spawn([
    'bun',
    'run',
    'src/server.js',
    '--root',
    'tests/fixtures',
    '--comments-data-dir',
    commentsDir,
  ], {
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

afterAll(async () => {
  if (serverProcess) serverProcess.kill();
  if (oldPackageDefaultJson !== undefined) {
    mkdirSync(PACKAGE_DEFAULT_COMMENTS_DIR, { recursive: true });
    await Bun.write(PACKAGE_DEFAULT_TEST_JSON, oldPackageDefaultJson);
  }
  if (oldContentDefaultJson !== undefined) {
    mkdirSync(CONTENT_DEFAULT_COMMENTS_DIR, { recursive: true });
    await Bun.write(CONTENT_DEFAULT_TEST_JSON, oldContentDefaultJson);
  }
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('Comments API integration', () => {
  let createdId;

  it('GET /api/comments/sample-chapter.md should return empty initially', async () => {
    const res = await api('/api/comments/sample-chapter.md');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.comments).toEqual([]);
  });

  it('POST /api/comments/sample-chapter.md should create a comment in the configured comments directory', async () => {
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

    const configuredJsonPath = TEST_JSON();
    expect(existsSync(configuredJsonPath)).toBe(true);
    const stored = JSON.parse(await readFile(configuredJsonPath, 'utf-8'));
    expect(stored.file).toBe(TEST_FILE);
    expect(stored.comments).toHaveLength(1);
    expect(stored.comments[0].id).toBe(createdId);
    expect(stored.comments[0].comment).toBe('This is an integration test comment');
    expect(existsSync(PACKAGE_DEFAULT_TEST_JSON)).toBe(false);
    expect(existsSync(CONTENT_DEFAULT_TEST_JSON)).toBe(false);
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
    const jsonPath = TEST_JSON();
    if (existsSync(jsonPath)) unlinkSync(jsonPath);
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
    const badPath = path.join(commentsDir, 'bad-chapter.json');
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
