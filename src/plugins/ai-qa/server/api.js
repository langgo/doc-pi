// AI QA HTTP API — REST CRUD for conversations + SSE chat.
//
// GET    /api/ai-qa/sessions       — list conversations
// POST   /api/ai-qa/sessions       — create conversation
// GET    /api/ai-qa/sessions/:id   — get conversation with messages
// PATCH  /api/ai-qa/sessions/:id   — update conversation (title)
// DELETE /api/ai-qa/sessions/:id   — delete conversation + dispose runtime session
// POST   /api/ai-qa/chat           — SSE stream, body: { conversationId, question, context }
// GET    /api/ai-qa/sessions/:id/resume — snapshot + active SSE stream
// GET    /api/ai-qa/sessions/:id/stream — resume active SSE stream
// GET    /api/ai-qa/status         — availability + runtime session count

import {
  askQuestion,
  subscribeToQuestion,
  waitForQuestion,
  markActiveStreamPersisted,
  stopQuestion,
  disposeRuntimeSession,
  getRuntimeSessionCount,
  isSdkAvailable,
  isPersistThinking,
  historyStore,
} from './session-manager.js';
import { parseBody, json } from '../../../core/server/server.js';

function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

function eventPayload(event) {
  if (event.type === 'text_delta' || event.type === 'thinking_delta') return { delta: event.delta, index: event.index };
  if (event.type === 'tool_call_start' || event.type === 'tool_call_delta' || event.type === 'tool_call_end' ||
      event.type === 'tool_execution_start' || event.type === 'tool_execution_end') return { tool: event.tool, index: event.index };
  return { index: event.index };
}

function sseWrite(res, event, data) {
  const lines = [];
  if (event) lines.push(`event: ${event}`);
  if (typeof data === 'object') {
    lines.push(`data: ${JSON.stringify(data)}`);
  } else {
    lines.push(`data: ${data}`);
  }
  lines.push('', ''); // double newline terminates the message
  res.write(lines.join('\n'));
}

export const apiRoutes = [
  // ── GET /api/ai-qa/sessions — list conversations ──────────────────────
  {
    method: 'GET',
    path: '/api/ai-qa/sessions',
    async handler(req, res) {
      try {
        const sessions = await historyStore.listConversations();
        json(res, 200, { sessions });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
    },
  },

  // ── POST /api/ai-qa/sessions — create conversation ────────────────────
  {
    method: 'POST',
    path: '/api/ai-qa/sessions',
    async handler(req, res) {
      let body;
      try {
        body = await parseBody(req);
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }

      try {
        const conv = await historyStore.createConversation({ title: body?.title });
        json(res, 201, { session: conv });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
    },
  },

  // ── GET /api/ai-qa/sessions/:id — get conversation ────────────────────
  {
    method: 'GET',
    path: '/api/ai-qa/sessions/:id',
    async handler(req, res, params) {
      try {
        const conv = await historyStore.getConversation(params.id);
        if (!conv) {
          json(res, 404, { error: 'Conversation not found' });
          return;
        }
        json(res, 200, { session: conv });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
    },
  },

  // ── PATCH /api/ai-qa/sessions/:id — update conversation ───────────────
  {
    method: 'PATCH',
    path: '/api/ai-qa/sessions/:id',
    async handler(req, res, params) {
      let body;
      try {
        body = await parseBody(req);
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }

      if (!body || body.title === undefined) {
        json(res, 400, { error: 'Missing field: title' });
        return;
      }

      try {
        const conv = await historyStore.updateConversation(params.id, { title: body.title });
        if (!conv) {
          json(res, 404, { error: 'Conversation not found' });
          return;
        }
        json(res, 200, { session: conv });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
    },
  },

  // ── POST /api/ai-qa/sessions/:id/stop — stop active answer ────────────
  {
    method: 'POST',
    path: '/api/ai-qa/sessions/:id/stop',
    async handler(req, res, params) {
      try {
        const stopped = await stopQuestion(params.id);
        const conv = await historyStore.getConversation(params.id);
        const messages = conv?.messages || [];
        const last = messages[messages.length - 1];
        if (last && last.role === 'assistant' && last.status === 'streaming') {
          await historyStore.updateMessage(params.id, last.id, {
            status: 'stopped',
            streamOffset: (last.streamOffset || 0) + 1,
          });
        }
        json(res, 200, { stopped });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
    },
  },

  // ── DELETE /api/ai-qa/sessions/:id — delete conversation ──────────────
  {
    method: 'DELETE',
    path: '/api/ai-qa/sessions/:id',
    async handler(req, res, params) {
      try {
        // Dispose runtime session if active
        await disposeRuntimeSession(params.id);

        const deleted = await historyStore.deleteConversation(params.id);
        if (!deleted) {
          json(res, 404, { error: 'Conversation not found' });
          return;
        }
        json(res, 200, { deleted: params.id });
      } catch (err) {
        json(res, 500, { error: err.message });
      }
    },
  },

  // ── POST /api/ai-qa/chat — SSE chat ───────────────────────────────────
  {
    method: 'POST',
    path: '/api/ai-qa/chat',
    async handler(req, res) {
      let body;
      try {
        body = await parseBody(req);
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return;
      }

      if (!body || !body.conversationId || !body.question) {
        json(res, 400, { error: 'Missing required fields: conversationId, question' });
        return;
      }

      let { conversationId } = body;
      const { question, context = {} } = body;

      // Validate context fields
      const ctx = {
        selectedText: context.selectedText || '',
        contextBefore: context.contextBefore || '',
        contextAfter: context.contextAfter || '',
        chapterFile: context.chapterFile || '',
        question,
      };

      let assistantMessageId = null;

      // Persist user message before LLM call
      try {
        await historyStore.appendMessage(conversationId, {
          role: 'user',
          content: question,
          context: {
            selectedText: ctx.selectedText,
            contextBefore: ctx.contextBefore,
            contextAfter: ctx.contextAfter,
            chapterFile: ctx.chapterFile,
          },
        });

        // Auto-generate title from first user question
        const conv = await historyStore.getConversation(conversationId);
        if (conv && conv.title === '新对话' && conv.messages.length === 1) {
          await historyStore.updateConversation(conversationId, {
            title: historyStore.generateTitle(question),
          });
        }

        // Update lastChapterFile
        if (ctx.chapterFile) {
          await historyStore.updateConversation(conversationId, {
            lastChapterFile: ctx.chapterFile,
          });
        }

        const assistantMessage = await historyStore.appendMessage(conversationId, {
          role: 'assistant',
          content: '',
          thinking: '',
          status: 'streaming',
          streamOffset: 0,
          segments: [],
        });
        assistantMessageId = assistantMessage?.id || null;
      } catch (err) {
        json(res, 500, { error: `Failed to persist message: ${err.message}` });
        return;
      }

      res.writeHead(200, sseHeaders());

      // Heartbeat every 15s
      const heartbeat = setInterval(() => {
        sseWrite(res, 'heartbeat', '');
      }, 15000);

      try {
        const stream = await askQuestion(conversationId, ctx);
        if (stream.conversationId && stream.conversationId !== conversationId) {
          const oldConversationId = conversationId;
          conversationId = stream.conversationId;
          const moved = await historyStore.getConversation(conversationId);
          const assistant = moved?.messages?.find(message => message.id === assistantMessageId);
          if (!assistant && assistantMessageId) {
            await historyStore.appendMessage(conversationId, {
              role: 'assistant',
              content: '',
              thinking: '',
              status: 'streaming',
              streamOffset: 0,
              segments: [],
            });
          }
          sseWrite(res, 'session', { id: conversationId, previousId: oldConversationId });
        }
        let accumulatedText = '';
        let accumulatedThinking = '';
        let accumulatedTools = [];
        let accumulatedSegments = [];

        for await (const event of stream) {
          if (event.type === 'stopped') {
            if (assistantMessageId) {
              await historyStore.updateMessage(conversationId, assistantMessageId, {
                status: 'stopped',
                streamOffset: (event.index || 0) + 1,
              });
            }
            sseWrite(res, 'stopped', { index: event.index });
            break;
          }
          if (event.type === 'done') {
            if (assistantMessageId) {
              await historyStore.updateMessage(conversationId, assistantMessageId, {
                status: 'done',
                streamOffset: (event.index || 0) + 1,
              });
            }
            sseWrite(res, 'done', { index: event.index });
            break;
          }
          if (event.type === 'error') {
            if (assistantMessageId) {
              await historyStore.updateMessage(conversationId, assistantMessageId, {
                status: 'error',
                streamOffset: (event.index || 0) + 1,
              });
            }
            sseWrite(res, 'error', { error: event.error || '未知错误', index: event.index });
            break;
          }
          if (event.type === 'text_delta') {
            accumulatedText += event.delta;
            accumulatedSegments = accumulatedSegments.concat({ type: 'answer', text: event.delta });
          } else if (event.type === 'thinking_delta') {
            accumulatedThinking += event.delta;
            accumulatedSegments = accumulatedSegments.concat({ type: 'thinking', text: event.delta });
          } else if (event.tool) {
            accumulatedTools = accumulatedTools.concat(event.tool);
            accumulatedSegments = accumulatedSegments.concat({ type: 'tool', tool: event.tool });
          }
          if (assistantMessageId) {
            await historyStore.updateMessage(conversationId, assistantMessageId, {
              content: accumulatedText,
              thinking: isPersistThinking() ? accumulatedThinking : null,
              status: 'streaming',
              streamOffset: (event.index || 0) + 1,
              tools: accumulatedTools,
              segments: accumulatedSegments,
            });
          }
          sseWrite(res, event.type, eventPayload(event));
        }
      } catch (err) {
        sseWrite(res, 'error', { error: err.message });
      } finally {
        clearInterval(heartbeat);
        res.end();
        const finalConversationId = conversationId;
        waitForQuestion(finalConversationId).then(async (snapshot) => {
          if (!snapshot || !assistantMessageId) return;
          if (!markActiveStreamPersisted(finalConversationId)) return;
          if (!await historyStore.getConversation(finalConversationId)) return;
          const persistThinkingFlag = isPersistThinking();
          await historyStore.updateMessage(finalConversationId, assistantMessageId, {
            content: snapshot.text || '',
            thinking: persistThinkingFlag ? snapshot.thinking : null,
            status: snapshot.status === 'done' ? 'done' : snapshot.status === 'stopped' ? 'stopped' : 'error',
            streamOffset: snapshot.eventCount,
            tools: snapshot.tools || [],
            segments: snapshot.segments || [],
          });
        }).catch(() => {});
      }
    },
  },

  // ── GET /api/ai-qa/sessions/:id/resume — snapshot + active stream ────
  {
    method: 'GET',
    path: '/api/ai-qa/sessions/:id/resume',
    async handler(req, res, params) {
      const conv = await historyStore.getConversation(params.id);
      if (!conv) {
        json(res, 404, { error: 'Conversation not found' });
        return;
      }

      res.writeHead(200, sseHeaders());
      sseWrite(res, 'snapshot', { session: conv });

      const messages = conv.messages || [];
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant' || last.status !== 'streaming') {
        sseWrite(res, 'done', { index: last?.streamOffset || 0 });
        res.end();
        return;
      }

      const stream = subscribeToQuestion(params.id, last.streamOffset || 0);
      if (!stream) {
        sseWrite(res, 'error', { error: 'Active stream not found' });
        res.end();
        return;
      }

      const heartbeat = setInterval(() => {
        sseWrite(res, 'heartbeat', '');
      }, 15000);

      try {
        for await (const event of stream) {
          if (event.type === 'stopped') {
            sseWrite(res, 'stopped', { index: event.index });
            break;
          }
          if (event.type === 'done') {
            sseWrite(res, 'done', { index: event.index });
            break;
          }
          if (event.type === 'error') {
            sseWrite(res, 'error', { error: event.error || '未知错误', index: event.index });
            break;
          }
          sseWrite(res, event.type, eventPayload(event));
        }
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
    },
  },

  // ── GET /api/ai-qa/sessions/:id/stream — resume active SSE stream ─────
  {
    method: 'GET',
    path: '/api/ai-qa/sessions/:id/stream',
    async handler(req, res, params) {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const offset = Number(url.searchParams.get('offset') || '0');
      const stream = subscribeToQuestion(params.id, Number.isFinite(offset) && offset > 0 ? offset : 0);
      if (!stream) {
        json(res, 404, { error: 'Active stream not found' });
        return;
      }

      res.writeHead(200, sseHeaders());
      const heartbeat = setInterval(() => {
        sseWrite(res, 'heartbeat', '');
      }, 15000);

      try {
        for await (const event of stream) {
          if (event.type === 'stopped') {
            sseWrite(res, 'stopped', { index: event.index });
            break;
          }
          if (event.type === 'done') {
            sseWrite(res, 'done', { index: event.index });
            break;
          }
          if (event.type === 'error') {
            sseWrite(res, 'error', { error: event.error || '未知错误', index: event.index });
            break;
          }
          sseWrite(res, event.type, eventPayload(event));
        }
      } catch (err) {
        sseWrite(res, 'error', { error: err.message });
      } finally {
        clearInterval(heartbeat);
        res.end();
      }
    },
  },

  // ── GET /api/ai-qa/status — availability ──────────────────────────────
  {
    method: 'GET',
    path: '/api/ai-qa/status',
    async handler(req, res) {
      json(res, 200, {
        available: isSdkAvailable(),
        activeSessions: getRuntimeSessionCount(),
        maxSessions: 5,
      });
    },
  },
];
