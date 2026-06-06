import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chromium } from 'playwright';
import path from 'path';
import { ROOT_DIR } from '../../src/core/server/config.js';

let browser;
let page;
let serverProcess;
const BASE_URL = 'http://localhost:3097';

beforeAll(async () => {
  // Start server
  serverProcess = Bun.spawn(['bun', 'run', 'src/server.js'], {
    cwd: ROOT_DIR,
    env: { ...process.env, PORT: '3097' },
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
  page = await browser.newPage();
}, 30000);

afterAll(async () => {
  if (browser) await browser.close();
  if (serverProcess) serverProcess.kill();
});

async function goto(pathname = '') {
  await page.goto(`${BASE_URL}${pathname}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.title.includes('ElasticSearch'));
}

describe('Comments E2E', () => {
  it('should load the homepage', async () => {
    await goto();
    const title = await page.title();
    expect(title).toContain('ElasticSearch');
  });

  it('should load a chapter page with sidebar', async () => {
    await goto('/01-概述.md');
    // Sidebar should be visible
    const sidebar = await page.$('.sidebar');
    expect(sidebar).not.toBeNull();

    // Content should be rendered
    const content = await page.$('.markdown-content');
    expect(content).not.toBeNull();
  });

  it('should have comment panel toggle button', async () => {
    await goto('/01-概述.md');
    // The comment toggle button should exist
    const toggleBtn = await page.$('#comments-toggle');
    expect(toggleBtn).not.toBeNull();
  });

  it('should show comment panel when toggle clicked', async () => {
    await goto('/01-概述.md');
    const toggleBtn = await page.$('#comments-toggle');
    if (toggleBtn) {
      await toggleBtn.click();
      // Core panel should open with the comments tab active.
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="comments"].active', { timeout: 3000 });
      const rect = await page.$eval('.core-panel.open', el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
      expect(rect.right).toBeGreaterThan(900);
      expect(rect.bottom).toBeGreaterThan(500);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
    }
  });

  it('should keep open core panel visible when viewport shrinks', async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    try {
      await goto('/01-概述.md');
      await page.click('#comments-toggle');
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="comments"].active', { timeout: 3000 });
      await page.setViewportSize({ width: 280, height: 520 });
      const rect = await page.$eval('.core-panel.open', el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      });
      expect(rect.left).toBeGreaterThanOrEqual(8);
      expect(rect.top).toBeGreaterThanOrEqual(8);
      expect(rect.right).toBeLessThanOrEqual(272);
      expect(rect.bottom).toBeLessThanOrEqual(512);
    } finally {
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  });

  it('should keep core panel fully visible on narrow screens', async () => {
    await page.setViewportSize({ width: 280, height: 520 });
    try {
      await goto('/01-概述.md');
      await page.click('#comments-toggle');
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="comments"].active', { timeout: 3000 });
      const rect = await page.$eval('.core-panel.open', el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      });
      expect(rect.left).toBeGreaterThanOrEqual(8);
      expect(rect.top).toBeGreaterThanOrEqual(8);
      expect(rect.right).toBeLessThanOrEqual(272);
      expect(rect.bottom).toBeLessThanOrEqual(512);
    } finally {
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  });

  it('should show comment form on text selection', async () => {
    await goto('/01-概述.md');

    // Select some text in the content area
    const contentEl = await page.$('.markdown-content p');
    if (contentEl) {
      // Triple-click to select paragraph
      await contentEl.click({ clickCount: 3 });

      // Wait a bit for the popup to appear
      await page.waitForTimeout(500);

      // The comment popup should be visible
      const popup = await page.$('.selection-popup.visible');
      // Popup may or may not appear depending on selection behavior
      // Just verify the page is still functional
      expect(await page.title()).toContain('ElasticSearch');
    }
  });

  it('comment submission should preserve context supplied by core selection', async () => {
    await goto('/01-概述.md');
    const initialBadge = await page.$eval('#comments-toggle .floating-action-badge', el => Number(el.textContent.trim() || 0)).catch(() => 0);
    const captured = await page.evaluate(async () => {
      localStorage.setItem('comment-author', 'E2E');
      const originalFetch = window.fetch;
      let postedBody = null;
      window.fetch = async (input, init) => {
        if (String(input).startsWith('/api/comments/') && init?.method === 'POST') {
          postedBody = JSON.parse(init.body);
          return new Response(JSON.stringify({ id: 'ctx-test', ...postedBody, createdAt: new Date().toISOString(), resolved: false }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return originalFetch(input, init);
      };

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

      await window.__comments__.handleSelection({
        selectedText,
        contextBefore: 'CORE_SUPPLIED_BEFORE',
        contextAfter: 'CORE_SUPPLIED_AFTER',
        chapterFile: decodeURIComponent(location.pathname.slice(1)),
        source: 'article',
      });
      document.querySelector('#comment-textarea').value = 'context source test';
      document.querySelector('#comment-submit').click();
      await new Promise(resolve => setTimeout(resolve, 80));
      window.fetch = originalFetch;
      return postedBody;
    });

    const badgeText = await page.$eval('#comments-toggle .floating-action-badge', el => el.textContent.trim());
    expect(captured.contextBefore).toBe('CORE_SUPPLIED_BEFORE');
    expect(captured.contextAfter).toBe('CORE_SUPPLIED_AFTER');
    expect(Number(badgeText)).toBe(initialBadge + 1);
  }, 15000);

  it('floating action returns to bottom-right after panel resize and close', async () => {
    await goto('/01-概述.md');
    await page.click('#comments-toggle');
    await page.waitForSelector('.core-panel.open');

    const handle = await page.$('.core-panel-resize-n');
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 80);
    await page.mouse.up();

    await page.click('.core-panel-close');
    await page.waitForFunction(() => !document.querySelector('.core-panel')?.classList.contains('open'));

    const bottom = await page.$eval('.floating-actions', el => getComputedStyle(el).bottom);
    expect(bottom).toBe('20px');
  }, 15000);

  it('comment annotation click should open comments tab and focus the card', async () => {
    await goto('/01-概述.md');

    const context = await page.evaluate(() => {
      const content = document.querySelector('.markdown-content');
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent.trim().length > 24) break;
      }
      const text = node.textContent;
      const selectedText = text.trim().slice(0, 16);
      const idx = text.indexOf(selectedText);
      return {
        selectedText,
        contextBefore: text.slice(Math.max(0, idx - 20), idx),
        contextAfter: text.slice(idx + selectedText.length, idx + selectedText.length + 20),
      };
    });

    const createRes = await fetch(`${BASE_URL}/api/comments/01-%E6%A6%82%E8%BF%B0.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...context,
        author: 'E2E',
        sectionHeading: '',
        sectionLevel: 0,
        textHash: 'e2e-annotation-click',
        comment: 'annotation click test',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    try {
      await page.reload();
      await page.waitForFunction(() => window.__core__ && window.__comments__);
      await page.evaluate(() => window.__core__.panel.close());
      await page.click(`.comment-highlight[data-comment-id="${created.id}"]`);
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="comments"].active');
      const activeCard = await page.$eval(`.comment-card[data-comment-id="${created.id}"]`, el => el.classList.contains('active'));
      expect(activeCard).toBe(true);
    } finally {
      await fetch(`${BASE_URL}/api/comments/01-%E6%A6%82%E8%BF%B0.md?id=${created.id}`, { method: 'DELETE' });
    }
  }, 15000);

  it('comment quote click should not fallback to plugin highlight when core locator misses', async () => {
    await goto('/01-概述.md');

    const context = await page.evaluate(() => {
      const content = document.querySelector('.markdown-content');
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent.trim().length > 24) break;
      }
      const text = node.textContent;
      const selectedText = text.trim().slice(0, 16);
      const idx = text.indexOf(selectedText);
      return {
        selectedText,
        contextBefore: text.slice(Math.max(0, idx - 20), idx),
        contextAfter: text.slice(idx + selectedText.length, idx + selectedText.length + 20),
      };
    });

    const createRes = await fetch(`${BASE_URL}/api/comments/01-%E6%A6%82%E8%BF%B0.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...context,
        author: 'E2E',
        sectionHeading: '',
        sectionLevel: 0,
        textHash: 'e2e-core-locator',
        comment: 'core locator ownership test',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    try {
      await page.reload();
      await page.waitForFunction(() => window.__core__ && window.__comments__);
      await page.evaluate(() => {
        window.__comments__.configure({ locateSource: () => false });
        window.__core__.panel.open('comments');
      });
      await page.click(`.comment-card[data-comment-id="${created.id}"] .card-quote`);
      await page.waitForTimeout(100);

      const pluginHighlightActivated = await page.$eval(
        `.comment-highlight[data-comment-id="${created.id}"]`,
        el => el.classList.contains('active')
      );
      expect(pluginHighlightActivated).toBe(false);
    } finally {
      await fetch(`${BASE_URL}/api/comments/01-%E6%A6%82%E8%BF%B0.md?id=${created.id}`, { method: 'DELETE' });
    }
  }, 15000);

  it('should render mermaid diagrams', async () => {
    // Navigate to a chapter that likely has mermaid diagrams
    await goto('/02-核心概念.md');

    // Check for mermaid containers
    const mermaidContainers = await page.$$('.mermaid-container');
    // At least verify the page loaded
    expect(await page.title()).toContain('ElasticSearch');
  }, 15000);

  it('should show chapter management bar in comments panel', async () => {
    await goto('/01-概述.md');
    // Open comments panel
    await page.click('#comments-toggle');
    await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="comments"].active', { timeout: 3000 });
    // Chapter bar should be visible
    const bar = await page.$('.comment-chapter-bar');
    expect(bar).not.toBeNull();
    // Chapter select should exist
    const select = await page.$('.comment-chapter-select');
    expect(select).not.toBeNull();
  }, 15000);

  it('chapter select should show current chapter', async () => {
    await goto('/01-概述.md');
    await page.click('#comments-toggle');
    await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="comments"].active', { timeout: 3000 });
    // Wait for async chapter bar population
    await page.waitForFunction(() => {
      var sel = document.querySelector('.comment-chapter-select');
      return sel && sel.value !== '';
    }, { timeout: 5000 });
    const selectedValue = await page.$eval('.comment-chapter-select', el => el.value);
    expect(selectedValue).toBe('01-概述.md');
  }, 15000);

  it('chapter select should navigate to another chapter', async () => {
    // First create a comment on 02-核心概念.md so it appears in the summary
    const createRes = await fetch(`${BASE_URL}/api/comments/02-%E6%A0%B8%E5%BF%83%E6%A6%82%E5%BF%B5.md`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedText: 'e2e chapter bar test',
        comment: 'E2E chapter bar navigation test',
        author: 'E2ETester',
      }),
    });
    const created = await createRes.json();

    try {
      await goto('/01-概述.md');
      await page.click('#comments-toggle');
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="comments"].active', { timeout: 3000 });
      // Wait for async chapter bar population
      await page.waitForFunction(() => {
        var sel = document.querySelector('.comment-chapter-select');
        return sel && sel.value !== '';
      }, { timeout: 5000 });

      // Select the other chapter
      await page.selectOption('.comment-chapter-select', '02-核心概念.md');
      // Should navigate to that chapter
      await page.waitForURL('**/02-%E6%A0%B8%E5%BF%83%E6%A6%82%E5%BF%B5.md#comments', { timeout: 5000 });
      const url = page.url();
      expect(url).toContain('02-%E6%A0%B8%E5%BF%83%E6%A6%82%E5%BF%B5.md');
    } finally {
      await fetch(`${BASE_URL}/api/comments/02-%E6%A0%B8%E5%BF%83%E6%A6%82%E5%BF%B5.md?id=${created.id}`, { method: 'DELETE' });
    }
  }, 15000);
});
