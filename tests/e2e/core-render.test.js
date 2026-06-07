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

  it('marks the keyboard-focused recent sidebar search as selected', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.evaluate(() => localStorage.setItem('doc-pi:recent-searches', JSON.stringify(['footnote'])));
      await page.focus('.doc-search-input');
      await page.waitForSelector('.doc-search-recent-item');
      await page.press('.doc-search-input', 'ArrowDown');
      await page.waitForFunction(() => document.querySelector('.doc-search-recent-item')?.getAttribute('aria-selected') === 'true');
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction(() => {
        const item = document.querySelector('.doc-search-recent-item');
        const clear = document.querySelector('.doc-search-clear-recent');
        return item?.getAttribute('aria-selected') === 'false' && clear?.getAttribute('aria-selected') === 'true';
      });
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.doc-search-recent-item, .doc-search-clear-recent')).every(item => item.getAttribute('aria-selected') === 'false'));
    } finally {
      await page.close();
    }
  });

  it('supports keyboard navigation for recent sidebar searches', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.evaluate(() => localStorage.setItem('doc-pi:recent-searches', JSON.stringify(['footnote'])));
      await page.focus('.doc-search-input');
      await page.waitForSelector('.doc-search-recent-item');
      await page.press('.doc-search-input', 'ArrowDown');
      await page.waitForFunction(() => document.activeElement?.classList.contains('doc-search-recent-item'));
      await page.keyboard.press('ArrowUp');
      await page.waitForFunction(() => document.activeElement?.classList.contains('doc-search-input'));
      await page.press('.doc-search-input', 'ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.doc-search-input')?.value === 'footnote');
      await page.waitForSelector('.doc-search-result');
    } finally {
      await page.close();
    }
  });

  it('clears recent sidebar searches without changing the current input', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.evaluate(() => localStorage.setItem('doc-pi:recent-searches', JSON.stringify(['footnote'])));
      await page.fill('.doc-search-input', 'draft query');
      await page.focus('.doc-search-input');
      await page.fill('.doc-search-input', '');
      await page.waitForSelector('.doc-search-clear-recent');
      await page.fill('.doc-search-input', 'draft query');
      await page.click('.doc-search-clear-recent');
      await page.waitForFunction(() => document.querySelector('.doc-search-recent-item') === null);
      expect(await page.evaluate(() => localStorage.getItem('doc-pi:recent-searches'))).toBe(null);
      expect(await page.$eval('.doc-search-input', el => el.value)).toBe('draft query');
    } finally {
      await page.close();
    }
  });

  it('shows recent sidebar searches and reruns them on click', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.evaluate(() => localStorage.clear());
      await page.fill('.doc-search-input', 'footnote');
      await page.waitForSelector('.doc-search-result');
      await page.click('.doc-search-clear');
      await page.focus('.doc-search-input');
      await page.waitForSelector('.doc-search-recent-item');
      expect(await page.$$eval('.doc-search-recent-item', items => items.map(item => item.textContent))).toEqual(['footnote']);
      await page.click('.doc-search-recent-item');
      await page.waitForFunction(() => document.querySelector('.doc-search-input')?.value === 'footnote');
      await page.waitForSelector('.doc-search-result');
      expect(await page.$$('.doc-search-recent-item')).toHaveLength(0);
    } finally {
      await page.close();
    }
  });

  it('shows helpful empty state for sidebar searches without results', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.fill('.doc-search-input', 'tag:docs not-present-anywhere');
      await page.waitForSelector('.doc-search-empty');
      expect(await page.$eval('.doc-search-empty-title', el => el.textContent)).toBe('无匹配结果');
      expect(await page.$eval('.doc-search-empty-hint', el => el.textContent)).toContain('减少关键词');
      expect(await page.$eval('.doc-search-empty-filter-hint', el => el.textContent)).toContain('点击上方标签过滤条件');
      await page.click('.doc-search-clear');
      await page.waitForFunction(() => document.querySelector('.doc-search-empty') === null);
    } finally {
      await page.close();
    }
  });

  it('shows and clears sidebar search loading state', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.route('**/api/search?q=*', async route => {
        await new Promise(resolve => setTimeout(resolve, 100));
        await route.continue();
      });
      await page.fill('.doc-search-input', 'footnote');
      await page.waitForSelector('.doc-search-input-wrap.search-loading');
      await page.waitForSelector('.doc-search-result');
      await page.waitForFunction(() => !document.querySelector('.doc-search-input-wrap')?.classList.contains('search-loading'));
      await page.fill('.doc-search-input', 'another query');
      await page.waitForSelector('.doc-search-input-wrap.search-loading');
      await page.click('.doc-search-clear');
      await page.waitForFunction(() => !document.querySelector('.doc-search-input-wrap')?.classList.contains('search-loading'));
    } finally {
      await page.close();
    }
  });

  it('clears sidebar search with the clear button', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.fill('.doc-search-input', 'tag:docs footnote');
      await page.waitForSelector('.doc-search-result');
      await page.waitForSelector('.doc-search-clear:not([hidden])');
      await page.click('.doc-search-clear');
      await page.waitForFunction(() => document.querySelector('.doc-search-input')?.value === '');
      expect(await page.$$('.doc-search-result')).toHaveLength(0);
      expect(await page.$$('.doc-search-filter-chip')).toHaveLength(0);
      expect(await page.$eval('.doc-search-count', el => el.hidden)).toBe(true);
      expect(new URL(page.url()).searchParams.has('q')).toBe(false);
      expect(await page.$eval('.doc-search-input', el => document.activeElement === el)).toBe(true);
      expect(await page.$eval('.doc-search-clear', el => el.hidden)).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('shows a sidebar search result count badge', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.fill('.doc-search-input', 'footnote');
      await page.waitForSelector('.doc-search-result');
      await page.waitForFunction(() => document.querySelector('.doc-search-count')?.textContent === '2');
      expect(await page.$eval('.doc-search-count', el => el.getAttribute('aria-label'))).toBe('2 个搜索结果');
      await page.fill('.doc-search-input', 'not-present-anywhere');
      await page.waitForFunction(() => document.querySelector('.doc-search-count')?.textContent === '0');
      expect(await page.$eval('.doc-search-count', el => el.getAttribute('aria-label'))).toBe('0 个搜索结果');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.doc-search-count')?.hidden === true);
    } finally {
      await page.close();
    }
  });

  it('restores sidebar search from the URL query parameter', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md?q=tag%3Adocs%20footnote');
      await page.waitForSelector('.doc-search-result');
      expect(await page.$eval('.doc-search-input', el => el.value)).toBe('tag:docs footnote');
      expect(await page.$$eval('.doc-search-filter-chip', chips => chips.map(chip => chip.textContent))).toEqual(['tag:docs']);
      expect(new URL(page.url()).searchParams.get('q')).toBe('tag:docs footnote');
    } finally {
      await page.close();
    }
  });

  it('keeps the URL query parameter in sync with sidebar search input', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.fill('.doc-search-input', 'footnote');
      await page.waitForSelector('.doc-search-result');
      await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === 'footnote');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('q'));
      expect(await page.$$('.doc-search-result')).toHaveLength(0);
    } finally {
      await page.close();
    }
  });

  it('marks the keyboard-focused sidebar search result as selected', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.fill('.doc-search-input', 'footnote');
      await page.waitForSelector('.doc-search-result');
      await page.press('.doc-search-input', 'ArrowDown');
      await page.waitForFunction(() => document.querySelectorAll('.doc-search-result')[0]?.getAttribute('aria-selected') === 'true');
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction(() => {
        const results = document.querySelectorAll('.doc-search-result');
        return results[0]?.getAttribute('aria-selected') === 'false' && results[1]?.getAttribute('aria-selected') === 'true';
      });
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.doc-search-result')).every(result => result.getAttribute('aria-selected') === 'false'));
    } finally {
      await page.close();
    }
  });

  it('supports keyboard navigation in sidebar search results', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.fill('.doc-search-input', 'footnote');
      await page.waitForSelector('.doc-search-result');
      await page.press('.doc-search-input', 'ArrowDown');
      await page.waitForFunction(() => document.activeElement?.classList.contains('doc-search-result'));
      await page.keyboard.press('ArrowUp');
      await page.waitForFunction(() => document.activeElement?.classList.contains('doc-search-input'));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelector('.doc-search-input')?.value === '');
      expect(await page.$$('.doc-search-result')).toHaveLength(0);
    } finally {
      await page.close();
    }
  });

  it('removes tag filter tokens when clicking query chips', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.fill('.doc-search-input', 'tag:docs footnote');
      await page.waitForSelector('.doc-search-filter-chip');
      await page.click('.doc-search-filter-chip');
      await page.waitForFunction(() => document.querySelector('.doc-search-input')?.value === 'footnote');
      expect(await page.$$('.doc-search-filter-chip')).toHaveLength(0);
      await page.waitForSelector('.doc-search-result');
    } finally {
      await page.close();
    }
  });

  it('shows active tag filter chips for tag searches only', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.fill('.doc-search-input', 'tag:docs footnote');
      await page.waitForSelector('.doc-search-filter-chip');
      expect(await page.$$eval('.doc-search-filter-chip', chips => chips.map(chip => chip.textContent))).toEqual(['tag:docs']);
      await page.fill('.doc-search-input', 'footnote');
      await page.waitForFunction(() => document.querySelectorAll('.doc-search-filter-chip').length === 0);
      expect(await page.$$('.doc-search-result')).not.toHaveLength(0);
    } finally {
      await page.close();
    }
  });

  it('filters sidebar search results by tag tokens', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.fill('.doc-search-input', 'tag:docs footnote');
      await page.waitForSelector('.doc-search-result');
      const firstResult = await page.$eval('.doc-search-result', item => ({
        text: item.textContent,
        tags: Array.from(item.querySelectorAll('.doc-search-tag')).map(tag => tag.textContent),
      }));
      expect(firstResult.text).toContain('Rich Metadata Title');
      expect(firstResult.tags).toEqual(['docs', 'guide']);
      await page.fill('.doc-search-input', 'tag:missing footnote');
      await page.waitForFunction(() => document.querySelector('.doc-search-status')?.textContent === '无匹配结果');
      expect(await page.$$('.doc-search-result')).toHaveLength(0);
    } finally {
      await page.close();
    }
  });

  it('highlights matched text in sidebar search snippets', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.fill('.doc-search-input', 'tag:docs footnote');
      await page.waitForSelector('.doc-search-snippet-hit');
      const firstHit = await page.$eval('.doc-search-snippet-hit', el => ({
        text: el.textContent,
        tagName: el.tagName,
      }));
      expect(firstHit).toEqual({ text: 'footnote', tagName: 'MARK' });
      expect(await page.$$eval('.doc-search-filter-chip .doc-search-snippet-hit', hits => hits.length)).toBe(0);
    } finally {
      await page.close();
    }
  });

  it('shows frontmatter tags in sidebar search results', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/rich-markdown.md');
      await page.fill('.doc-search-input', 'footnote');
      await page.waitForSelector('.doc-search-tag');
      const tags = await page.$eval('.doc-search-result', item => Array.from(item.querySelectorAll('.doc-search-tag')).map(tag => tag.textContent));
      expect(tags).toEqual(['docs', 'guide']);
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

  it('labels fenced code block languages without overlapping copy controls', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      await page.waitForSelector('.code-language-label');
      expect(await page.$eval('.code-language-label', el => el.textContent)).toBe('javascript');
      expect(await page.$$eval('.markdown-content p code .code-language-label', labels => labels.length)).toBe(0);
      const positions = await page.evaluate(() => {
        const label = document.querySelector('.code-language-label').getBoundingClientRect();
        const button = document.querySelector('.code-copy-button').getBoundingClientRect();
        return { labelRight: label.right, buttonLeft: button.left };
      });
      expect(positions.labelRight).toBeLessThanOrEqual(positions.buttonLeft - 4);
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
      expect(await page.title()).toBe('sample-chapter.md - Fixtures');
      expect(h1).toBe('Sample Chapter for Testing');
      expect(paragraph).toContain('This is a test paragraph');
    } finally {
      await page.close();
    }
  });
});
