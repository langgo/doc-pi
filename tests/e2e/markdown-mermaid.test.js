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
      expect(await page.$eval('.markdown-content h1', el => el.childNodes[0].textContent.trim())).toBe('Rich Markdown Fixture');
      expect(await page.$eval('.markdown-content pre code', el => el.textContent.trim())).toContain('const answer = 42;');
      expect(await page.$eval('.markdown-content table tbody tr td:first-child', el => el.textContent.trim())).toBe('alpha');
      expect(await page.$eval('.markdown-content blockquote', el => el.textContent.trim())).toBe('Quoted text for rendering.');
      const link = await page.$eval('.markdown-content a[href="https://example.com"]', el => ({
        text: el.textContent.trim(),
        target: el.getAttribute('target'),
        rel: el.getAttribute('rel'),
      }));
      const localTarget = await page.$eval('.markdown-content a[href="/sample-chapter.md"]', el => el.getAttribute('target'));
      const hashTarget = await page.$eval('.markdown-content a[href="#table"]', el => el.getAttribute('target'));
      expect(link.text).toBe('Example');
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noopener noreferrer');
      expect(localTarget).toBeNull();
      expect(hashTarget).toBeNull();
    } finally {
      await page.close();
    }
  });

  it('renders task lists as read-only aligned checkboxes', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.waitForSelector('.markdown-content li.task-list-item');
      const state = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.markdown-content li.task-list-item'));
        const inputs = Array.from(document.querySelectorAll('.markdown-content li.task-list-item input[type="checkbox"]'));
        return {
          itemCount: items.length,
          checked: inputs.map(input => input.checked),
          disabled: inputs.map(input => input.disabled),
          firstListStyle: getComputedStyle(items[0]).listStyleType,
          firstDisplay: getComputedStyle(items[0]).display,
        };
      });
      expect(state.itemCount).toBe(2);
      expect(state.checked).toEqual([true, false]);
      expect(state.disabled).toEqual([true, true]);
      expect(state.firstListStyle).toBe('none');
      expect(state.firstDisplay).toBe('flex');
    } finally {
      await page.close();
    }
  });

  it('opens markdown images in the lightbox', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.waitForSelector('.markdown-content img[alt="Tiny inline SVG"]');
      await page.click('.markdown-content img[alt="Tiny inline SVG"]');
      await page.waitForSelector('.lightbox.active', { timeout: 5000 });
      const image = await page.$eval('#lightbox-content img', el => ({ alt: el.getAttribute('alt'), src: el.getAttribute('src') }));
      expect(image.alt).toBe('Tiny inline SVG');
      expect(image.src).toContain('data:image/svg+xml');
      await page.click('#lightbox-close');
      await page.waitForFunction(() => !document.querySelector('.lightbox')?.classList.contains('active'));
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

  it('shows a readable fallback when Mermaid rendering fails', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.waitForSelector('.mermaid-error', { timeout: 10000 });
      const errorText = await page.$eval('.mermaid-error', el => el.textContent);
      expect(errorText).toContain('Mermaid diagram failed to render');
      expect(errorText).toContain('this is not valid mermaid');
      expect(await page.$('.mermaid-container svg')).not.toBeNull();
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
