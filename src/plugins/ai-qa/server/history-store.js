// AI QA History Store — per-conversation JSON metadata persistence.
//
// OMP SDK session files are the primary durable transcript store. This module
// keeps doc-pi UI metadata, selected-source context, and streaming resume state.
//
// Files: data/ai-qa/sessions/<conversation-or-omp-session-id>.json

import { readFile, writeFile, mkdir, readdir, unlink, rename } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { getRuntimeConfig } from '../../../core/server/runtime-state.js';

function dataDir() {
  return getRuntimeConfig().aiQa.historyDir;
}

function sessionsDir() {
  return path.join(dataDir(), 'sessions');
}

function safeFileName(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function sessionFile(id) {
  return path.join(sessionsDir(), `${safeFileName(id)}.json`);
}

async function ensureDir() {
  const dir = sessionsDir();
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function readConversationFile(file) {
  try {
    const raw = await readFile(file, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !data.id) return null;
    if (!Array.isArray(data.messages)) data.messages = [];
    return data;
  } catch {
    return null;
  }
}

async function writeConversation(conv) {
  await ensureDir();
  const file = sessionFile(conv.id);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, ...conv }, null, 2), 'utf-8');
  await rename(tmp, file);
}

async function listConversationFiles() {
  await ensureDir();
  try {
    const names = await readdir(sessionsDir());
    return names.filter(name => name.endsWith('.json')).map(name => path.join(sessionsDir(), name));
  } catch {
    return [];
  }
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * List all conversations (metadata only, no messages).
 * @returns {Promise<Array<{ id, title, createdAt, updatedAt, lastChapterFile, messageCount }>>}
 */
export async function listConversations() {
  const files = await listConversationFiles();
  const conversations = [];
  for (const file of files) {
    const conv = await readConversationFile(file);
    if (!conv) continue;
    conversations.push({
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      lastChapterFile: conv.lastChapterFile || null,
      ompSessionId: conv.ompSessionId || null,
      ompSessionFile: conv.ompSessionFile || null,
      messageCount: conv.messages.length,
    });
  }
  return conversations.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

/**
 * Get a single conversation with all doc-pi metadata messages.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getConversation(id) {
  await ensureDir();
  return readConversationFile(sessionFile(id));
}

/**
 * Create a new conversation.
 * @param {{ title?: string }} options
 * @returns {Promise<object>} the created conversation
 */
export async function createConversation({ title } = {}) {
  const now = new Date().toISOString();
  const conv = {
    id: crypto.randomUUID(),
    title: title || '新对话',
    createdAt: now,
    updatedAt: now,
    lastChapterFile: null,
    ompSessionId: null,
    ompSessionFile: null,
    messages: [],
  };
  await writeConversation(conv);
  return conv;
}

/**
 * Update conversation metadata. When ompSessionId is first assigned, metadata
 * file and public conversation id are aligned to that OMP session id.
 * @param {string} id
 * @param {{ title?: string, lastChapterFile?: string, ompSessionId?: string, ompSessionFile?: string }} updates
 * @returns {Promise<object|null>} updated conversation or null
 */
export async function updateConversation(id, updates) {
  const conv = await getConversation(id);
  if (!conv) return null;

  const oldId = conv.id;
  if (updates.title !== undefined) conv.title = updates.title;
  if (updates.lastChapterFile !== undefined) conv.lastChapterFile = updates.lastChapterFile;
  if (updates.ompSessionId !== undefined) {
    conv.ompSessionId = updates.ompSessionId;
    conv.id = updates.ompSessionId || conv.id;
  }
  if (updates.ompSessionFile !== undefined) conv.ompSessionFile = updates.ompSessionFile;
  conv.updatedAt = new Date().toISOString();

  await writeConversation(conv);
  if (conv.id !== oldId) {
    try { await unlink(sessionFile(oldId)); } catch {}
  }
  return conv;
}

/**
 * Append a doc-pi metadata message to a conversation.
 * @param {string} conversationId
 * @param {{ role: 'user'|'assistant', content: string, context?: object, thinking?: string, status?: string, streamOffset?: number, tools?: Array<object>, segments?: Array<object> }} msg
 * @returns {Promise<object|null>} the added message or null
 */
export async function appendMessage(conversationId, msg) {
  const conv = await getConversation(conversationId);
  if (!conv) return null;

  const message = {
    id: crypto.randomUUID(),
    role: msg.role,
    content: msg.content,
    context: msg.role === 'user' ? (msg.context || null) : undefined,
    createdAt: new Date().toISOString(),
    thinking: msg.role === 'assistant' ? (msg.thinking || null) : undefined,
    status: msg.role === 'assistant' ? (msg.status || 'done') : undefined,
    streamOffset: msg.role === 'assistant' ? (msg.streamOffset || 0) : undefined,
    tools: msg.role === 'assistant' ? (msg.tools || []) : undefined,
    segments: msg.role === 'assistant' ? (msg.segments || []) : undefined,
  };
  conv.messages.push(message);
  conv.updatedAt = new Date().toISOString();

  await writeConversation(conv);
  return message;
}

/**
 * Update an existing metadata message in a conversation.
 * @param {string} conversationId
 * @param {string} messageId
 * @param {{ content?: string, thinking?: string|null, status?: string, streamOffset?: number, tools?: Array<object>, segments?: Array<object> }} updates
 * @returns {Promise<object|null>} updated message or null
 */
export async function updateMessage(conversationId, messageId, updates) {
  const conv = await getConversation(conversationId);
  if (!conv) return null;
  const message = conv.messages.find(m => m.id === messageId);
  if (!message) return null;

  if (updates.content !== undefined) message.content = updates.content;
  if (updates.thinking !== undefined && message.role === 'assistant') message.thinking = updates.thinking;
  if (updates.status !== undefined && message.role === 'assistant') message.status = updates.status;
  if (updates.streamOffset !== undefined && message.role === 'assistant') message.streamOffset = updates.streamOffset;
  if (updates.tools !== undefined && message.role === 'assistant') message.tools = updates.tools;
  if (updates.segments !== undefined && message.role === 'assistant') message.segments = updates.segments;
  conv.updatedAt = new Date().toISOString();

  await writeConversation(conv);
  return message;
}

/**
 * Delete a conversation metadata file.
 * @param {string} id
 * @returns {Promise<boolean>} true if deleted, false if not found
 */
export async function deleteConversation(id) {
  await ensureDir();
  try {
    await unlink(sessionFile(id));
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-generate a title from the first user question.
 * Truncates to 40 chars max.
 */
export function generateTitle(question) {
  if (!question) return '新对话';
  const title = question.trim().replace(/\s+/g, ' ');
  return title.length > 40 ? title.slice(0, 37) + '...' : title;
}
