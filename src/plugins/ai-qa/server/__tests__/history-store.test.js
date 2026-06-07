import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { setRuntimeConfig } from '../../../../core/server/runtime-state.js';
import {
  appendMessage,
  createConversation,
  deleteConversation,
  generateTitle,
  getConversation,
  listConversations,
  updateConversation,
} from '../history-store.js';

let tmpRoot;
let historyDir;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-history-store-'));
  historyDir = path.join(tmpRoot, 'history');
  setRuntimeConfig({ rootDir: tmpRoot, aiQa: { historyDir } });
});

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe('ai-qa history-store', () => {
  it('creates, lists, updates, appends, and deletes conversations', async () => {
    const conv = await createConversation({ title: 'Custom title' });
    expect(conv.title).toBe('Custom title');
    expect(conv.lastChapterFile).toBe(null);

    expect(await listConversations()).toEqual([{
      id: conv.id,
      title: 'Custom title',
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      lastChapterFile: null,
      messageCount: 0,
    }]);

    const userMessage = await appendMessage(conv.id, {
      role: 'user',
      content: 'Question',
      context: { chapterFile: 'sample-chapter.md' },
    });
    expect(userMessage.role).toBe('user');
    expect(userMessage.context).toEqual({ chapterFile: 'sample-chapter.md' });
    expect(userMessage.thinking).toBeUndefined();

    const assistantMessage = await appendMessage(conv.id, {
      role: 'assistant',
      content: 'Answer',
      thinking: 'Hidden chain',
    });
    expect(assistantMessage.role).toBe('assistant');
    expect(assistantMessage.context).toBeUndefined();
    expect(assistantMessage.thinking).toBe('Hidden chain');

    const updated = await updateConversation(conv.id, {
      title: 'Renamed',
      lastChapterFile: 'sample-chapter.md',
    });
    expect(updated.title).toBe('Renamed');
    expect(updated.lastChapterFile).toBe('sample-chapter.md');

    const loaded = await getConversation(conv.id);
    expect(loaded.messages.map(message => message.content)).toEqual(['Question', 'Answer']);
    expect((await listConversations())[0].messageCount).toBe(2);

    expect(await deleteConversation(conv.id)).toBe(true);
    expect(await getConversation(conv.id)).toBe(null);
    expect(await deleteConversation(conv.id)).toBe(false);
  });

  it('returns null for missing conversation mutations', async () => {
    expect(await updateConversation('missing', { title: 'x' })).toBe(null);
    expect(await appendMessage('missing', { role: 'user', content: 'x' })).toBe(null);
  });

  it('falls back to an empty store when sessions file is missing or invalid', async () => {
    expect(await listConversations()).toEqual([]);

    await mkdir(historyDir, { recursive: true });
    await writeFile(path.join(historyDir, 'sessions.json'), '{broken json', 'utf-8');
    expect(await listConversations()).toEqual([]);

    await writeFile(path.join(historyDir, 'sessions.json'), JSON.stringify({ version: 2, sessions: [{ id: 'old' }] }), 'utf-8');
    expect(await listConversations()).toEqual([]);
  });

  it('generates compact titles from questions', () => {
    expect(generateTitle('  hello\nworld  ')).toBe('hello world');
    expect(generateTitle('x'.repeat(41))).toBe(`${'x'.repeat(40)}...`);
  });
});
