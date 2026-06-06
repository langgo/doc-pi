import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { apiRoutes } from '../api.js';
import { loadComments, saveComments } from '../store.js';
import path from 'path';
import { existsSync, rmSync } from 'fs';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { EventEmitter } from 'events';
import { setRuntimeConfig } from '../../../../core/server/runtime-state.js';

const TEST_FILE = 'api-test.md';
let tmpRoot;
let commentsDir;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-comments-api-unit-'));
  commentsDir = path.join(tmpRoot, 'comments');
  setRuntimeConfig({ rootDir: tmpRoot, comments: { dataDir: commentsDir } });
});

afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

// Helper: create a mock request
function mockReq(method, url, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost' };
  if (body) {
    // Queue the body data
    setImmediate(() => {
      req.emit('data', JSON.stringify(body));
      req.emit('end');
    });
  } else {
    setImmediate(() => req.emit('end'));
  }
  return req;
}

// Helper: create a mock response
function mockRes() {
  let statusCode, headers, body;
  const res = {
    writeHead(code, hdrs) { statusCode = code; headers = hdrs; },
    end(data) { body = data; }
  };
  return {
    res,
    getStatus: () => statusCode,
    getBody: () => body ? JSON.parse(body) : null,
    getHeaders: () => headers,
  };
}

function findRoute(method, pathPattern) {
  return apiRoutes.find(r => r.method === method && (!pathPattern || r.path === pathPattern));
}

describe('comments API', () => {
  describe('GET /api/comments/:file', () => {
    it('should return empty comments for new file', async () => {
      const route = findRoute('GET', '/api/comments/:file');
      const req = mockReq('GET', '/api/comments/api-test.md');
      const { res, getStatus, getBody } = mockRes();

      await route.handler(req, res, { file: TEST_FILE });

      expect(getStatus()).toBe(200);
      expect(getBody().comments).toEqual([]);
    });

    it('should return existing comments', async () => {
      await saveComments(TEST_FILE, {
        file: TEST_FILE,
        comments: [{ id: 'test1', comment: 'hello', selectedText: 'text' }]
      });

      const route = findRoute('GET', '/api/comments/:file');
      const req = mockReq('GET', '/api/comments/api-test.md');
      const { res, getStatus, getBody } = mockRes();

      await route.handler(req, res, { file: TEST_FILE });

      expect(getStatus()).toBe(200);
      expect(getBody().comments).toHaveLength(1);
    });
  });

  describe('POST /api/comments/:file', () => {
    it('should create a new comment', async () => {
      const route = findRoute('POST');
      const req = mockReq('POST', '/api/comments/api-test.md', {
        selectedText: 'test text',
        comment: 'my comment',
        author: 'Tester',
      });
      const { res, getStatus, getBody } = mockRes();

      await route.handler(req, res, { file: TEST_FILE });

      expect(getStatus()).toBe(201);
      const body = getBody();
      expect(body.id).toHaveLength(8);
      expect(body.author).toBe('Tester');
      expect(body.selectedText).toBe('test text');
      expect(body.comment).toBe('my comment');
      expect(body.resolved).toBe(false);
    });

    it('should return 400 when missing required fields', async () => {
      const route = findRoute('POST');
      const req = mockReq('POST', '/api/comments/api-test.md', { comment: 'no selectedText' });
      const { res, getStatus, getBody } = mockRes();

      await route.handler(req, res, { file: TEST_FILE });

      expect(getStatus()).toBe(400);
      expect(getBody().error).toContain('Missing required fields');
    });

    it('should default author to 匿名', async () => {
      const route = findRoute('POST');
      const req = mockReq('POST', '/api/comments/api-test.md', {
        selectedText: 'text',
        comment: 'comment',
      });
      const { res, getStatus, getBody } = mockRes();

      await route.handler(req, res, { file: TEST_FILE });

      expect(getStatus()).toBe(201);
      expect(getBody().author).toBe('匿名');
    });
  });

  describe('DELETE /api/comments/:file', () => {
    it('should delete an existing comment', async () => {
      await saveComments(TEST_FILE, {
        file: TEST_FILE,
        comments: [{ id: 'del123', comment: 'to delete', selectedText: 'x' }]
      });

      const route = findRoute('DELETE');
      const req = mockReq('DELETE', '/api/comments/api-test.md?id=del123');
      const { res, getStatus, getBody } = mockRes();

      await route.handler(req, res, { file: TEST_FILE });

      expect(getStatus()).toBe(200);
      expect(getBody().deleted).toBe('del123');

      // Verify it's gone
      const data = await loadComments(TEST_FILE);
      expect(data.comments).toHaveLength(0);
    });

    it('should return 400 when missing id', async () => {
      const route = findRoute('DELETE');
      const req = mockReq('DELETE', '/api/comments/api-test.md');
      const { res, getStatus, getBody } = mockRes();

      await route.handler(req, res, { file: TEST_FILE });

      expect(getStatus()).toBe(400);
      expect(getBody().error).toContain('Missing id');
    });

    it('should return 404 when comment not found', async () => {
      const route = findRoute('DELETE');
      const req = mockReq('DELETE', '/api/comments/api-test.md?id=nonexistent');
      const { res, getStatus, getBody } = mockRes();

      await route.handler(req, res, { file: TEST_FILE });

      expect(getStatus()).toBe(404);
      expect(getBody().error).toContain('not found');
    });
  });

  describe('PATCH /api/comments/:file', () => {
    it('should update resolved status', async () => {
      await saveComments(TEST_FILE, {
        file: TEST_FILE,
        comments: [{ id: 'patch1', comment: 'old', selectedText: 'x', resolved: false }]
      });

      const route = findRoute('PATCH');
      const req = mockReq('PATCH', '/api/comments/api-test.md?id=patch1', { resolved: true });
      const { res, getStatus, getBody } = mockRes();

      await route.handler(req, res, { file: TEST_FILE });

      expect(getStatus()).toBe(200);
      expect(getBody().resolved).toBe(true);
    });

    it('should update comment text', async () => {
      await saveComments(TEST_FILE, {
        file: TEST_FILE,
        comments: [{ id: 'patch2', comment: 'old', selectedText: 'x' }]
      });

      const route = findRoute('PATCH');
      const req = mockReq('PATCH', '/api/comments/api-test.md?id=patch2', { comment: 'updated' });
      const { res, getStatus, getBody } = mockRes();

      await route.handler(req, res, { file: TEST_FILE });

      expect(getStatus()).toBe(200);
      expect(getBody().comment).toBe('updated');
    });

    it('should return 404 when comment not found', async () => {
      const route = findRoute('PATCH');
      const req = mockReq('PATCH', '/api/comments/api-test.md?id=nonexistent', { resolved: true });
      const { res, getStatus, getBody } = mockRes();

      await route.handler(req, res, { file: TEST_FILE });

      expect(getStatus()).toBe(404);
    });
  });

  describe('GET /api/comments/summary', () => {
    it('should return chapters array', async () => {
      // Create a comment first so summary is non-empty
      const postRoute = findRoute('POST', '/api/comments/:file');
      const postReq = mockReq('POST', '/api/comments/api-test.md', {
        selectedText: 'summary test',
        comment: 'summary comment',
      });
      const { res: postRes, getStatus: postStatus } = mockRes();
      await postRoute.handler(postReq, postRes, { file: TEST_FILE });
      expect(postStatus()).toBe(201);

      const route = findRoute('GET', '/api/comments/summary');
      const req = mockReq('GET', '/api/comments/summary');
      const { res, getStatus, getBody } = mockRes();

      await route.handler(req, res);

      expect(getStatus()).toBe(200);
      const body = getBody();
      expect(Array.isArray(body.chapters)).toBe(true);
      const chapter = body.chapters.find(c => c.file === 'api-test.md');
      expect(chapter).toBeDefined();
      expect(chapter.count).toBeGreaterThanOrEqual(1);
      expect(chapter.latestAt).toBeTruthy();
    });
  });
});
