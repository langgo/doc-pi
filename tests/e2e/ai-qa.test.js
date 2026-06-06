import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chromium } from 'playwright';
import { ROOT_DIR } from '../../src/core/server/config.js';

let browser;
let serverProcess;
const BASE_URL = 'http://localhost:3100';

beforeAll(async () => {
  serverProcess = Bun.spawn(['bun', 'run', 'src/server.js'], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: '3100' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE_URL}/`);
      if (res.ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 300));
  }

  browser = await chromium.launch({ headless: true });
}, 30000);

afterAll(async () => {
  if (browser) await browser.close();
  if (serverProcess) serverProcess.kill();
});

describe('AI QA E2E', () => {
  it('core article annotation should support ranges crossing inline nodes without empty inline shells', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/01-概述.md`);
      await page.waitForFunction(() => window.__core__);
      const result = await page.evaluate(() => {
        const content = document.querySelector('.markdown-content');
        const p = document.createElement('p');
        p.innerHTML = '<strong>关键</strong>：<code>remove</code> 和 <code>add</code> 是<strong>原子操作</strong>——后续内容';
        content.prepend(p);
        const ok = window.__core__.article.annotateText({
          selectedText: 'remove 和 add 是原子操作',
          contextBefore: '关键：',
          contextAfter: '——后续内容',
          chapterFile: window.__core__.state.currentFile,
        }, {
          id: 'cross-node-test',
          className: 'test-cross-node-annotation',
        });
        const mark = document.querySelector('.test-cross-node-annotation[data-core-annotation-id="cross-node-test"]');
        return {
          ok,
          count: document.querySelectorAll('.test-cross-node-annotation[data-core-annotation-id="cross-node-test"]').length,
          text: mark ? mark.textContent.replace(/\s+/g, ' ').trim() : '',
          emptyInlineCount: p.querySelectorAll('code:empty,strong:empty,em:empty,a:empty').length,
        };
      });

      expect(result.ok).toBe(true);
      expect(result.count).toBe(1);
      expect(result.text).toBe('remove 和 add 是原子操作');
      expect(result.emptyInlineCount).toBe(0);
    } finally {
      await page.close();
    }
  }, 15000);

  it('should not annotate article for panel-origin AI context', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/01-概述.md`);
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
      const selectedText = 'ElasticSearch（简称 ES）是一个基于 Apache Lucene 构建的开源分布式搜索与分析引擎。';
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
              lastChapterFile: '01-概述.md',
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
              lastChapterFile: '01-概述.md',
              messages: [{
                id: 'preopen-user-history-1',
                role: 'user',
                content: '解释这段',
                context: {
                  selectedText,
                  contextBefore: '',
                  contextAfter: '它由 Shay',
                  chapterFile: '01-概述.md',
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
      await page.goto(`${BASE_URL}/01-概述.md`);
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
      await page.goto(`${BASE_URL}/01-概述.md`);
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
                lastChapterFile: '01-概述.md',
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
                lastChapterFile: '01-概述.md',
                messages: [{
                  id: 'user-history-1',
                  role: 'user',
                  content: '解释这段',
                  context: {
                    selectedText: text,
                    contextBefore: '',
                    contextAfter: '',
                    chapterFile: '01-概述.md',
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
      expect(displayedChapter).toBe('01-概述.md');
    } finally {
      await page.close();
    }
  }, 15000);

  it('core selection actions should be idempotent by id', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/01-概述.md`);
      await page.waitForFunction(() => window.__core__);
      await page.evaluate(() => {
        window.__core__.selection.addAction({ id: 'dup-action', label: 'Duplicate', handler: function () {} });
        window.__core__.selection.addAction({ id: 'dup-action', label: 'Duplicate Updated', handler: function () {} });
        window.__core__.floating.addButton({ id: 'dup-floating', icon: 'A', label: 'Duplicate Floating', onClick: function () {} });
        window.__core__.floating.addButton({ id: 'dup-floating', icon: 'B', label: 'Duplicate Floating Updated', onClick: function () {} });
        window.__core__.panel.addTab({ id: 'dup-tab', label: 'Duplicate Tab', render: function (container) { container.textContent = 'old'; } });
        window.__core__.panel.addTab({ id: 'dup-tab', label: 'Duplicate Tab Updated', render: function (container) { container.textContent = 'new'; } });
        window.__core__.panel.open('dup-tab');
        window.__core__.panel.close();

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

      const count = await page.$$eval('.selection-popup [data-selection-action-id="dup-action"]', els => els.length);
      const label = await page.$eval('.selection-popup [data-selection-action-id="dup-action"]', el => el.textContent.trim());
      const floatingCount = await page.$$eval('#dup-floating', els => els.length);
      const floatingLabel = await page.$eval('#dup-floating', el => el.title);
      const tabCount = await page.$$eval('.core-panel-tab[data-tab-id="dup-tab"]', els => els.length);
      const tabLabel = await page.$eval('.core-panel-tab[data-tab-id="dup-tab"]', el => el.textContent.trim());
      const paneText = await page.$eval('.core-panel-pane[data-tab-id="dup-tab"]', el => el.textContent.trim());

      expect(count).toBe(1);
      expect(label).toContain('Duplicate Updated');
      expect(floatingCount).toBe(1);
      expect(floatingLabel).toBe('Duplicate Floating Updated');
      expect(tabCount).toBe(1);
      expect(tabLabel).toContain('Duplicate Tab Updated');
      expect(paneText).toBe('new');
    } finally {
      await page.close();
    }
  }, 15000);

  it('persists core panel size and position across refresh', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 1000, height: 700 });
      await page.goto(`${BASE_URL}/01-概述.md`);
      await page.waitForFunction(() => window.__core__);
      await page.evaluate(() => {
        localStorage.removeItem('core-panel-state');
        window.__core__.panel.addTab({
          id: 'persist-panel',
          label: 'Persist',
          render: function (container) { container.textContent = 'persist'; },
        });
        window.__core__.panel.open('persist-panel');
      });
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="persist-panel"].active');
      const actionOrder = await page.$$eval('.core-panel-tabs > button', els => els.slice(-2).map(el => el.className));
      expect(actionOrder).toEqual(['core-panel-reset', 'core-panel-close']);

      const tabBar = await page.$('.core-panel-tabs');
      const tabBox = await tabBar.boundingBox();
      await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(tabBox.x + tabBox.width / 2 - 120, tabBox.y + tabBox.height / 2 - 60);
      await page.mouse.up();

      const eastHandle = await page.$('.core-panel-resize-e');
      const eastBox = await eastHandle.boundingBox();
      await page.mouse.move(eastBox.x + eastBox.width / 2, eastBox.y + eastBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(eastBox.x + eastBox.width / 2 + 70, eastBox.y + eastBox.height / 2);
      await page.mouse.up();

      const before = await page.$eval('.core-panel.open', el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('core-panel-state') || 'null'));
      expect(saved).toBeObject();
      expect(Math.abs(saved.left - before.left)).toBeLessThanOrEqual(2);
      expect(Math.abs(saved.top - before.top)).toBeLessThanOrEqual(2);
      expect(Math.abs(saved.width - before.width)).toBeLessThanOrEqual(2);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__core__);
      await page.evaluate(() => {
        window.__core__.panel.addTab({
          id: 'persist-panel',
          label: 'Persist',
          render: function (container) { container.textContent = 'persist'; },
        });
        window.__core__.panel.open('persist-panel');
      });
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="persist-panel"].active');
      const after = await page.$eval('.core-panel.open', el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });

      expect(Math.abs(after.left - before.left)).toBeLessThanOrEqual(2);
      expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(2);
      expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(2);
      expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(2);

      await page.click('.core-panel-reset');
      const reset = await page.$eval('.core-panel.open', el => {
        const r = el.getBoundingClientRect();
        return { right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      });
      const storedAfterReset = await page.evaluate(() => localStorage.getItem('core-panel-state'));
      expect(storedAfterReset).toBeNull();
      expect(Math.abs(reset.width - 320)).toBeLessThanOrEqual(2);
      expect(Math.abs(reset.height - 600)).toBeLessThanOrEqual(2);
      expect(Math.abs((1000 - reset.right) - 24)).toBeLessThanOrEqual(2);
      expect(Math.abs((700 - reset.bottom) - 24)).toBeLessThanOrEqual(2);
    } finally {
      await page.close();
    }
  }, 15000);

  it('sends decoded chapter file from core selection context', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE_URL}/01-概述.md`);
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
      expect(chapterFile).toBe('01-概述.md');
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

  it('clears stale restored conversation when sessions list does not contain it', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('ai-qa-conversationId', 'stale-conv');
    });

    try {
      await page.goto(`${BASE_URL}/01-概述.md`);
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
      await page.click('#ai-qa-toggle');

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
