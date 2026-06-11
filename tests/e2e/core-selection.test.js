import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chromium } from 'playwright';
import { startE2EServer } from './helpers/server.js';
import { gotoFixture, selectFirstParagraphText, waitForCore } from './helpers/browser.js';

let browser;
let server;

describe('Core selection and annotation E2E', () => {
  beforeAll(async () => {
    server = await startE2EServer({ ai: false });
    browser = await chromium.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))]);
    if (server) await server.stop();
  });

  it('shows selection popup and invokes registered selection action once by id', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      await waitForCore(page);
      await page.evaluate(() => {
        window.__selectionActionHits = 0;
        window.__core__.selection.addAction({ id: 'e2e-action', label: 'E2E Action', handler: () => { window.__selectionActionHits += 1; } });
        window.__core__.selection.addAction({ id: 'e2e-action', label: 'E2E Action Updated', handler: () => { window.__selectionActionHits += 1; } });
      });
      await selectFirstParagraphText(page, 12);
      await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 200, clientY: 200 })));
      await page.waitForSelector('.selection-popup.visible');
      expect(await page.$$eval('.selection-popup [data-selection-action-id="e2e-action"]', els => els.length)).toBe(1);
      await page.click('.selection-popup [data-selection-action-id="e2e-action"]');
      expect(await page.evaluate(() => window.__selectionActionHits)).toBe(1);
    } finally {
      await page.close();
    }
  }, 15000);

  it('annotates ranges crossing inline nodes without empty inline shells', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      await waitForCore(page);
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
        }, { id: 'cross-node-test', className: 'test-cross-node-annotation' });
        const text = Array.from(document.querySelectorAll('.test-cross-node-annotation[data-core-annotation-id="cross-node-test"]'))
          .map(el => el.textContent)
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        window.__core__.article.clearAnnotation('cross-node-test');
        return {
          ok,
          text,
          emptyInlineCount: p.querySelectorAll('code:empty,strong:empty,em:empty,a:empty').length,
          remaining: document.querySelectorAll('.test-cross-node-annotation[data-core-annotation-id="cross-node-test"]').length,
        };
      });
      expect(result.ok).toBe(true);
      expect(result.text).toBe('remove 和 add 是原子操作');
      expect(result.emptyInlineCount).toBe(0);
      expect(result.remaining).toBe(0);
    } finally {
      await page.close();
    }
  }, 15000);

  it('keeps core registries idempotent by id', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      await waitForCore(page);
      await page.evaluate(() => {
        window.__core__.floating.addButton({ id: 'dup-floating', icon: 'A', label: 'Duplicate Floating', onClick: () => {} });
        window.__core__.floating.addButton({ id: 'dup-floating', icon: 'B', label: 'Duplicate Floating Updated', onClick: () => {} });
        window.__core__.panel.addTab({ id: 'dup-tab', label: 'Duplicate Tab', render: container => { container.textContent = 'old'; } });
        window.__core__.panel.addTab({ id: 'dup-tab', label: 'Duplicate Tab Updated', render: container => { container.textContent = 'new'; } });
        window.__core__.panel.open('dup-tab');
      });
      expect(await page.$$eval('#dup-floating', els => els.length)).toBe(1);
      expect(await page.$eval('#dup-floating', el => el.title)).toBe('Duplicate Floating Updated');
      expect(await page.$$eval('.core-panel-tab[data-tab-id="dup-tab"]', els => els.length)).toBe(1);
      expect(await page.$eval('.core-panel-tab[data-tab-id="dup-tab"]', el => el.textContent.trim())).toContain('Duplicate Tab Updated');
      expect(await page.$eval('.core-panel-pane[data-tab-id="dup-tab"]', el => el.textContent.trim())).toBe('new');
    } finally {
      await page.close();
    }
  }, 15000);
});
