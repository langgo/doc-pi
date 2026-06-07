import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chromium } from 'playwright';
import { startE2EServer } from './helpers/server.js';
import { gotoFixture } from './helpers/browser.js';

let browser;
let server;

describe('Markdown and Mermaid E2E', () => {
  beforeAll(async () => {
    server = await startE2EServer({ ai: false, healthPath: '/rich-markdown.md' });
    browser = await chromium.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await server.stop();
  });

  it('renders rich markdown blocks and links', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      expect(await page.$eval('.markdown-content h1', el => el.textContent.trim())).toBe('Rich Markdown Fixture');
      expect(await page.$eval('.markdown-content pre code', el => el.textContent.trim())).toContain('const answer = 42;');
      expect(await page.$eval('.markdown-content table tbody tr td:first-child', el => el.textContent.trim())).toBe('alpha');
      expect(await page.$eval('.markdown-content blockquote', el => el.textContent.trim())).toBe('Quoted text for rendering.');
      const link = await page.$eval('.markdown-content a[href="https://example.com"]', el => ({ text: el.textContent.trim(), target: el.getAttribute('target') }));
      expect(link.text).toBe('Example');
    } finally {
      await page.close();
    }
  });

  it('renders mermaid diagram and opens lightbox', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.waitForSelector('.mermaid-container svg', { timeout: 10000 });
      expect(await page.$('.mermaid-container svg')).not.toBeNull();
      await page.click('.mermaid-container');
      await page.waitForSelector('.lightbox.active', { timeout: 5000 });
      expect(await page.$('#lightbox-content svg')).not.toBeNull();
      await page.click('#lightbox-close');
      await page.waitForFunction(() => !document.querySelector('.lightbox')?.classList.contains('active'));
    } finally {
      await page.close();
    }
  }, 15000);

  it('does not execute raw HTML scripts from markdown', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.waitForSelector('.markdown-content');
      const state = await page.evaluate(() => ({
        script: window.__docPiMarkdownXss || 0,
        image: window.__docPiMarkdownImageXss || 0,
        scriptTagCount: document.querySelectorAll('.markdown-content script').length,
      }));
      expect(state.script).toBe(0);
      expect(state.image).toBe(0);
      expect(state.scriptTagCount).toBe(0);
    } finally {
      await page.close();
    }
  });
});
