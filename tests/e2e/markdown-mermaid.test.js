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
      expect(await page.title()).toBe('Rich Metadata Title - Fixtures');
      expect(await page.$eval('.markdown-content h1', el => el.childNodes[0].textContent.trim())).toBe('Rich Markdown Fixture');
      const metadata = await page.$eval('.frontmatter-metadata', el => ({
        text: el.textContent,
        tags: Array.from(el.querySelectorAll('.frontmatter-tag')).map(tag => tag.textContent),
      }));
      expect(metadata.text).toContain('Rich Metadata Title');
      expect(metadata.text).toContain('Metadata summary for rendering.');
      expect(metadata.tags).toEqual(['docs', 'guide']);
      expect(await page.$eval('.markdown-content', el => el.textContent)).not.toContain('title: Rich Metadata Title');
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

  it('renders footnote references and backlinks', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.waitForSelector('.footnote-ref');
      const state = await page.evaluate(() => ({
        refHref: document.querySelector('.footnote-ref')?.getAttribute('href'),
        refId: document.querySelector('.footnote-ref')?.getAttribute('id'),
        footnotesText: document.querySelector('.footnotes')?.textContent,
        backlinkHref: document.querySelector('.footnote-backref')?.getAttribute('href'),
      }));
      expect(state.refHref).toBe('#fn-1');
      expect(state.refId).toBe('fnref-1');
      expect(state.footnotesText).toContain('Footnote content for rendering.');
      expect(state.backlinkHref).toBe('#fnref-1');
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

  it('renders safe raw HTML including inline SVG elements', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.waitForSelector('.markdown-content svg.inline-diagram');
      const state = await page.$eval('.markdown-content svg.inline-diagram', el => ({
        tag: el.tagName.toLowerCase(),
        viewBox: el.getAttribute('viewBox'),
        role: el.getAttribute('role'),
        title: el.querySelector('title')?.textContent,
        hasStyle: !!el.querySelector('style'),
        markerId: el.querySelector('marker')?.getAttribute('id'),
        circleFill: getComputedStyle(el.querySelector('circle')).fill,
        circleStroke: getComputedStyle(el.querySelector('circle')).stroke,
        pathMarkerEnd: getComputedStyle(el.querySelector('path.svg-edge')).markerEnd,
        styleText: el.querySelector('style')?.textContent || '',
        text: el.querySelector('text')?.textContent,
      }));
      expect(state).toEqual({
        tag: 'svg',
        viewBox: '0 0 120 80',
        role: 'img',
        title: 'Inline SVG diagram',
        hasStyle: true,
        markerId: 'raw-html-arrow',
        circleFill: 'rgb(9, 105, 218)',
        circleStroke: 'rgb(36, 41, 47)',
        pathMarkerEnd: 'url("#raw-html-arrow")',
        styleText: state.styleText,
        text: 'A',
      });
      expect(state.styleText).not.toContain('@import');
      expect(state.styleText).not.toContain('javascript:');
      expect(state.styleText).not.toContain('expression(');
      const details = await page.$eval('.markdown-content details.raw-html-details', el => ({
        summary: el.querySelector('summary')?.textContent,
        body: el.querySelector('p')?.textContent,
      }));
      expect(details).toEqual({ summary: 'Raw HTML summary', body: 'Raw HTML body' });
    } finally {
      await page.close();
    }
  });

  it('does not execute raw HTML scripts from markdown', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.waitForSelector('.markdown-content');
      const state = await page.evaluate(() => ({
        script: window.__docPiMarkdownXss || 0,
        image: window.__docPiMarkdownImageXss || 0,
        svg: window.__docPiMarkdownSvgXss || 0,
        svgLink: window.__docPiMarkdownSvgLinkXss || 0,
        cssImport: window.__docPiMarkdownCssImportXss || 0,
        cssUrl: window.__docPiMarkdownCssUrlXss || 0,
        cssExpression: window.__docPiMarkdownCssExpressionXss || 0,
        foreignObject: window.__docPiMarkdownForeignObjectXss || 0,
        scriptTagCount: document.querySelectorAll('.markdown-content script').length,
        foreignObjectCount: Array.from(document.querySelectorAll('.markdown-content foreignObject')).filter(el => !el.closest('.mermaid-container')).length,
        javascriptHrefCount: Array.from(document.querySelectorAll('.markdown-content [href], .markdown-content [xlink\\:href]')).filter(el => !el.closest('.mermaid-container') && /javascript:/i.test(el.getAttribute('href') || el.getAttribute('xlink:href') || '')).length,
      }));
      expect(state.script).toBe(0);
      expect(state.image).toBe(0);
      expect(state.svg).toBe(0);
      expect(state.svgLink).toBe(0);
      expect(state.cssImport).toBe(0);
      expect(state.cssUrl).toBe(0);
      expect(state.cssExpression).toBe(0);
      expect(state.foreignObject).toBe(0);
      expect(state.scriptTagCount).toBe(0);
      expect(state.foreignObjectCount).toBe(0);
      expect(state.javascriptHrefCount).toBe(0);
    } finally {
      await page.close();
    }
  });
});
