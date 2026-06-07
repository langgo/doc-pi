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

  it('copies fenced code blocks without adding buttons to inline code', async () => {
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => {
        window.__copiedText = null;
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async text => { window.__copiedText = text; },
          },
        });
      });
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      await page.waitForSelector('.code-copy-button');
      expect(await page.$$eval('.markdown-content p code .code-copy-button', buttons => buttons.length)).toBe(0);
      await page.click('.code-copy-button');
      expect(await page.evaluate(() => window.__copiedText)).toBe("console.log('hello world');");
      const state = await page.$eval('.code-copy-button', el => ({ text: el.textContent, copied: el.classList.contains('copied') }));
      expect(state.text).toBe('已复制');
      expect(state.copied).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('uses print-friendly layout and hides interactive chrome', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      await page.emulateMedia({ media: 'print' });
      const printState = await page.evaluate(() => {
        const displayOf = selector => getComputedStyle(document.querySelector(selector)).display;
        const mainStyle = getComputedStyle(document.querySelector('.main'));
        return {
          sidebarDisplay: displayOf('.sidebar'),
          floatingActionsDisplay: displayOf('.floating-actions'),
          backToTopDisplay: displayOf('.back-to-top'),
          readingProgressDisplay: displayOf('.reading-progress'),
          mainMarginLeft: mainStyle.marginLeft,
          mainMaxWidth: mainStyle.maxWidth,
          contentVisible: getComputedStyle(document.querySelector('.markdown-content')).display !== 'none',
        };
      });
      expect(printState.sidebarDisplay).toBe('none');
      expect(printState.floatingActionsDisplay).toBe('none');
      expect(printState.backToTopDisplay).toBe('none');
      expect(printState.readingProgressDisplay).toBe('none');
      expect(printState.mainMarginLeft).toBe('0px');
      expect(printState.mainMaxWidth).toBe('none');
      expect(printState.contentVisible).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('shows a back-to-top button after scrolling and returns to top', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 900, height: 360 });
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.waitForSelector('.back-to-top', { state: 'attached' });
      expect(await page.$eval('.back-to-top', el => el.hidden)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForFunction(() => window.scrollY > 300 && !document.querySelector('.back-to-top')?.hidden);
      const rect = await page.$eval('.back-to-top', el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, bottom: r.bottom };
      });
      expect(rect.left).toBeGreaterThan(260);
      expect(rect.right).toBeLessThanOrEqual(900);
      await page.click('.back-to-top');
      await page.waitForFunction(() => window.scrollY <= 5);
      expect(await page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(5);
    } finally {
      await page.close();
    }
  });

  it('updates reading progress while scrolling', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 900, height: 360 });
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.waitForSelector('.reading-progress', { state: 'attached' });
      const initial = await page.$eval('.reading-progress', el => Number(el.style.getPropertyValue('--reading-progress')));
      expect(initial).toBeLessThanOrEqual(5);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.reading-progress')).getPropertyValue('--reading-progress')) > 90);
      const scrolled = await page.$eval('.reading-progress', el => Number(getComputedStyle(el).getPropertyValue('--reading-progress')));
      expect(scrolled).toBeGreaterThan(90);
    } finally {
      await page.close();
    }
  });

  it('supports reader keyboard shortcuts without hijacking text input', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      await page.keyboard.press('/');
      const focusedClass = await page.evaluate(() => document.activeElement?.className || '');
      expect(focusedClass).toContain('doc-search-input');
      await page.keyboard.type('blockquote');
      await page.waitForSelector('.doc-search-result');
      await page.keyboard.press('Escape');
      expect(await page.$eval('.doc-search-input', el => el.value)).toBe('');
      await page.fill('.doc-search-input', 'literal ] text');
      await page.keyboard.press(']');
      expect(page.url()).toContain('/sample-chapter.md');
    } finally {
      await page.close();
    }
  });

  it('copies full heading links when clicking heading anchors', async () => {
    const page = await browser.newPage();
    try {
      await page.addInitScript(() => {
        window.__copiedText = null;
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async text => { window.__copiedText = text; },
          },
        });
      });
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      await page.click('.markdown-content h1 .heading-anchor');
      const copied = await page.evaluate(() => window.__copiedText);
      expect(copied).toBe(`${server.baseUrl}/sample-chapter.md#sample-chapter-for-testing`);
      const label = await page.$eval('.markdown-content h1 .heading-anchor', el => el.getAttribute('aria-label'));
      expect(label).toBe('Copied heading link');
    } finally {
      await page.close();
    }
  });

  it('renders copyable heading anchor links', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      const href = await page.$eval('.markdown-content h1 .heading-anchor', el => el.getAttribute('href'));
      expect(href).toBe('#sample-chapter-for-testing');
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
      const h1 = await page.$eval('.markdown-content h1', el => el.childNodes[0].textContent.trim());
      const paragraph = await page.$eval('.markdown-content p', el => el.textContent.trim());
      expect(h1).toBe('Sample Chapter for Testing');
      expect(paragraph).toContain('This is a test paragraph');
    } finally {
      await page.close();
    }
  });
});
