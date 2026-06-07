import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chromium } from 'playwright';
import { startE2EServer } from './helpers/server.js';

let browser;
let server;
let baseUrl;

beforeAll(async () => {
  server = await startE2EServer({ ai: true });
  baseUrl = server.baseUrl;
  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => {
  if (browser) await browser.close();
  if (server) await server.stop();
});

describe('AI QA E2E', () => {
  it('should not annotate article for panel-origin AI context', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      const text = await page.evaluate(() => {
        const content = document.querySelector('.markdown-content');
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.textContent.trim().length > 24) break;
        }
        return node.textContent.trim().slice(0, 12);
      });
      await page.evaluate((selectedText) => {
        window.__core__.panel.open('ai-qa');
        window.__ai_qa__.setContext({
          selectedText,
          contextBefore: '',
          contextAfter: '',
          chapterFile: window.__core__.state.currentFile,
          source: 'panel',
        });
      }, text);

      const highlightCount = await page.$$eval('.ai-qa-context-highlight', els => els.length);
      const badgeText = await page.$eval('#ai-qa-toggle .floating-action-badge', el => el.textContent.trim()).catch(() => '');
      expect(highlightCount).toBe(0);
      expect(badgeText).toBe('');
    } finally {
      await page.close();
    }
  }, 15000);

  it('restores AI context highlights from persisted chat history before panel opens', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('ai-qa-conversationId', 'preopen-history-conv');
      const selectedText = 'This is a test paragraph with some bold text and inline code.';
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({
            sessions: [{
              id: 'preopen-history-conv',
              title: '预加载历史会话',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastChapterFile: 'sample-chapter.md',
              messageCount: 1,
            }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/sessions/preopen-history-conv' && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({
            session: {
              id: 'preopen-history-conv',
              title: '预加载历史会话',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastChapterFile: 'sample-chapter.md',
              messages: [{
                id: 'preopen-user-history-1',
                role: 'user',
                content: '解释这段',
                context: {
                  selectedText,
                  contextBefore: '',
                  contextAfter: '',
                  chapterFile: 'sample-chapter.md',
                },
                createdAt: new Date().toISOString(),
              }],
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return originalFetch(input, init);
      };
    });
    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.waitForSelector('.ai-qa-context-highlight[data-core-annotation-id="ai-qa-history-preopen-user-history-1"]');
      const panelOpen = await page.$eval('.core-panel', el => el.classList.contains('open')).catch(() => false);
      expect(panelOpen).toBe(false);
    } finally {
      await page.close();
    }
  }, 15000);

  it('restores AI context highlights from persisted chat history after refresh', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('ai-qa-conversationId', 'history-conv');
    });
    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      const selectedText = await page.evaluate(() => {
        const content = document.querySelector('.markdown-content');
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.textContent.trim().length > 24) break;
        }
        return node.textContent.trim().slice(0, 12);
      });

      await page.evaluate((text) => {
        const originalFetch = window.fetch;
        window.fetch = async (input, init) => {
          const url = String(input);
          if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
            return new Response(JSON.stringify({
              sessions: [{
                id: 'history-conv',
                title: '历史会话',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastChapterFile: 'sample-chapter.md',
                messageCount: 1,
              }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (url === '/api/ai-qa/sessions/history-conv' && (!init || init.method === 'GET')) {
            return new Response(JSON.stringify({
              session: {
                id: 'history-conv',
                title: '历史会话',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastChapterFile: 'sample-chapter.md',
                messages: [{
                  id: 'user-history-1',
                  role: 'user',
                  content: '解释这段',
                  context: {
                    selectedText: text,
                    contextBefore: '',
                    contextAfter: '',
                    chapterFile: 'sample-chapter.md',
                  },
                  createdAt: new Date().toISOString(),
                }],
              },
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return originalFetch(input, init);
        };
      }, selectedText);

      await page.click('#ai-qa-toggle');
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="ai-qa"].active');

      const highlight = await page.$eval('.ai-qa-context-highlight[data-core-annotation-id="ai-qa-history-user-history-1"]', el => ({
        text: el.textContent.trim(),
        role: el.getAttribute('role'),
      }));
      const displayedChapter = await page.$eval('.ai-qa-message-context .message-context-chapter', el => el.textContent.trim());
      expect(highlight.text).toBe(selectedText);
      expect(highlight.role).toBe('button');
      expect(displayedChapter).toBe('sample-chapter.md');
    } finally {
      await page.close();
    }
  }, 15000);

  it('sends decoded chapter file from core selection context', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.__aiQaChatBody = null;
        window.fetch = async (input, init) => {
          const url = String(input);
          // Return empty sessions list so frontend doesn't pick up real conversations
          if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
            return new Response(JSON.stringify({ sessions: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.includes('/api/ai-qa/sessions') && init?.method === 'POST') {
            return new Response(JSON.stringify({
              session: {
                id: 'selection-conv',
                title: '新对话',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastChapterFile: null,
                messages: [],
              },
            }), {
              status: 201,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.includes('/api/ai-qa/chat')) {
            window.__aiQaChatBody = JSON.parse(init.body);
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode('event: text_delta\ndata: {"delta":"ok"}\n\nevent: done\ndata: {}\n\n'));
                controller.close();
              },
            });
            return new Response(stream, {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            });
          }
          return originalFetch(input, init);
        };
      });

      await page.evaluate(() => {
        const content = document.querySelector('.markdown-content');
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (node.textContent.trim().length > 24) break;
        }
        const selectedText = node.textContent.trim().slice(0, 12);
        const idx = node.textContent.indexOf(selectedText);
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + selectedText.length);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 200 }));
      });
      await page.waitForSelector('.selection-popup.visible');
      const actionCount = await page.$$eval('.selection-popup [data-selection-action-id="ai-qa"]', els => els.length);
      expect(actionCount).toBe(1);
      await page.click('.selection-popup [data-selection-action-id="ai-qa"]');
      const pendingHighlightCount = await page.$$eval('.ai-qa-context-highlight[data-core-annotation-id^="ai-qa-context-"]', els => els.length);
      const aiQaBadgeText = await page.$eval('#ai-qa-toggle .floating-action-badge', el => el.textContent.trim());
      const highlightCursor = await page.$eval('.ai-qa-context-highlight', el => getComputedStyle(el).cursor);
      expect(pendingHighlightCount).toBe(1);
      expect(aiQaBadgeText).toBe('1');
      expect(highlightCursor).toBe('pointer');
      await page.evaluate(() => {
        const mark = document.querySelector('.ai-qa-context-highlight');
        const clone = mark.cloneNode(true);
        mark.replaceWith(clone);
      });
      await page.evaluate(() => window.__core__.panel.close());
      await page.click('.ai-qa-context-highlight');
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="ai-qa"].active');
      const textareaFocused = await page.$eval('.core-panel-pane[data-tab-id="ai-qa"] textarea', el => document.activeElement === el);
      expect(textareaFocused).toBe(true);
      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', '解释');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForFunction(() => window.__aiQaChatBody !== null);

      const chapterFile = await page.evaluate(() => window.__aiQaChatBody.context.chapterFile);
      const conversationId = await page.evaluate(() => window.__aiQaChatBody.conversationId);
      const retainedHighlightCount = await page.$$eval('.ai-qa-context-highlight', els => els.length);
      expect(chapterFile).toBe('sample-chapter.md');
      expect(conversationId).toBe('selection-conv');
      expect(retainedHighlightCount).toBe(1);

      await page.evaluate(() => window.__core__.panel.close());
      await page.click('.ai-qa-context-highlight');
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="ai-qa"].active');
      const activeContextText = await page.$eval('.ai-qa-message-context.active .message-context-text', el => el.textContent.trim());
      expect(activeContextText.length).toBeGreaterThan(0);
    } finally {
      await page.close();
    }
  }, 15000);

  it('renders thinking stream, markdown answer, and SSE error messages', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.__aiQaChatCount = 0;
        window.fetch = async (input, init) => {
          const url = String(input);
          if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
            return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (url.includes('/api/ai-qa/sessions') && init?.method === 'POST') {
            return new Response(JSON.stringify({
              session: {
                id: 'stream-conv',
                title: '新对话',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastChapterFile: null,
                messages: [],
              },
            }), { status: 201, headers: { 'Content-Type': 'application/json' } });
          }
          if (url.includes('/api/ai-qa/chat')) {
            window.__aiQaChatCount += 1;
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              async start(controller) {
                if (window.__aiQaChatCount === 1) {
                  controller.enqueue(encoder.encode('event: thinking_delta\ndata: {"delta":"plan"}\n\nevent: text_delta\ndata: {"delta":"**ok**"}\n\n'));
                  await new Promise(resolve => setTimeout(resolve, 50));
                  controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
                } else {
                  controller.enqueue(encoder.encode('event: error\ndata: {"error":"boom"}\n\n'));
                }
                controller.close();
              },
            });
            return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
          }
          return originalFetch(input, init);
        };
      });

      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="ai-qa"].active');
      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', 'first');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForFunction(() => document.querySelector('.ai-qa-thinking pre')?.textContent.trim() === 'plan');
      await page.waitForFunction(() => document.querySelector('.ai-qa-message.assistant.streaming strong')?.textContent === 'ok');
      const streamingAnswerHtml = await page.$eval('.ai-qa-message.assistant.streaming', el => el.innerHTML);
      await page.waitForFunction(() => document.querySelector('.ai-qa-message.assistant:not(.streaming)')?.innerHTML.includes('ok'));
      const thinkingText = await page.$eval('.ai-qa-thinking pre', el => el.textContent.trim());
      const finalAnswerHtml = await page.$eval('.ai-qa-message.assistant:not(.streaming)', el => el.innerHTML);
      expect(thinkingText).toBe('plan');
      expect(streamingAnswerHtml).toContain('<strong>ok</strong>');
      expect(finalAnswerHtml).toContain('ok');

      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', 'second');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForSelector('.ai-qa-message.error:has-text("错误: boom")');
      expect(await page.evaluate(() => window.__aiQaChatCount)).toBe(2);
    } finally {
      await page.close();
    }
  }, 15000);

  it('renames, switches, and deletes AI QA conversations from the session bar', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const originalFetch = window.fetch;
      const sessions = [
        { id: 'conv-a', title: 'Alpha', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastChapterFile: 'sample-chapter.md', messageCount: 1 },
        { id: 'conv-b', title: 'Beta', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastChapterFile: 'sample-chapter.md', messageCount: 1 },
      ];
      const conversations = {
        'conv-a': { ...sessions[0], messages: [{ id: 'a-user', role: 'user', content: 'Alpha question', context: null, createdAt: new Date().toISOString() }] },
        'conv-b': { ...sessions[1], messages: [{ id: 'b-user', role: 'user', content: 'Beta question', context: null, createdAt: new Date().toISOString() }] },
      };
      window.__aiQaRequests = [];
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({ sessions }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const match = url.match(/^\/api\/ai-qa\/sessions\/([^/]+)$/);
        if (match && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({ session: conversations[decodeURIComponent(match[1])] || null }), { status: conversations[decodeURIComponent(match[1])] ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
        }
        if (match && init?.method === 'PATCH') {
          const id = decodeURIComponent(match[1]);
          const body = JSON.parse(init.body);
          window.__aiQaRequests.push({ method: 'PATCH', id, body });
          conversations[id].title = body.title;
          sessions.find(session => session.id === id).title = body.title;
          return new Response(JSON.stringify({ session: conversations[id] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (match && init?.method === 'DELETE') {
          const id = decodeURIComponent(match[1]);
          window.__aiQaRequests.push({ method: 'DELETE', id });
          const index = sessions.findIndex(session => session.id === id);
          if (index >= 0) sessions.splice(index, 1);
          delete conversations[id];
          return new Response(JSON.stringify({ deleted: id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return originalFetch(input, init);
      };
    });

    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.waitForSelector('.ai-qa-message.user:has-text("Alpha question")');

      await page.click('.ai-qa-session-select');
      await page.waitForSelector('.ai-qa-session-dropdown .ai-qa-session-item[data-id="conv-b"]');
      await page.click('.ai-qa-session-dropdown .ai-qa-session-item[data-id="conv-b"]');
      await page.waitForSelector('.ai-qa-message.user:has-text("Beta question")');
      expect(await page.evaluate(() => localStorage.getItem('ai-qa-conversationId'))).toBe('conv-b');

      await page.click('.ai-qa-btn-rename');
      await page.waitForSelector('.core-panel-confirm-input');
      await page.fill('.core-panel-confirm-input', 'Beta Renamed');
      await page.click('.core-panel-confirm-actions button.primary');
      await page.waitForFunction(() => window.__aiQaRequests.some(req => req.method === 'PATCH' && req.body.title === 'Beta Renamed'));
      const renamedRequest = await page.evaluate(() => window.__aiQaRequests.find(req => req.method === 'PATCH'));
      expect(renamedRequest).toEqual({ method: 'PATCH', id: 'conv-b', body: { title: 'Beta Renamed' } });

      await page.click('.ai-qa-btn-delete');
      await page.waitForSelector('.core-panel-confirm-overlay .core-panel-confirm-dialog');
      await page.click('.core-panel-confirm-actions button.danger');
      await page.waitForFunction(() => window.__aiQaRequests.some(req => req.method === 'DELETE' && req.id === 'conv-b'));
      await page.waitForFunction(() => document.querySelector('.ai-qa-session-select')?.textContent.includes('Alpha'));
      await page.click('.ai-qa-session-select');
      await page.waitForSelector('.ai-qa-session-dropdown .ai-qa-session-item[data-id="conv-a"]');
    } finally {
      await page.close();
    }
  }, 15000);

  it('shows request failure when chat HTTP response is not ok', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.fetch = async (input, init) => {
          const url = String(input);
          if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
            return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (url.includes('/api/ai-qa/sessions') && init?.method === 'POST') {
            return new Response(JSON.stringify({ session: { id: 'http-fail-conv', title: '新对话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastChapterFile: null, messages: [] } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
          }
          if (url.includes('/api/ai-qa/chat')) {
            return new Response('upstream unavailable', { status: 503 });
          }
          return originalFetch(input, init);
        };
      });
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', 'fail please');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForSelector('.ai-qa-message.error:has-text("请求失败")');
      const errorText = await page.$eval('.ai-qa-message.error', el => el.textContent);
      expect(errorText).toContain('upstream unavailable');
    } finally {
      await page.close();
    }
  }, 15000);

  it('keeps markdown list markers inside assistant message bounds', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.fetch = async (input, init) => {
          const url = String(input);
          if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
            return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (url.includes('/api/ai-qa/sessions') && init?.method === 'POST') {
            return new Response(JSON.stringify({ session: { id: 'list-layout-conv', title: '新对话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastChapterFile: null, messages: [] } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
          }
          if (url.includes('/api/ai-qa/chat')) {
            const encoder = new TextEncoder();
            return new Response(new ReadableStream({
              start(controller) {
                const data = JSON.stringify({ delta: '1. first item\n2. second item\n' });
                controller.enqueue(encoder.encode('event: text_delta\ndata: ' + data + '\n\nevent: done\ndata: {}\n\n'));
                controller.close();
              },
            }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
          }
          return originalFetch(input, init);
        };
      });
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', 'list');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForSelector('.ai-qa-message.assistant:not(.streaming)');
      const listStylePosition = await page.evaluate(() => {
        const message = document.querySelector('.ai-qa-message.assistant:not(.streaming)');
        message.innerHTML = '<ol><li>first item</li><li>second item</li></ol>';
        return getComputedStyle(message.querySelector('ol')).listStylePosition;
      });
      expect(listStylePosition).toBe('inside');
    } finally {
      await page.close();
    }
  }, 15000);

  it('continues streaming after malformed SSE JSON and split chunks', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.fetch = async (input, init) => {
          const url = String(input);
          if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
            return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (url.includes('/api/ai-qa/sessions') && init?.method === 'POST') {
            return new Response(JSON.stringify({ session: { id: 'split-conv', title: '新对话', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastChapterFile: null, messages: [] } }), { status: 201, headers: { 'Content-Type': 'application/json' } });
          }
          if (url.includes('/api/ai-qa/chat')) {
            const encoder = new TextEncoder();
            const chunks = [
              'event: text_delta\ndata: {bad json}\n\nevent: text_delta\ndata: {"delta":"he',
              'llo"}\n\nevent: done\ndata: {}\n\n',
            ];
            return new Response(new ReadableStream({
              start(controller) {
                chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
                controller.close();
              },
            }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
          }
          return originalFetch(input, init);
        };
      });
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', 'split');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForSelector('.ai-qa-message.assistant:not(.streaming):has-text("hello")');
      expect(await page.$eval('.ai-qa-message.assistant:not(.streaming)', el => el.textContent.trim())).toBe('hello');
    } finally {
      await page.close();
    }
  }, 15000);

  it('clears stale restored conversation when sessions list does not contain it', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('ai-qa-conversationId', 'stale-conv');
    });

    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.__aiQaSessionRequests = 0;
        window.fetch = async (input, init) => {
          const url = String(input);
          // Return empty sessions list — stale conv will be forgotten during init
          if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
            return new Response(JSON.stringify({ sessions: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          // Single-conversation fetch for stale-conv returns 404
          if (url.includes('/api/ai-qa/sessions/stale-conv') && (!init || init.method === 'GET')) {
            return new Response(JSON.stringify({ error: 'Conversation not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.includes('/api/ai-qa/sessions') && init?.method === 'POST') {
            window.__aiQaSessionRequests += 1;
            return new Response(JSON.stringify({
              session: {
                id: 'fresh-conv',
                title: '新对话',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                lastChapterFile: null,
                messages: [],
              },
            }), {
              status: 201,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.includes('/api/ai-qa/chat')) {
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode('event: text_delta\ndata: {"delta":"ok"}\n\nevent: done\ndata: {}\n\n'));
                controller.close();
              },
            });
            return new Response(stream, {
              status: 200,
              headers: { 'Content-Type': 'text/event-stream' },
            });
          }
          return originalFetch(input, init);
        };
      });

      // Open panel to trigger initSessions
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));

      // Wait for initSessions to complete
      await page.waitForFunction(() => window.__ai_qa_ready__);

      // Stale conversationId should be cleared during init (empty sessions list)
      const staleCleared = await page.evaluate(() => localStorage.getItem('ai-qa-conversationId'));
      expect(staleCleared).toBeNull();
      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', '测试');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForFunction(() => window.__aiQaSessionRequests > 0);
      await page.waitForFunction(() => localStorage.getItem('ai-qa-conversationId') === 'fresh-conv');

      const state = await page.evaluate(() => ({
        storedConversationId: localStorage.getItem('ai-qa-conversationId'),
        sessionRequests: window.__aiQaSessionRequests,
      }));

      expect(state.sessionRequests).toBe(1);
      expect(state.storedConversationId).toBe('fresh-conv');
    } finally {
      await page.close();
    }
  }, 15000);
});
