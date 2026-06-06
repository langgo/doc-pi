import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { loadComments, saveComments } from '../store.js';
import path from 'path';
import { ROOT_DIR } from '../../../../core/server/config.js';
import { existsSync, unlinkSync, rmdirSync } from 'fs';

const TEST_FILE = 'test-chapter.md';
const COMMENTS_DIR = path.join(ROOT_DIR, 'data', 'comments');
const TEST_JSON = path.join(COMMENTS_DIR, 'test-chapter.json');

function cleanup() {
  if (existsSync(TEST_JSON)) unlinkSync(TEST_JSON);
}

beforeEach(cleanup);
afterEach(cleanup);

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
      expect(existsSync(TEST_JSON)).toBe(true);

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
