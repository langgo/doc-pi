import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chromium } from 'playwright';
import { startE2EServer } from './helpers/server.js';
import { gotoFixture, selectFirstParagraphText } from './helpers/browser.js';

let browser;
let page;
let server;
let BASE_URL;
const PRIMARY_CHAPTER = '/sample-chapter.md';
const PRIMARY_CHAPTER_FILE = 'sample-chapter.md';
const SECONDARY_CHAPTER_FILE = 'secondary-chapter.md';

beforeAll(async () => {
  server = await startE2EServer({ ai: false });
  BASE_URL = server.baseUrl;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
}, 30000);

afterAll(async () => {
  if (browser) await browser.close();
  if (server) await server.stop();
});

async function goto(pathname = '') {
  await gotoFixture(page, BASE_URL, pathname);
}

describe('Comments E2E', () => {
  it('has comment panel toggle button', async () => {
    await goto(PRIMARY_CHAPTER);
    // The comment toggle button should exist
    const toggleBtn = await page.$('#comments-toggle');
    expect(toggleBtn).not.toBeNull();
  });

  it('opens comments panel when toggle clicked', async () => {
    await goto(PRIMARY_CHAPTER);
    await page.click('#comments-toggle');
    await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="comments"].active', { timeout: 3000 });
    expect(await page.$('.comment-panel-list')).not.toBeNull();
  });

  it('comment submission should preserve context supplied by core selection', async () => {
    await goto(PRIMARY_CHAPTER);
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

      const content = document.querySelector('.markdown-content p');
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
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

  it('comment annotation click should open comments tab and focus the card', async () => {
    await goto(PRIMARY_CHAPTER);

    const context = await page.evaluate(() => {
      const content = document.querySelector('.markdown-content p');
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      const text = node.textContent;
      const selectedText = text.trim().slice(0, 16);
      const idx = text.indexOf(selectedText);
      return {
        selectedText,
        contextBefore: text.slice(Math.max(0, idx - 20), idx),
        contextAfter: text.slice(idx + selectedText.length, idx + selectedText.length + 20),
      };
    });

    const createRes = await fetch(`${BASE_URL}/api/comments/${PRIMARY_CHAPTER_FILE}`, {
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
      await fetch(`${BASE_URL}/api/comments/${PRIMARY_CHAPTER_FILE}?id=${created.id}`, { method: 'DELETE' });
    }
  }, 15000);

  it('comment quote click should not fallback to plugin highlight when core locator misses', async () => {
    await goto(PRIMARY_CHAPTER);

    const context = await page.evaluate(() => {
      const content = document.querySelector('.markdown-content p');
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      const text = node.textContent;
      const selectedText = text.trim().slice(0, 16);
      const idx = text.indexOf(selectedText);
      return {
        selectedText,
        contextBefore: text.slice(Math.max(0, idx - 20), idx),
        contextAfter: text.slice(idx + selectedText.length, idx + selectedText.length + 20),
      };
    });

    const createRes = await fetch(`${BASE_URL}/api/comments/${PRIMARY_CHAPTER_FILE}`, {
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
      await page.waitForFunction((id) => {
        const highlight = document.querySelector(`.comment-highlight[data-comment-id="${id}"]`);
        return highlight && !highlight.classList.contains('active');
      }, created.id);

      const pluginHighlightActivated = await page.$eval(
        `.comment-highlight[data-comment-id="${created.id}"]`,
        el => el.classList.contains('active')
      );
      expect(pluginHighlightActivated).toBe(false);
    } finally {
      await fetch(`${BASE_URL}/api/comments/${PRIMARY_CHAPTER_FILE}?id=${created.id}`, { method: 'DELETE' });
    }
  }, 15000);

  it('shows chapter management bar in comments panel', async () => {
    await goto(PRIMARY_CHAPTER);
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
    await goto(PRIMARY_CHAPTER);
    await page.click('#comments-toggle');
    await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="comments"].active', { timeout: 3000 });
    // Wait for async chapter bar population
    await page.waitForFunction(() => {
      var sel = document.querySelector('.comment-chapter-select');
      return sel && sel.value !== '';
    }, { timeout: 5000 });
    const selectedValue = await page.$eval('.comment-chapter-select', el => el.value);
    expect(selectedValue).toBe(PRIMARY_CHAPTER_FILE);
  }, 15000);

  it('comment form should validate empty content, save author, render card, and delete with confirmation', async () => {
    await goto(PRIMARY_CHAPTER);
    const initialBadge = await page.$eval('#comments-toggle .floating-action-badge', el => Number(el.textContent.trim() || 0)).catch(() => 0);
    const selectedText = await selectFirstParagraphText(page, 14);
    await page.evaluate((text) => window.__comments__.handleSelection({
      selectedText: text,
      contextBefore: '',
      contextAfter: '',
      chapterFile: window.__core__.state.currentFile,
      source: 'article',
    }), selectedText);

    await page.waitForSelector('#comment-form-overlay.visible .comment-form');
    await page.click('#comment-submit');
    const validationError = await page.$eval('#comment-form-error.visible', el => el.textContent.trim());
    expect(validationError).toBe('请输入评论内容');

    await page.fill('#comment-author-input', 'FlowTester');
    await page.fill('#comment-textarea', 'full flow comment');
    await page.click('#comment-submit');
    await page.waitForSelector('#comment-form-overlay', { state: 'detached' });
    await page.click('#comments-toggle');
    await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="comments"].active');
    await page.waitForSelector('.comment-card:has-text("full flow comment")');

    const card = await page.$eval('.comment-card:has-text("full flow comment")', el => ({
      author: el.querySelector('.card-author')?.textContent.trim(),
      quote: el.querySelector('.card-quote')?.textContent.trim(),
      id: el.dataset.commentId,
    }));
    expect(card.author).toBe('FlowTester');
    expect(card.quote).toBe(selectedText);
    expect(await page.evaluate(() => localStorage.getItem('comment-author'))).toBe('FlowTester');
    expect(await page.$eval('#comments-toggle .floating-action-badge', el => Number(el.textContent.trim() || 0))).toBe(initialBadge + 1);

    await page.click(`.comment-card[data-comment-id="${card.id}"] [data-action="delete"]`);
    await page.waitForSelector('.core-panel-confirm-overlay .core-panel-confirm-dialog');
    const dialogTitle = await page.$eval('.core-panel-confirm-title', el => el.textContent.trim());
    expect(dialogTitle).toContain('确认删除');
    await page.click('.core-panel-confirm-actions button.danger');
    await page.waitForFunction((id) => !document.querySelector(`.comment-card[data-comment-id="${id}"]`), card.id);
    expect(await page.$eval('#comments-toggle .floating-action-badge', el => Number(el.textContent.trim() || 0))).toBe(initialBadge);
  }, 15000);

  it('shows delete error when comment deletion fails', async () => {
    await goto(PRIMARY_CHAPTER);
    const createRes = await fetch(`${BASE_URL}/api/comments/${PRIMARY_CHAPTER_FILE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedText: 'This is a test', comment: 'delete failure comment', author: 'E2E' }),
    });
    const created = await createRes.json();
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__core__ && window.__comments__);
      await page.evaluate(() => {
        const originalFetch = window.fetch;
        window.fetch = async (input, init) => {
          if (String(input).startsWith('/api/comments/') && init?.method === 'DELETE') {
            return new Response(JSON.stringify({ error: 'delete failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
          }
          return originalFetch(input, init);
        };
        window.__core__.panel.open('comments');
      });
      await page.waitForSelector(`.comment-card[data-comment-id="${created.id}"]`);
      await page.click(`.comment-card[data-comment-id="${created.id}"] [data-action="delete"]`);
      await page.waitForSelector('.core-panel-confirm-overlay .core-panel-confirm-dialog');
      await page.click('.core-panel-confirm-actions button.danger');
      await page.waitForSelector('.core-panel-notice.error:has-text("删除失败")');
      expect(await page.$(`.comment-card[data-comment-id="${created.id}"]`)).not.toBeNull();
    } finally {
      await fetch(`${BASE_URL}/api/comments/${PRIMARY_CHAPTER_FILE}?id=${created.id}`, { method: 'DELETE' });
    }
  }, 15000);

  it('shows a save error when comment creation fails', async () => {
    await goto(PRIMARY_CHAPTER);
    await page.evaluate(async () => {
      const originalFetch = window.fetch;
      window.fetch = async (input, init) => {
        if (String(input).startsWith('/api/comments/') && init?.method === 'POST') {
          return new Response(JSON.stringify({ error: 'save failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
        return originalFetch(input, init);
      };
      const paragraph = document.querySelector('.markdown-content p');
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      const selectedText = node.textContent.trim().slice(0, 12);
      const text = node.textContent;
      const idx = text.indexOf(selectedText);
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + selectedText.length);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      await window.__comments__.handleSelection({ selectedText, contextBefore: '', contextAfter: '', chapterFile: window.__core__.state.currentFile, source: 'article' });
    });
    await page.waitForSelector('#comment-form-overlay.visible .comment-form');
    await page.fill('#comment-textarea', 'will fail');
    await page.click('#comment-submit');
    const errorText = await page.$eval('#comment-form-error.visible', el => el.textContent.trim());
    expect(errorText).toContain('保存失败');
  }, 15000);

  it('escapes comment content when rendering cards', async () => {
    await goto(PRIMARY_CHAPTER);
    const createRes = await fetch(`${BASE_URL}/api/comments/${PRIMARY_CHAPTER_FILE}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedText: 'This is a test',
        comment: '<img src=x onerror="window.__commentXss=1">safe',
        author: '<b>Bad</b>',
      }),
    });
    const created = await createRes.json();
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__core__ && window.__comments__);
      await page.evaluate(() => window.__core__.panel.open('comments'));
      await page.waitForSelector(`.comment-card[data-comment-id="${created.id}"]`);
      const rendered = await page.$eval(`.comment-card[data-comment-id="${created.id}"]`, el => ({
        html: el.innerHTML,
        author: el.querySelector('.card-author')?.textContent,
        body: el.querySelector('.card-body')?.textContent,
        hasImage: !!el.querySelector('img'),
        xss: window.__commentXss || 0,
      }));
      expect(rendered.author).toBe('<b>Bad</b>');
      expect(rendered.body).toContain('<img src=x');
      expect(rendered.hasImage).toBe(false);
      expect(rendered.xss).toBe(0);
      expect(rendered.html).toContain('&lt;img');
    } finally {
      await fetch(`${BASE_URL}/api/comments/${PRIMARY_CHAPTER_FILE}?id=${created.id}`, { method: 'DELETE' });
    }
  }, 15000);

  it('chapter select should navigate to another chapter', async () => {
    // First create a comment on another chapter so it appears in the summary
    const createRes = await fetch(`${BASE_URL}/api/comments/${SECONDARY_CHAPTER_FILE}`, {
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
      await goto(PRIMARY_CHAPTER);
      await page.click('#comments-toggle');
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="comments"].active', { timeout: 3000 });
      // Wait for async chapter bar population
      await page.waitForFunction(() => {
        var sel = document.querySelector('.comment-chapter-select');
        return sel && sel.value !== '';
      }, { timeout: 5000 });

      // Select the other chapter
      await page.selectOption('.comment-chapter-select', SECONDARY_CHAPTER_FILE);
      // Should navigate to that chapter
      await page.waitForURL('**/secondary-chapter.md#comments', { timeout: 5000 });
      const url = page.url();
      expect(url).toContain('secondary-chapter.md');
    } finally {
      await fetch(`${BASE_URL}/api/comments/${SECONDARY_CHAPTER_FILE}?id=${created.id}`, { method: 'DELETE' });
    }
  }, 15000);
});
