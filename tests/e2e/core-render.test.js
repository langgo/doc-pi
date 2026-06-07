import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chromium } from 'playwright';
import { startE2EServer } from './helpers/server.js';
import { gotoFixture } from './helpers/browser.js';

let browser;
let server;

describe('Core render E2E', () => {
  beforeAll(async () => {
    server = await startE2EServer({ ai: false });
    browser = await chromium.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await server.stop();
  });

  it('loads homepage with fixture title', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl);
      expect(await page.title()).toContain('Fixtures');
      await expect(page.locator('.markdown-content')).toBeDefined();
    } finally {
      await page.close();
    }
  });

  it('searches markdown content from the sidebar', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      await page.fill('.doc-search-input', 'blockquote');
      await page.waitForSelector('.doc-search-result');
      const resultText = await page.$eval('.doc-search-result', el => el.textContent);
      expect(resultText).toContain('Sample Chapter for Testing');
      expect(resultText).toContain('A blockquote for testing');
      await page.click('.doc-search-result');
      await page.waitForURL(/sample-chapter\.md/);
      expect(page.url()).toContain('sample-chapter.md');
      expect(page.url()).toContain('q=blockquote');
      await page.waitForSelector('.doc-search-hit');
      const highlightedText = await page.$eval('.doc-search-hit', el => el.textContent);
      expect(highlightedText.toLowerCase()).toBe('blockquote');
    } finally {
      await page.close();
    }
  });

  it('marks the current sidebar chapter as active', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      const activeChapterHref = await page.$eval('.toc-nav a.chapter-active', el => el.getAttribute('href'));
      expect(activeChapterHref).toBe('/sample-chapter.md');
    } finally {
      await page.close();
    }
  });

  it('loads chapter page with sidebar and markdown content', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      expect(await page.$('.sidebar')).not.toBeNull();
      expect(await page.$('.markdown-content')).not.toBeNull();
      const h1 = await page.$eval('.markdown-content h1', el => el.textContent.trim());
      const paragraph = await page.$eval('.markdown-content p', el => el.textContent.trim());
      expect(h1).toBe('Sample Chapter for Testing');
      expect(paragraph).toContain('This is a test paragraph');
    } finally {
      await page.close();
    }
  });
});
