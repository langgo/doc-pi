// AI QA Session Manager — manages omp SDK agent runtime sessions.
//
// Architecture:
//   - OMP SDK owns durable conversation transcripts in file-backed sessions.
//   - history-store.js stores only doc-pi metadata and streaming resume state.
//   - Runtime sessions are cached in memory for active streaming/reconnects.
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

// Map<conversationId, { session, unsubscribe, lastActivity, timer, authStorage, activeStream }>
const runtimeSessions = new Map();

let sdkAvailable = true;
let agentDir = null;
let persistThinking = true;

function sessionDir() {
  return path.join(agentDir, 'sessions');
}
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
  persistThinking = true;
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
  return `你是当前文档站点的问答助手。你的主要知识来源是当前内容目录中的 Markdown 文档：

${fileList}

规则：
1. 优先基于上方列出的 Markdown 文档回答
2. 简单问题可直接回答，不必使用工具
3. 需要查阅文档时，只使用 read 工具读取上方列出的 Markdown 文件
4. 需要补充外部知识时，可使用 web_search，并明确区分“文档内容”和“外部补充”
5. 回答应尽量引用具体文档文件、章节标题或原文依据
6. 默认使用用户提问的语言回答；如果用户使用中文，则使用中文回答
7. 你只能使用 read 和 web_search 两个工具
8. 不要读取源码、配置、运行时数据、隐藏文件或非文档文件
9. 如果文档中没有依据，应明确说明“当前文档未提供相关信息”`;
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
 * Create a new OMP SDK runtime session.
 * @param {string} conversationId
 * @returns {Promise<object>} the SDK session object
 */
async function createRuntimeSession(conversationId) {
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

  const conversation = await historyStore.getConversation(conversationId);
  const manager = conversation?.ompSessionFile
    ? await SessionManager.open(conversation.ompSessionFile, sessionDir())
    : SessionManager.create(getContentRoot(), sessionDir());

  let agentResult;
  try {
    agentResult = await createAgentSession({
      sessionManager: manager,
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

  if (!conversation?.ompSessionFile) {
    await historyStore.updateConversation(conversationId, {
      ompSessionId: session.sessionId,
      ompSessionFile: session.sessionFile,
    });
    const entry = await historyStore.getConversation(session.sessionId);
    if (entry) conversationId = session.sessionId;
  }

  // Send doc-pi system prompt as transient SDK session context.
  const systemPrompt = buildSystemPrompt(chapterFiles);
  await session.sendCustomMessage({ role: 'system', content: systemPrompt });

  const unsubscribe = session.subscribe(() => {}); // placeholder

  runtimeSessions.set(conversationId, {
    session,
    unsubscribe,
    lastActivity: Date.now(),
    timer: null,
    authStorage,
  });

  resetIdleTimer(conversationId);

  return { session, conversationId };
}

/**
 * Get or create a runtime session for a conversation.
 */
async function ensureRuntimeSession(conversationId) {
  const existing = runtimeSessions.get(conversationId);
  if (existing) {
    resetIdleTimer(conversationId);
    return { session: existing.session, conversationId };
  }

  return createRuntimeSession(conversationId);
}

/**
 * Dispose a runtime session and clean up resources.
 */
export async function disposeAllRuntimeSessions() {
  const ids = [...runtimeSessions.keys()];
  await Promise.all(ids.map(id => disposeRuntimeSession(id)));
}

export async function stopQuestion(conversationId) {
  const entry = runtimeSessions.get(conversationId);
  const stream = entry?.activeStream;
  if (!entry || !stream || stream.status !== 'streaming') return false;

  stream.status = 'stopped';
  stream.events.push({ type: 'stopped' });
  stream.error = null;
  if (typeof stream.resolveDone === 'function') stream.resolveDone();
  try {
    if (typeof entry.session.abort === 'function') await entry.session.abort();
    else if (entry.session.agent && typeof entry.session.agent.abort === 'function') entry.session.agent.abort();
  } catch {
    // Stop should still complete local stream state.
  }
  for (const waiter of stream.waiters) waiter();
  stream.waiters.clear();
  return true;
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
  const runtime = await ensureRuntimeSession(conversationId);
  const session = runtime.session;
  const runtimeConversationId = runtime.conversationId;
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

  const entry = runtimeSessions.get(runtimeConversationId);
  if (entry.activeStream?.status === 'streaming') {
    throw new Error('当前会话已有回答正在生成');
  }

  const streamState = {
    events: deltas,
    status: 'streaming',
    text: '',
    thinking: '',
    tools: [],
    segments: [],
    error: null,
    waiters: new Set(),
    donePromise,
    resolveDone,
    persisted: false,
  };
  streamState.conversationId = runtimeConversationId;
  entry.activeStream = streamState;

  function notifyStream() {
    notify();
    for (const waiter of streamState.waiters) waiter();
    streamState.waiters.clear();
  }

  if (entry.unsubscribe) entry.unsubscribe();
  const unsubscribe = session.subscribe((event) => {
    if (streamState.status !== 'streaming') return;
    if (event.type === 'message_update') {
      const e = event.assistantMessageEvent;
      if ((e?.type === 'text_delta' || e?.type === 'thinking_delta') && e.delta) {
        streamState.events.push({ type: e.type, delta: e.delta });
        if (e.type === 'text_delta') {
          streamState.text += e.delta;
          streamState.segments.push({ type: 'answer', text: e.delta });
        } else {
          streamState.thinking += e.delta;
          streamState.segments.push({ type: 'thinking', text: e.delta });
        }
        notifyStream();
      } else if (e?.type === 'toolcall_start') {
        const tool = { contentIndex: e.contentIndex, status: 'call_start' };
        streamState.tools.push(tool);
        streamState.segments.push({ type: 'tool', tool });
        streamState.events.push({ type: 'tool_call_start', tool });
        notifyStream();
      } else if (e?.type === 'toolcall_delta') {
        const tool = { contentIndex: e.contentIndex, delta: e.delta || '', status: 'call_delta' };
        streamState.tools.push(tool);
        streamState.segments.push({ type: 'tool', tool });
        streamState.events.push({ type: 'tool_call_delta', tool });
        notifyStream();
      } else if (e?.type === 'toolcall_end') {
        const tool = {
          contentIndex: e.contentIndex,
          id: e.toolCall?.id,
          name: e.toolCall?.name,
          arguments: e.toolCall?.arguments,
          status: 'call_end',
        };
        streamState.tools.push(tool);
        streamState.segments.push({ type: 'tool', tool });
        streamState.events.push({ type: 'tool_call_end', tool });
        notifyStream();
      }
    }
    if (event.type === 'tool_execution_start') {
      const tool = { id: event.toolCallId, name: event.toolName, args: event.args, status: 'started' };
      streamState.tools.push(tool);
      streamState.segments.push({ type: 'tool', tool });
      streamState.events.push({ type: 'tool_execution_start', tool });
      notifyStream();
    }
    if (event.type === 'tool_execution_end') {
      const tool = { id: event.toolCallId, name: event.toolName, result: event.result, isError: !!event.isError, status: event.isError ? 'error' : 'done' };
      streamState.tools.push(tool);
      streamState.segments.push({ type: 'tool', tool });
      streamState.events.push({ type: 'tool_execution_end', tool });
      notifyStream();
    }
    if (event.type === 'agent_end') {
      streamState.status = 'done';
      streamState.events.push({ type: 'done' });
      resolveDone();
      notifyStream();
    }
  });
  entry.unsubscribe = unsubscribe;

  session.prompt(questionText).catch((err) => {
    streamState.status = 'error';
    streamState.error = err.message;
    streamState.events.push({ type: 'error', error: err.message });
    resolveDone();
    notifyStream();
  });

  const iterable = subscribeToStreamState(streamState, 0);
  iterable.conversationId = runtimeConversationId;
  return iterable;
}

function subscribeToStreamState(streamState, offset = 0) {
  let index = Math.max(0, offset);
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (index < streamState.events.length) {
            const event = streamState.events[index];
            return { value: { ...event, index: index++ }, done: false };
          }
          if (streamState.status !== 'streaming') return { done: true };
          await new Promise(resolve => streamState.waiters.add(resolve));
          if (index < streamState.events.length) {
            const event = streamState.events[index];
            return { value: { ...event, index: index++ }, done: false };
          }
          return { done: true };
        },
        async return() {
          return { done: true };
        },
      };
    },
  };
}

export function getActiveStream(conversationId) {
  const stream = runtimeSessions.get(conversationId)?.activeStream;
  if (!stream) return null;
  return {
    status: stream.status,
    eventCount: stream.events.length,
    text: stream.text,
    thinking: stream.thinking,
    tools: stream.tools.slice(),
    segments: stream.segments.slice(),
    error: stream.error,
  };
}

export function subscribeToQuestion(conversationId, offset = 0) {
  const entry = runtimeSessions.get(conversationId);
  if (!entry?.activeStream) return null;
  resetIdleTimer(conversationId);
  return subscribeToStreamState(entry.activeStream, offset);
}

export async function waitForQuestion(conversationId) {
  const stream = runtimeSessions.get(conversationId)?.activeStream;
  if (!stream) return null;
  try {
    await stream.donePromise;
  } catch {
    // Snapshot below carries error status.
  }
  return getActiveStream(conversationId);
}

export function markActiveStreamPersisted(conversationId) {
  const stream = runtimeSessions.get(conversationId)?.activeStream;
  if (!stream || stream.persisted) return false;
  stream.persisted = true;
  return true;
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
