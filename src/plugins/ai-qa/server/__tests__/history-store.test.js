import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, readdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { setRuntimeConfig } from '../../../../core/server/runtime-state.js';
import {
  appendMessage,
  updateMessage,
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
      ompSessionId: null,
      ompSessionFile: null,
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
      status: 'streaming',
      streamOffset: 2,
      tools: [{ id: 'tool-1', name: 'read', args: { path: 'README.md' }, status: 'started' }],
      segments: [
        { type: 'thinking', text: 'Hidden chain' },
        { type: 'tool', tool: { id: 'tool-1', name: 'read', args: { path: 'README.md' }, status: 'started' } },
      ],
    });
    expect(assistantMessage.role).toBe('assistant');
    expect(assistantMessage.context).toBeUndefined();
    expect(assistantMessage.thinking).toBe('Hidden chain');
    expect(assistantMessage.status).toBe('streaming');
    expect(assistantMessage.streamOffset).toBe(2);
    expect(assistantMessage.tools).toEqual([{ id: 'tool-1', name: 'read', args: { path: 'README.md' }, status: 'started' }]);
    expect(assistantMessage.segments).toEqual([
      { type: 'thinking', text: 'Hidden chain' },
      { type: 'tool', tool: { id: 'tool-1', name: 'read', args: { path: 'README.md' }, status: 'started' } },
    ]);

    const completedMessage = await updateMessage(conv.id, assistantMessage.id, {
      content: 'Final answer',
      thinking: 'Final chain',
      status: 'done',
      streamOffset: 3,
      tools: [{ id: 'tool-1', name: 'read', args: { path: 'README.md' }, result: 'README content', status: 'done' }],
      segments: [
        { type: 'thinking', text: 'Final chain' },
        { type: 'tool', tool: { id: 'tool-1', name: 'read', args: { path: 'README.md' }, result: 'README content', status: 'done' } },
        { type: 'answer', text: 'Final answer' },
      ],
    });
    expect(completedMessage.content).toBe('Final answer');
    expect(completedMessage.thinking).toBe('Final chain');
    expect(completedMessage.status).toBe('done');
    expect(completedMessage.streamOffset).toBe(3);
    expect(completedMessage.tools).toEqual([{ id: 'tool-1', name: 'read', args: { path: 'README.md' }, result: 'README content', status: 'done' }]);
    expect(completedMessage.segments).toEqual([
      { type: 'thinking', text: 'Final chain' },
      { type: 'tool', tool: { id: 'tool-1', name: 'read', args: { path: 'README.md' }, result: 'README content', status: 'done' } },
      { type: 'answer', text: 'Final answer' },
    ]);

    const updated = await updateConversation(conv.id, {
      title: 'Renamed',
      lastChapterFile: 'sample-chapter.md',
      ompSessionId: 'omp-session-1',
      ompSessionFile: '/tmp/omp-session-1.jsonl',
    });
    expect(updated.id).toBe('omp-session-1');
    expect(updated.title).toBe('Renamed');
    expect(updated.lastChapterFile).toBe('sample-chapter.md');
    expect(updated.ompSessionId).toBe('omp-session-1');
    expect(updated.ompSessionFile).toBe('/tmp/omp-session-1.jsonl');

    const metadataFiles = await readdir(path.join(historyDir, 'sessions'));
    expect(metadataFiles).toEqual(['omp-session-1.json']);

    expect(await getConversation(conv.id)).toBe(null);
    const loaded = await getConversation('omp-session-1');
    expect(loaded.messages.map(message => message.content)).toEqual(['Question', 'Final answer']);
    expect((await listConversations())[0].messageCount).toBe(2);

    expect(await deleteConversation('omp-session-1')).toBe(true);
    expect(await getConversation('omp-session-1')).toBe(null);
    expect(await deleteConversation('omp-session-1')).toBe(false);
  });

  it('returns null for missing conversation mutations', async () => {
    expect(await updateConversation('missing', { title: 'x' })).toBe(null);
    expect(await appendMessage('missing', { role: 'user', content: 'x' })).toBe(null);
    expect(await updateMessage('missing', 'message', { content: 'x' })).toBe(null);
  });

  it('falls back to an empty store when sessions directory files are missing or invalid', async () => {
    expect(await listConversations()).toEqual([]);

    await mkdir(path.join(historyDir, 'sessions'), { recursive: true });
    await writeFile(path.join(historyDir, 'sessions', 'broken.json'), '{broken json', 'utf-8');
    await writeFile(path.join(historyDir, 'sessions', 'wrong-version.json'), JSON.stringify({ version: 2, id: 'old' }), 'utf-8');
    expect(await listConversations()).toEqual([]);
  });

  it('generates compact titles from questions', () => {
    expect(generateTitle('  hello\nworld  ')).toBe('hello world');
    expect(generateTitle('x'.repeat(41))).toBe(`${'x'.repeat(37)}...`);
  });
});
