import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { chromium } from 'playwright';
import { startE2EServer } from './helpers/server.js';
import { gotoFixture, waitForCore } from './helpers/browser.js';

let browser;
let server;

describe('Core panel E2E', () => {
  beforeAll(async () => {
    server = await startE2EServer({ ai: false });
    browser = await chromium.launch({ headless: true });
  }, 30000);

  afterAll(async () => {
    if (server) await server.stop();
  });

  it('collapses sidebar and persists collapsed state across refresh', async () => {
    const page = await browser.newPage();
    try {
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      await waitForCore(page);
      await page.evaluate(() => localStorage.removeItem('core-sidebar-collapsed'));
      await page.click('.sidebar-collapse-toggle');
      await page.waitForSelector('.app.sidebar-collapsed');
      expect(await page.evaluate(() => localStorage.getItem('core-sidebar-collapsed'))).toBe('1');
      const collapsedLeft = await page.$eval('.main', el => getComputedStyle(el).marginLeft);
      expect(collapsedLeft).toBe('0px');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.app.sidebar-collapsed');
      await page.click('.sidebar-collapse-toggle');
      await page.waitForFunction(() => !document.querySelector('.app')?.classList.contains('sidebar-collapsed'));
      expect(await page.evaluate(() => localStorage.getItem('core-sidebar-collapsed'))).toBe('0');
    } finally {
      await page.close();
    }
  });

  it('opens plugin tab and keeps panel visible when viewport shrinks', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      await page.click('#comments-toggle');
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="comments"].active');
      await page.setViewportSize({ width: 280, height: 520 });
      await page.waitForFunction(() => {
        const panel = document.querySelector('.core-panel.open');
        if (!panel) return false;
        const r = panel.getBoundingClientRect();
        return r.left >= 8 && r.top >= 8 && r.right <= 272 && r.bottom <= 512;
      });
    } finally {
      await page.close();
    }
  }, 15000);

  it('persists panel size and position across refresh and reset clears storage', async () => {
    const page = await browser.newPage();
    try {
      await page.setViewportSize({ width: 1000, height: 700 });
      await gotoFixture(page, server.baseUrl, '/sample-chapter.md');
      await waitForCore(page);
      await page.evaluate(() => {
        localStorage.removeItem('core-panel-state');
        window.__core__.panel.addTab({ id: 'persist-panel', label: 'Persist', render: c => { c.textContent = 'persist'; } });
        window.__core__.panel.open('persist-panel');
      });
      await page.waitForSelector('.core-panel.open .core-panel-pane[data-tab-id="persist-panel"].active');

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
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('core-panel-state') || 'null'))).toBeObject();

      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForCore(page);
      await page.evaluate(() => {
        window.__core__.panel.addTab({ id: 'persist-panel', label: 'Persist', render: c => { c.textContent = 'persist'; } });
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
      expect(await page.evaluate(() => localStorage.getItem('core-panel-state'))).toBeNull();
    } finally {
      await page.close();
    }
  }, 15000);
});
