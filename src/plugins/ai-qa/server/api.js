// AI QA HTTP API — REST CRUD for conversations + SSE chat.
//
// GET    /api/ai-qa/sessions       — list conversations
// POST   /api/ai-qa/sessions       — create conversation
// GET    /api/ai-qa/sessions/:id   — get conversation with messages
// PATCH  /api/ai-qa/sessions/:id   — update conversation (title)
// DELETE /api/ai-qa/sessions/:id   — delete conversation + dispose runtime session
// POST   /api/ai-qa/chat           — SSE stream, body: { conversationId, question, context }
// GET    /api/ai-qa/status         — availability + runtime session count

import {
  askQuestion,
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

      const { conversationId, question, context = {} } = body;

      // Validate context fields
      const ctx = {
        selectedText: context.selectedText || '',
        contextBefore: context.contextBefore || '',
        contextAfter: context.contextAfter || '',
        chapterFile: context.chapterFile || '',
        question,
      };

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
      } catch (err) {
        json(res, 500, { error: `Failed to persist message: ${err.message}` });
        return;
      }

      res.writeHead(200, sseHeaders());

      // Heartbeat every 15s
      const heartbeat = setInterval(() => {
        sseWrite(res, 'heartbeat', '');
      }, 15000);

      let accumulatedText = '';
      let accumulatedThinking = '';

      try {
        const stream = await askQuestion(conversationId, ctx);

        for await (const event of stream) {
          sseWrite(res, event.type, { delta: event.delta });

          // Accumulate for persistence
          if (event.type === 'text_delta') {
            accumulatedText += event.delta;
          } else if (event.type === 'thinking_delta') {
            accumulatedThinking += event.delta;
          }
        }

        // Persist assistant message after stream completes
        if (accumulatedText) {
          const persistThinkingFlag = isPersistThinking();
          await historyStore.appendMessage(conversationId, {
            role: 'assistant',
            content: accumulatedText,
            thinking: persistThinkingFlag ? accumulatedThinking : null,
          });
        }

        sseWrite(res, 'done', {});
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
