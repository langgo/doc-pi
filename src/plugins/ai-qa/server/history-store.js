// AI QA History Store — JSON file persistence for conversations.
//
// Stores conversation metadata and messages to disk so they survive
// server restarts and page refreshes.
//
// File: data/ai-qa/sessions.json
//
// Schema:
// {
//   version: 1,
//   sessions: [
//     {
//       id: string,
//       title: string,
//       createdAt: ISO string,
//       updatedAt: ISO string,
//       lastChapterFile: string | null,
//       messages: [
//         {
//           id: string,
//           role: 'user' | 'assistant',
//           content: string,
//           context: object | null,   // user messages only
//           createdAt: ISO string,
//           thinking: string | null   // assistant only, only when persistThinking=true
//         }
//       ]
//     }
//   ]
// }

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../../../core/server/runtime-state.js';

function dataDir() {
  return getRuntimeConfig().aiQa.historyDir;
}

function sessionsFile() {
  return path.join(dataDir(), 'sessions.json');
}

async function ensureDir() {
  const dir = dataDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function readStore() {
  await ensureDir();
  if (!existsSync(sessionsFile())) {
    return { version: 1, sessions: [] };
  }
  try {
    const raw = await readFile(sessionsFile(), 'utf-8');
    const data = JSON.parse(raw);
    return data && data.version === 1 ? data : { version: 1, sessions: [] };
  } catch {
    return { version: 1, sessions: [] };
  }
}

async function writeStore(data) {
  await ensureDir();
  // Atomic write: write to temp file then rename
  const file = sessionsFile();
  const tmp = file + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  const { rename } = await import('fs/promises');
  await rename(tmp, file);
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * List all conversations (metadata only, no messages).
 * @returns {Promise<Array<{ id, title, createdAt, updatedAt, lastChapterFile, messageCount }>>}
 */
export async function listConversations() {
  const store = await readStore();
  return store.sessions.map(s => ({
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    lastChapterFile: s.lastChapterFile || null,
    messageCount: s.messages.length,
  }));
}

/**
 * Get a single conversation with all messages.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getConversation(id) {
  const store = await readStore();
  const conv = store.sessions.find(s => s.id === id);
  return conv || null;
}

/**
 * Create a new conversation.
 * @param {{ title?: string }} options
 * @returns {Promise<object>} the created conversation
 */
export async function createConversation({ title } = {}) {
  const store = await readStore();
  const now = new Date().toISOString();
  const conv = {
    id: crypto.randomUUID(),
    title: title || '新对话',
    createdAt: now,
    updatedAt: now,
    lastChapterFile: null,
    messages: [],
  };
  store.sessions.push(conv);
  await writeStore(store);
  return conv;
}

/**
 * Update conversation metadata (title, lastChapterFile).
 * @param {string} id
 * @param {{ title?: string, lastChapterFile?: string }} updates
 * @returns {Promise<object|null>} updated conversation or null
 */
export async function updateConversation(id, updates) {
  const store = await readStore();
  const conv = store.sessions.find(s => s.id === id);
  if (!conv) return null;

  if (updates.title !== undefined) conv.title = updates.title;
  if (updates.lastChapterFile !== undefined) conv.lastChapterFile = updates.lastChapterFile;
  conv.updatedAt = new Date().toISOString();

  await writeStore(store);
  return conv;
}

/**
 * Append a message to a conversation.
 * @param {string} conversationId
 * @param {{ role: 'user'|'assistant', content: string, context?: object, thinking?: string }} msg
 * @returns {Promise<object|null>} the added message or null
 */
export async function appendMessage(conversationId, msg) {
  const store = await readStore();
  const conv = store.sessions.find(s => s.id === conversationId);
  if (!conv) return null;

  const message = {
    id: crypto.randomUUID(),
    role: msg.role,
    content: msg.content,
    context: msg.role === 'user' ? (msg.context || null) : undefined,
    createdAt: new Date().toISOString(),
    thinking: msg.role === 'assistant' ? (msg.thinking || null) : undefined,
  };

  conv.messages.push(message);
  conv.updatedAt = new Date().toISOString();

  await writeStore(store);
  return message;
}

/**
 * Delete a conversation.
 * @param {string} id
 * @returns {Promise<boolean>} true if deleted, false if not found
 */
export async function deleteConversation(id) {
  const store = await readStore();
  const idx = store.sessions.findIndex(s => s.id === id);
  if (idx === -1) return false;

  store.sessions.splice(idx, 1);
  await writeStore(store);
  return true;
}

/**
 * Auto-generate a title from the first user question.
 * Truncates to 40 chars max.
 */
export function generateTitle(question) {
  const cleaned = question.replace(/\s+/g, ' ').trim();
  return cleaned.length > 40 ? cleaned.slice(0, 40) + '...' : cleaned;
}
