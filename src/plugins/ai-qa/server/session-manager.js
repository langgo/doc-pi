// AI QA Session Manager — manages omp SDK agent runtime sessions.
//
// Architecture:
//   - "Conversation" = persistent chat history (stored in history-store.js)
//   - "Runtime session" = active OMP SDK agent session (in-memory Map)
//
// Runtime sessions are created on-demand when a user sends a message.
// If a conversation has history but no active runtime session, the history
// is replayed into a new SDK session before the new question is sent.
//
// Features:
//   - System prompt injection (role + available chapter files)
//   - Tool restriction (read + web_search only)
//   - Idle timeout cleanup (5 min)
//   - Concurrency limit (5 active runtime sessions)
//   - History replay for persistent conversations

import path from 'path';
import { getContentRoot } from '../../../core/server/runtime-state.js';
import { getChapterFiles } from '../../../core/server/navigation.js';
import * as historyStore from './history-store.js';

const MAX_SESSIONS = 5;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Map<conversationId, { session, unsubscribe, lastActivity, timer, authStorage }>
const runtimeSessions = new Map();

let sdkAvailable = true;
let agentDir = null;
let persistThinking = false;
let sdkPromise = null;

async function loadSdk() {
  if (!sdkPromise) sdkPromise = import('@oh-my-pi/pi-coding-agent');
  return sdkPromise;
}

// For testing: reset internal state
export function resetForTesting() {
  for (const [, entry] of runtimeSessions) {
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.unsubscribe) entry.unsubscribe();
    if (entry.authStorage && typeof entry.authStorage.close === 'function') entry.authStorage.close();
  }
  runtimeSessions.clear();
  sdkAvailable = true;
  agentDir = null;
  persistThinking = false;
  sdkPromise = null;
}

/**
 * Configure the session manager. Called once at startup by the plugin factory.
 */
export function configure(options) {
  agentDir = options.agentDir;
  if (options.persistThinking !== undefined) {
    persistThinking = options.persistThinking;
  }
}

function buildSystemPrompt(chapterFiles) {
  const fileList = chapterFiles.map(f => `- ${f}`).join('\n');
  return `你是一个 ElasticSearch 技术文档的问答助手。你的知识来源是以下文章文件：

${fileList}

规则：
1. 简单问题直接回答，不需要使用工具
2. 需要查阅文档时，使用 read 工具读取相关章节文件
3. 需要补充外部知识时，使用 web_search 工具搜索
4. 回答要引用具体章节和段落
5. 使用中文回答
6. 你只能使用 read 和 web_search 两个工具
7. 不要读取 src/ 目录下的代码文件，只读取根目录的 .md 章节文件`;
}

function buildQuestionPrompt({ selectedText, contextBefore, contextAfter, chapterFile, question }) {
  const parts = [`[上下文] 用户正在阅读《${chapterFile}》。`];

  if (selectedText) {
    parts.push(`\n用户选中了以下内容：\n\n> ${selectedText}`);
  }

  if (contextBefore || contextAfter) {
    parts.push('\n[附近内容]');
    if (contextBefore) parts.push(`...${contextBefore}...`);
    if (selectedText) parts.push('【选中文本】');
    if (contextAfter) parts.push(`...${contextAfter}...`);
  }

  parts.push(`\n[用户问题]\n${question}`);
  return parts.join('\n');
}

function resetIdleTimer(conversationId) {
  const entry = runtimeSessions.get(conversationId);
  if (!entry) return;
  entry.lastActivity = Date.now();
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    disposeRuntimeSession(conversationId).catch(() => {});
  }, IDLE_TIMEOUT_MS);
}

// ── Runtime session management ──────────────────────────────────────────

/**
 * Create a new OMP SDK runtime session, optionally replaying history.
 * @param {string} conversationId
 * @param {Array<{role: string, content: string}>} historyMessages - messages to replay
 * @returns {Promise<object>} the SDK session object
 */
async function createRuntimeSession(conversationId, historyMessages) {
  if (!sdkAvailable) {
    throw new Error('AI 问答暂不可用');
  }

  if (runtimeSessions.size >= MAX_SESSIONS) {
    throw new Error('会话数已达上限，请稍后再试');
  }

  const chapterFiles = await getChapterFiles();

  const { createAgentSession, SessionManager, AuthStorage, ModelRegistry } = await loadSdk();
  const authStorage = await AuthStorage.create(path.join(agentDir, 'agent.db'));
  const modelRegistry = new ModelRegistry(authStorage, path.join(agentDir, 'models.yml'));

  let agentResult;
  try {
    agentResult = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      toolNames: ['read', 'web_search'],
      enableMCP: false,
      enableLsp: false,
      disableExtensionDiscovery: true,
      cwd: getContentRoot(),
      agentDir,
      authStorage,
      modelRegistry,
    });
  } catch (err) {
    authStorage.close();
    sdkAvailable = false;
    throw new Error(`AI 问答暂不可用: ${err.message}`);
  }

  const { session } = agentResult;

  // Send system prompt
  const systemPrompt = buildSystemPrompt(chapterFiles);
  await session.sendCustomMessage({ role: 'system', content: systemPrompt });

  // Replay history messages if any
  if (historyMessages && historyMessages.length > 0) {
    for (const msg of historyMessages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        try {
          await session.sendCustomMessage({ role: msg.role, content: msg.content });
        } catch {
          // If replay fails for a message, skip it and continue
        }
      }
    }
  }

  const unsubscribe = session.subscribe(() => {}); // placeholder

  runtimeSessions.set(conversationId, {
    session,
    unsubscribe,
    lastActivity: Date.now(),
    timer: null,
    authStorage,
  });

  resetIdleTimer(conversationId);

  return session;
}

/**
 * Get or create a runtime session for a conversation.
 * If the conversation has history messages, they are replayed into a new session.
 */
async function ensureRuntimeSession(conversationId) {
  const existing = runtimeSessions.get(conversationId);
  if (existing) {
    resetIdleTimer(conversationId);
    return existing.session;
  }

  // Load conversation history for replay
  let historyMessages = [];
  try {
    const conv = await historyStore.getConversation(conversationId);
    if (conv && conv.messages.length > 0) {
      historyMessages = conv.messages.map(m => ({ role: m.role, content: m.content }));
    }
  } catch {
    // If history load fails, proceed without replay
  }

  return createRuntimeSession(conversationId, historyMessages);
}

/**
 * Dispose a runtime session and clean up resources.
 */
export async function disposeAllRuntimeSessions() {
  const ids = [...runtimeSessions.keys()];
  await Promise.all(ids.map(id => disposeRuntimeSession(id)));
}

export async function disposeRuntimeSession(conversationId) {
  const entry = runtimeSessions.get(conversationId);
  if (!entry) return false;

  if (entry.timer) clearTimeout(entry.timer);
  if (entry.unsubscribe) entry.unsubscribe();

  try {
    await entry.session.dispose();
  } catch {
    // Ignore dispose errors
  }

  if (entry.authStorage && typeof entry.authStorage.close === 'function') {
    entry.authStorage.close();
  }

  runtimeSessions.delete(conversationId);
  return true;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Ask a question and get a stream of text deltas.
 * Creates a runtime session on-demand, replaying history if needed.
 *
 * @param {string} conversationId
 * @param {{ selectedText, contextBefore, contextAfter, chapterFile, question }} context
 * @returns {AsyncIterator<{ type: 'text_delta' | 'thinking_delta', delta: string }>}
 */
export async function askQuestion(conversationId, context) {
  const session = await ensureRuntimeSession(conversationId);
  const questionText = buildQuestionPrompt(context);

  // Collect assistant stream events
  const deltas = [];
  let resolveDone;
  let rejectDone;
  const donePromise = new Promise((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  // Wake mechanism: when a delta arrives or stream ends, wake the iterator
  let wakeNext = null;
  function notify() {
    if (wakeNext) {
      const w = wakeNext;
      wakeNext = null;
      w();
    }
  }

  // Re-subscribe for this request
  const entry = runtimeSessions.get(conversationId);
  if (entry.unsubscribe) entry.unsubscribe();
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'message_update') {
      const e = event.assistantMessageEvent;
      if ((e?.type === 'text_delta' || e?.type === 'thinking_delta') && e.delta) {
        deltas.push({ type: e.type, delta: e.delta });
        notify();
      }
    }
    if (event.type === 'agent_end') {
      resolveDone();
      notify();
    }
  });
  entry.unsubscribe = unsubscribe;

  // prompt() both sends the message and triggers the agent
  session.prompt(questionText).catch((err) => {
    rejectDone(err);
    notify();
  });

  // Return iterator immediately — consumer pulls deltas as they arrive
  let index = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (index < deltas.length) {
            return { value: deltas[index++], done: false };
          }

          const isDone = await Promise.race([
            donePromise.then(() => true),
            new Promise(r => { wakeNext = r; }),
          ]);

          if (isDone && index >= deltas.length) {
            return { done: true };
          }

          if (index < deltas.length) {
            return { value: deltas[index++], done: false };
          }
          return { done: true };
        },
      };
    },
  };
}

/**
 * Get current runtime session count (for monitoring).
 */
export function getRuntimeSessionCount() {
  return runtimeSessions.size;
}

/**
 * Check if SDK is available.
 */
export function isSdkAvailable() {
  return sdkAvailable;
}

/**
 * Check if thinking persistence is enabled.
 */
export function isPersistThinking() {
  return persistThinking;
}

// Re-export history store for API layer
export { historyStore };
