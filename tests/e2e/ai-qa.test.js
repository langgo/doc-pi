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
  if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))]);
  if (server) await server.stop();
});

describe('AI QA E2E', () => {
  it('lets users stop an in-flight AI answer', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.removeItem('ai-qa-conversationId');
      window.__stopCalled = false;
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/sessions' && init?.method === 'POST') {
          return new Response(JSON.stringify({
            session: { id: 'stop-conv', title: '停止', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastChapterFile: null, messageCount: 0 },
          }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/sessions/stop-conv/stop' && init?.method === 'POST') {
          window.__stopCalled = true;
          return new Response(JSON.stringify({ stopped: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/chat') {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              controller.enqueue(encoder.encode('event: text_delta\ndata: {"delta":"partial","index":0}\n\n'));
              await new Promise(resolve => setTimeout(resolve, 5000));
              controller.enqueue(encoder.encode('event: text_delta\ndata: {"delta":" late","index":1}\n\n'));
            },
          });
          return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        return originalFetch(input, init);
      };
    });

    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', '长回答');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForFunction(() => document.querySelector('.ai-qa-message.assistant.streaming')?.textContent.includes('partial'));
      await page.waitForSelector('.core-panel-pane[data-tab-id="ai-qa"] .btn-stop:not([hidden])');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-stop');
      await page.waitForFunction(() => window.__stopCalled === true);
      await page.waitForFunction(() => !document.querySelector('.ai-qa-message.assistant.streaming'));
      const controls = await page.$eval('.core-panel-pane[data-tab-id="ai-qa"]', el => ({
        textareaDisabled: el.querySelector('textarea').disabled,
        sendHidden: el.querySelector('.btn-send').hidden,
        stopHidden: el.querySelector('.btn-stop').hidden,
        assistantText: el.querySelector('.ai-qa-message.assistant')?.textContent || '',
      }));
      expect(controls.textareaDisabled).toBe(false);
      expect(controls.sendHidden).toBe(false);
      expect(controls.stopHidden).toBe(true);
      expect(controls.assistantText).toContain('partial');
      expect(controls.assistantText).not.toContain('late');
    } finally {
      await page.close();
    }
  }, 15000);

  it('renders user input as plain text, not Markdown', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.removeItem('ai-qa-conversationId');
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/sessions' && init?.method === 'POST') {
          return new Response(JSON.stringify({
            session: { id: 'plain-conv', title: '纯文本', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastChapterFile: null, messageCount: 0 },
          }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/chat') {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('event: text_delta\ndata: {"delta":"ok","index":0}\n\nevent: done\ndata: {"index":1}\n\n'));
              controller.close();
            },
          });
          return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        return originalFetch(input, init);
      };
    });

    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', '2. 为啥角色名称叫Master-eligible，但是配置的时候是master ?');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForSelector('.ai-qa-message.user .message-question');
      const userHtml = await page.$eval('.ai-qa-message.user .message-question', el => el.innerHTML);
      const userText = await page.$eval('.ai-qa-message.user .message-question', el => el.textContent);
      expect(userHtml).not.toContain('<ol');
      expect(userHtml).not.toContain('<li');
      expect(userText).toContain('2. 为啥角色名称叫Master-eligible');
    } finally {
      await page.close();
    }
  }, 15000);

  it('renders thinking content as Markdown', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.removeItem('ai-qa-conversationId');
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/sessions' && init?.method === 'POST') {
          return new Response(JSON.stringify({
            session: { id: 'md-thinking-conv', title: 'Markdown思考', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastChapterFile: null, messageCount: 0 },
          }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/chat') {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              controller.enqueue(encoder.encode('event: thinking_delta\ndata: {"delta":"需要查看 `node.roles` 配置"}\n\n'));
              await new Promise(resolve => setTimeout(resolve, 100));
              controller.enqueue(encoder.encode('event: text_delta\ndata: {"delta":"ok","index":0}\n\nevent: done\ndata: {"index":1}\n\n'));
              controller.close();
            },
          });
          return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        return originalFetch(input, init);
      };
    });

    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', 'test');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForSelector('.ai-qa-message.assistant:not(.streaming)');
      const thinkingHtml = await page.$eval('.ai-qa-thinking .ai-qa-tree-text', el => el.innerHTML);
      expect(thinkingHtml).toContain('<code');
      expect(thinkingHtml).toContain('node.roles');
      const thinkingBorder = await page.$eval('.ai-qa-thinking .ai-qa-tree-text', el => getComputedStyle(el).borderLeftWidth);
      expect(thinkingBorder).toBe('0px');
    } finally {
      await page.close();
    }
  }, 15000);

  it('renders markdown tables inside thinking content', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.removeItem('ai-qa-conversationId');
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/sessions' && init?.method === 'POST') {
          return new Response(JSON.stringify({
            session: { id: 'think-table-conv', title: '思考表格', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastChapterFile: null, messageCount: 0 },
          }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/chat') {
          const encoder = new TextEncoder();
          const tableMd = '| 角色 | 配置值 |\n|---|---|\n| Master-eligible | `master` |\n| Data | `data` |';
          const stream = new ReadableStream({
            async start(controller) {
              controller.enqueue(encoder.encode('event: thinking_delta\ndata: ' + JSON.stringify({ delta: tableMd }) + '\n\n'));
              await new Promise(resolve => setTimeout(resolve, 100));
              controller.enqueue(encoder.encode('event: text_delta\ndata: {"delta":"ok","index":0}\n\nevent: done\ndata: {"index":1}\n\n'));
              controller.close();
            },
          });
          return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        return originalFetch(input, init);
      };
    });

    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', 'test');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForSelector('.ai-qa-message.assistant:not(.streaming)');
      const table = await page.$eval('.ai-qa-thinking .ai-qa-tree-text table', el => ({
        headers: Array.from(el.querySelectorAll('th')).map(th => th.textContent.trim()),
        cells: Array.from(el.querySelectorAll('td')).map(td => td.textContent.trim()),
        display: getComputedStyle(el).display,
        borderCollapse: getComputedStyle(el).borderCollapse,
      }));
      expect(table.headers).toEqual(['角色', '配置值']);
      expect(table.cells).toContain('Master-eligible');
      expect(table.cells).toContain('master');
      expect(table.display).toBe('table');
      expect(table.borderCollapse).toBe('collapse');
    } finally {
      await page.close();
    }
  }, 15000);

  it('keeps thinking summary text from overlapping at narrow widths', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.removeItem('ai-qa-conversationId');
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/sessions' && init?.method === 'POST') {
          return new Response(JSON.stringify({
            session: { id: 'narrow-conv', title: '窄面板', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastChapterFile: null, messageCount: 0 },
          }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/chat') {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              controller.enqueue(encoder.encode('event: thinking_delta\ndata: {"delta":"先查资料"}\n\n'));
              await new Promise(resolve => setTimeout(resolve, 100));
              controller.enqueue(encoder.encode('event: text_delta\ndata: {"delta":"ok","index":0}\n\nevent: done\ndata: {"index":1}\n\n'));
              controller.close();
            },
          });
          return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        return originalFetch(input, init);
      };
    });

    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', 'test');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForSelector('.ai-qa-thinking');
      const layout = await page.$eval('.ai-qa-thinking > summary', el => {
        const label = Array.from(el.children).find(child => child.textContent.includes('思考过程'));
        const hint = el.querySelector('.thinking-hint');
        if (!label || !hint) return { ok: false };
        const labelRect = label.getBoundingClientRect();
        const hintRect = hint.getBoundingClientRect();
        return {
          ok: true,
          labelRight: labelRect.right,
          hintLeft: hintRect.left,
          minWidth: getComputedStyle(el.parentElement).minWidth,
        };
      });
      expect(layout.ok).toBe(true);
      expect(layout.labelRight).toBeLessThanOrEqual(layout.hintLeft);
    } finally {
      await page.close();
    }
  }, 15000);

  it('renders markdown tables in streamed AI answers', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.removeItem('ai-qa-conversationId');
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/sessions' && init?.method === 'POST') {
          return new Response(JSON.stringify({
            session: { id: 'table-conv', title: '表格', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastChapterFile: null, messageCount: 0 },
          }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/chat') {
          const encoder = new TextEncoder();
          const markdown = '| 角色 | 配置值 |\n|---|---|\n| Master-eligible | `master` |\n| Data | `data` |';
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('event: text_delta\ndata: ' + JSON.stringify({ delta: markdown, index: 0 }) + '\n\nevent: done\ndata: {"index":1}\n\n'));
              controller.close();
            },
          });
          return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        return originalFetch(input, init);
      };
    });

    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', '给我表格');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForSelector('.ai-qa-message.assistant:not(.streaming) table');
      const table = await page.$eval('.ai-qa-message.assistant:not(.streaming) table', el => ({
        headers: Array.from(el.querySelectorAll('th')).map(th => th.textContent.trim()),
        cells: Array.from(el.querySelectorAll('td')).map(td => td.textContent.trim()),
        display: getComputedStyle(el).display,
        borderCollapse: getComputedStyle(el).borderCollapse,
        width: getComputedStyle(el).width,
        thBg: getComputedStyle(el.querySelector('th')).backgroundColor,
        tdBorder: getComputedStyle(el.querySelector('td')).borderTopStyle,
      }));
      expect(table.headers).toEqual(['角色', '配置值']);
      expect(table.cells).toContain('Master-eligible');
      expect(table.cells).toContain('master');
      expect(table.display).toBe('table');
      expect(table.borderCollapse).toBe('collapse');
      expect(table.width).not.toBe('auto');
      expect(table.thBg).not.toBe('rgba(0, 0, 0, 0)');
      expect(table.tdBorder).toBe('solid');
    } finally {
      await page.close();
    }
  }, 15000);

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

  it('resumes an active stream from the current session after refresh', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('ai-qa-conversationId', 'active-stream-conv');
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({
            sessions: [{
              id: 'active-stream-conv',
              title: '生成中会话',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastChapterFile: 'sample-chapter.md',
              messageCount: 2,
            }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/sessions/active-stream-conv' && (!init || init.method === 'GET')) {
          throw new Error('streaming restore must use resume endpoint');
        }
        if (url === '/api/ai-qa/sessions/active-stream-conv/resume') {
          const session = {
            id: 'active-stream-conv',
            title: '生成中会话',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastChapterFile: 'sample-chapter.md',
            messages: [{
              id: 'user-active-stream-1',
              role: 'user',
              content: '继续吗？',
              context: { chapterFile: 'sample-chapter.md' },
              createdAt: new Date().toISOString(),
            }, {
              id: 'assistant-active-stream-1',
              role: 'assistant',
              content: '**部分**',
              thinking: '已经思考',
              tools: [{ id: 'tool-1', name: 'read', args: { path: 'README.md' }, result: 'README content', status: 'done' }],
              status: 'streaming',
              streamOffset: 1,
              createdAt: new Date().toISOString(),
            }],
          };
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('event: snapshot\ndata: ' + JSON.stringify({ session }) + '\n\nevent: text_delta\ndata: {"delta":"\\n\\n- 后续","index":1}\n\nevent: done\ndata: {"index":2}\n\n'));
              controller.close();
            },
          });
          return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        return originalFetch(input, init);
      };
    });

    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="ai-qa"].active');

      await page.waitForFunction(() => document.querySelector('.ai-qa-message.assistant:not(.streaming) li')?.textContent.trim() === '后续');
      const snapshot = await page.$eval('.ai-qa-message.assistant:not(.streaming)', el => ({
        html: el.innerHTML,
        thinkingCount: el.querySelectorAll('.ai-qa-thinking .ai-qa-tree-text').length,
        thinkingText: el.querySelector('.ai-qa-thinking .ai-qa-tree-text')?.textContent.trim() || '',
        toolCount: el.querySelectorAll('.ai-qa-thinking .ai-qa-tool-call pre').length,
        toolText: el.querySelector('.ai-qa-thinking .ai-qa-tool-call pre')?.textContent.trim() || '',
      }));
      const answerHtml = snapshot.html;
      const textareaDisabled = await page.$eval('.core-panel-pane[data-tab-id="ai-qa"] textarea', el => el.disabled);
      expect(snapshot.thinkingCount).toBe(1);
      expect(snapshot.thinkingText).toBe('已经思考');
      expect(snapshot.toolCount).toBe(1);
      expect(snapshot.toolText).toContain('README.md');
      expect(answerHtml).toContain('<strong>部分</strong>');
      expect(answerHtml).toContain('<li>后续</li>');
      expect(textareaDisabled).toBe(false);
    } finally {
      await page.close();
    }
  }, 15000);

  it('restores persisted thinking blocks when loading conversation history after refresh', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('ai-qa-conversationId', 'thinking-history-conv');
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({
            sessions: [{
              id: 'thinking-history-conv',
              title: '思考历史会话',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastChapterFile: 'sample-chapter.md',
              messageCount: 2,
            }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/sessions/thinking-history-conv' && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({
            session: {
              id: 'thinking-history-conv',
              title: '思考历史会话',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              lastChapterFile: 'sample-chapter.md',
              messages: [{
                id: 'user-thinking-history-1',
                role: 'user',
                content: '为什么这样？',
                context: { chapterFile: 'sample-chapter.md' },
                createdAt: new Date().toISOString(),
              }, {
                id: 'assistant-thinking-history-1',
                role: 'assistant',
                content: '**结论**\n\n- 可以恢复',
                thinking: '先分析上下文，再回答',
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
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="ai-qa"].active');

      const thinkingText = await page.$eval('.ai-qa-thinking .ai-qa-tree-text', el => el.textContent.trim());
      const answerHtml = await page.$eval('.ai-qa-message.assistant', el => el.innerHTML);
      expect(thinkingText).toBe('先分析上下文，再回答');
      expect(answerHtml).toContain('<strong>结论</strong>');
      expect(answerHtml).toContain('<li>可以恢复</li>');
    } finally {
      await page.close();
    }
  }, 15000);

  it('renders tool traces collapsed and keeps loading dots until done', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.removeItem('ai-qa-conversationId');
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url === '/api/ai-qa/sessions' && (!init || init.method === 'GET')) {
          return new Response(JSON.stringify({ sessions: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/sessions' && init?.method === 'POST') {
          return new Response(JSON.stringify({
            session: { id: 'tool-trace-conv', title: '工具调用', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastChapterFile: null, messageCount: 0 },
          }), { status: 201, headers: { 'Content-Type': 'application/json' } });
        }
        if (url === '/api/ai-qa/chat') {
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            async start(controller) {
              await new Promise(resolve => setTimeout(resolve, 200));
              controller.enqueue(encoder.encode('event: thinking_delta\ndata: {"delta":"先查资料"}\n\n'));
              await new Promise(resolve => setTimeout(resolve, 200));
              controller.enqueue(encoder.encode('event: tool_call_start\ndata: {"tool":{"contentIndex":0,"status":"call_start"},"index":1}\n\nevent: tool_call_delta\ndata: {"tool":{"contentIndex":0,"delta":"{\\\"path\\\":\\\"README.md\\\"}","status":"call_delta"},"index":2}\n\nevent: tool_call_end\ndata: {"tool":{"contentIndex":0,"id":"tool-1","name":"read","arguments":{"path":"README.md"},"status":"call_end"},"index":3}\n\n'));
              await new Promise(resolve => setTimeout(resolve, 200));
              controller.enqueue(encoder.encode('event: tool_execution_start\ndata: {"tool":{"id":"tool-1","name":"read","args":{"path":"README.md"}},"index":4}\n\n'));
              await new Promise(resolve => setTimeout(resolve, 200));
              controller.enqueue(encoder.encode('event: tool_execution_end\ndata: {"tool":{"id":"tool-1","name":"read","result":"README content","isError":false},"index":5}\n\nevent: thinking_delta\ndata: {"delta":"，继续分析"}\n\nevent: text_delta\ndata: {"delta":"**结果**","index":6}\n\n'));
              await new Promise(resolve => setTimeout(resolve, 200));
              controller.enqueue(encoder.encode('event: done\ndata: {"index":4}\n\n'));
              controller.close();
            },
          });
          return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
        }
        return originalFetch(input, init);
      };
    });

    try {
      await page.goto(`${baseUrl}/sample-chapter.md`);
      await page.waitForFunction(() => window.__core__ && window.__ai_qa__);
      await page.evaluate(() => window.__core__.panel.open('ai-qa'));
      await page.waitForFunction(() => window.__ai_qa_ready__);
      await page.fill('.core-panel-pane[data-tab-id="ai-qa"] textarea', '需要工具');
      await page.click('.core-panel-pane[data-tab-id="ai-qa"] .btn-send');
      await page.waitForSelector('.ai-qa-message.assistant.streaming .ai-qa-node-loading[data-loading-for="assistant"]');
      await page.waitForFunction(() => document.querySelector('.ai-qa-thinking .ai-qa-tree-text')?.textContent.includes('先查资料'));
      const loadingAfterThinking = await page.$eval('.ai-qa-thinking', el => Boolean(el.querySelector('.ai-qa-node-loading[data-loading-for="thinking"]')));
      const thinkingSummaryLayout = await page.$eval('.ai-qa-thinking > summary', el => {
        const label = Array.from(el.children).find(child => child.textContent.includes('思考过程'));
        const hint = el.querySelector('.thinking-hint');
        const loading = el.querySelector('.ai-qa-node-loading');
        const labelRect = label.getBoundingClientRect();
        const loadingRect = loading.getBoundingClientRect();
        const hintRect = hint.getBoundingClientRect();
        const summaryRect = el.getBoundingClientRect();
        return {
          summaryNowrap: getComputedStyle(el).whiteSpace,
          labelNowrap: label ? getComputedStyle(label).whiteSpace : '',
          hintNowrap: hint ? getComputedStyle(hint).whiteSpace : '',
          loadingFlex: loading ? getComputedStyle(loading).flexShrink : '',
          labelRight: labelRect.right,
          hintRight: hintRect.right,
          loadingLeft: loadingRect.left,
          loadingRight: loadingRect.right,
          summaryRight: summaryRect.right,
        };
      });
      await page.waitForSelector('.ai-qa-thinking .ai-qa-tool-call:not([open])', { state: 'attached' });
      const thinkingLoadingWhileToolVisible = await page.$eval('.ai-qa-message.assistant.streaming', el => Boolean(
        el.querySelector('.ai-qa-thinking .ai-qa-node-loading[data-loading-for="thinking"]') && el.querySelector('.ai-qa-thinking .ai-qa-tool-call')
      ));
      await page.waitForSelector('.ai-qa-tool-call .ai-qa-node-loading[data-loading-for="tool"]', { state: 'attached' });
      const loadingDuringStream = await page.$eval('.ai-qa-tool-call', el => Boolean(el.querySelector('.ai-qa-node-loading[data-loading-for="tool"]')));
      await page.waitForFunction(() => document.querySelectorAll('.ai-qa-thinking .ai-qa-tree-items > .ai-qa-tree-text').length === 2);
      const toolSummary = await page.$eval('.ai-qa-tool-call summary', el => el.textContent);
      const toolText = await page.$eval('.ai-qa-tool-call pre', el => el.textContent);
      const toolBlockLayout = await page.$eval('.ai-qa-tool-call', el => ({
        count: document.querySelectorAll('.ai-qa-tool-call').length,
        alignSelf: getComputedStyle(el).alignSelf,
        marginLeft: getComputedStyle(el).marginLeft,
        hasLoading: Boolean(el.querySelector('.ai-qa-node-loading[data-loading-for="tool"]')),
      }));
      const treeParts = await page.$eval('.ai-qa-thinking .ai-qa-tree-items', el => Array.from(el.children).map(child => child.className));
      const thinkingText = await page.$eval('.ai-qa-thinking .ai-qa-tree-items', el => el.textContent);
      const order = await page.$eval('.ai-qa-message.assistant.streaming', el => Array.from(el.children).map(child => child.className));
      const streamingBorder = await page.$eval('.ai-qa-message.assistant.streaming', el => getComputedStyle(el).borderTopStyle);
      expect(loadingAfterThinking).toBe(true);
      expect(thinkingSummaryLayout.summaryNowrap).toBe('nowrap');
      expect(thinkingSummaryLayout.labelNowrap).toBe('nowrap');
      expect(thinkingSummaryLayout.hintNowrap).toBe('nowrap');
      expect(thinkingSummaryLayout.loadingFlex).toBe('0');
      expect(thinkingSummaryLayout.loadingLeft).toBeGreaterThan(thinkingSummaryLayout.labelRight);
      expect(thinkingSummaryLayout.loadingLeft).toBeGreaterThan(thinkingSummaryLayout.hintRight);
      expect(thinkingSummaryLayout.loadingRight).toBeLessThanOrEqual(thinkingSummaryLayout.summaryRight);
      expect(thinkingLoadingWhileToolVisible).toBe(true);
      expect(loadingDuringStream).toBe(true);
      expect(toolBlockLayout.count).toBe(1);
      expect(toolBlockLayout.alignSelf).not.toBe('center');
      expect(toolBlockLayout.marginLeft).toBe('8px');
      expect(treeParts).toEqual(['ai-qa-tree-text', 'ai-qa-tool-call', 'ai-qa-tree-text']);
      expect(thinkingText).toContain('先查资料');
      expect(thinkingText).toContain('继续分析');
      expect(order).toContain('ai-qa-message-body');
      expect(order).toContain('ai-qa-thinking');
      expect(order).not.toContain('ai-qa-tools');
      expect(order.indexOf('ai-qa-thinking')).toBeLessThan(order.indexOf('ai-qa-message-body'));
      expect(streamingBorder).toBe('none');
      expect(toolSummary).toContain('工具调用');
      expect(toolText).toContain('工具：read');
      expect(toolText).toContain('参数：');
      expect(toolText).toContain('结果：');
      expect(toolText).toContain('README.md');
      expect(toolText).not.toContain('[call_start]');
      expect(toolText).not.toContain('[call_delta]');
      expect(toolText).not.toContain('[execution_start]');
      expect(toolText).not.toContain('[execution_end]');

      await page.waitForFunction(() => document.querySelector('.ai-qa-message.assistant:not(.streaming) strong')?.textContent === '结果');
      const finalOrder = await page.$eval('.ai-qa-message.assistant:not(.streaming)', el => Array.from(el.children).map(child => child.className));
      const loadingAfterDone = await page.$('.ai-qa-message.assistant .ai-qa-node-loading');
      const finalToolCount = await page.$$eval('.ai-qa-message.assistant:not(.streaming) .ai-qa-tool-call', els => els.length);
      expect(finalToolCount).toBe(1);
      expect(finalOrder.indexOf('ai-qa-thinking')).toBeLessThan(finalOrder.indexOf('ai-qa-message-body'));
      expect(finalOrder).not.toContain('ai-qa-tools');
      expect(loadingAfterDone).toBe(null);
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
                  controller.enqueue(encoder.encode('event: text_delta\ndata: {"delta":"\\n\\n- final"}\n\nevent: done\ndata: {}\n\n'));
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
      await page.waitForFunction(() => document.querySelector('.ai-qa-thinking .ai-qa-tree-text')?.textContent.trim() === 'plan');
      await page.waitForFunction(() => document.querySelector('.ai-qa-message.assistant.streaming strong')?.textContent === 'ok');
      const streamingAnswerHtml = await page.$eval('.ai-qa-message.assistant.streaming', el => el.innerHTML);
      await page.waitForFunction(() => document.querySelector('.ai-qa-message.assistant:not(.streaming) li')?.textContent.trim() === 'final');
      const thinkingText = await page.$eval('.ai-qa-thinking .ai-qa-tree-text', el => el.textContent.trim());
      const finalAnswerHtml = await page.$eval('.ai-qa-message.assistant:not(.streaming)', el => el.innerHTML);
      expect(thinkingText).toBe('plan');
      expect(streamingAnswerHtml).toContain('<strong>ok</strong>');
      expect(finalAnswerHtml).toContain('<strong>ok</strong>');
      expect(finalAnswerHtml).toContain('<li>final</li>');

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
