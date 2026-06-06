import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { loadComments, saveComments } from '../store.js';
import path from 'path';
import { existsSync, rmSync } from 'fs';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { setRuntimeConfig } from '../../../../core/server/runtime-state.js';

const TEST_FILE = 'test-chapter.md';
let tmpRoot;
let commentsDir;

function testJson() {
  return path.join(commentsDir, 'test-chapter.json');
}

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-store-'));
  commentsDir = path.join(tmpRoot, 'comments');
  setRuntimeConfig({ rootDir: tmpRoot, comments: { dataDir: commentsDir } });
});

afterEach(() => {
  if (tmpRoot && existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
});

describe('store', () => {
  describe('loadComments', () => {
    it('should return empty comments for non-existent file', async () => {
      const data = await loadComments('nonexistent.md');
      expect(data).toEqual({ file: 'nonexistent.md', comments: [] });
    });

    it('should load saved comments', async () => {
      const testData = {
        file: TEST_FILE,
        comments: [{ id: 'abc123', comment: 'test', selectedText: 'hello' }]
      };
      await saveComments(TEST_FILE, testData);
      const loaded = await loadComments(TEST_FILE);
      expect(loaded.comments).toHaveLength(1);
      expect(loaded.comments[0].id).toBe('abc123');
    });
  });

  describe('saveComments', () => {
    it('should save comments to JSON file', async () => {
      const testData = {
        file: TEST_FILE,
        comments: [{ id: 'xyz789', comment: 'saved', selectedText: 'world' }]
      };
      await saveComments(TEST_FILE, testData);
      expect(existsSync(testJson())).toBe(true);

      const loaded = await loadComments(TEST_FILE);
      expect(loaded.comments).toHaveLength(1);
      expect(loaded.comments[0].comment).toBe('saved');
    });

    it('should overwrite existing comments', async () => {
      await saveComments(TEST_FILE, { file: TEST_FILE, comments: [{ id: 'a' }] });
      await saveComments(TEST_FILE, { file: TEST_FILE, comments: [{ id: 'b' }, { id: 'c' }] });
      const loaded = await loadComments(TEST_FILE);
      expect(loaded.comments).toHaveLength(2);
    });
  });
});
