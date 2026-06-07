import { describe, it, expect } from 'bun:test';
import { readFile } from 'fs/promises';

async function readProjectFile(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf-8');
}

async function loadPackageJson() {
  return JSON.parse(await readProjectFile('package.json'));
}

describe('package verification scripts', () => {
  it('package should expose the doc-pi CLI binary', async () => {
    const pkg = await loadPackageJson();
    expect(pkg.bin).toEqual({ 'doc-pi': './bin/doc-pi.js' });
    expect(pkg.type).toBe('module');
  });

  it('test script should include all server unit test directories', async () => {
    const pkg = await loadPackageJson();
    expect(pkg.scripts.test).toContain('src/core/server/__tests__/');
    expect(pkg.scripts.test).toContain('src/plugins/comments/server/__tests__/');
    expect(pkg.scripts.test).toContain('src/plugins/ai-qa/server/__tests__/');
  });

  it('test:all should invoke all maintained suite scripts', async () => {
    const pkg = await loadPackageJson();
    expect(pkg.scripts['test:all']).toContain('bun run test');
    expect(pkg.scripts['test:all']).toContain('bun run test:integration');
    expect(pkg.scripts['test:all']).toContain('bun run test:e2e');
    expect(pkg.scripts['test:all']).toContain('bun run test:self-check');
  });

  it('test:all server suites should avoid primary 3000-series ports', async () => {
    const integrationFiles = [
      'tests/integration/server.test.js',
      'tests/integration/comments-api.test.js',
      'tests/integration/ai-qa-api.test.js',
    ];
    for (const file of integrationFiles) {
      const source = await readProjectFile(file);
      expect(source).not.toMatch(/localhost:30\d{2}|PORT: '30\d{2}'/);
      expect(source).toMatch(/localhost:130\d{2}/);
      expect(source).toMatch(/PORT: '130\d{2}'/);
    }
  });
});

describe('core public module seams', () => {
  it('page should load split core modules in dependency order', async () => {
    const page = await readProjectFile('src/core/public/template/page.ejs');
    const expected = [
      '/core/public/core-state.js',
      '/core/public/dom-utils.js',
      '/core/public/sidebar-toc.js',
      '/core/public/mermaid-lightbox.js',
      '/core/public/settings-menu.js',
      '/core/public/selection-popup.js',
      '/core/public/floating-actions.js',
      '/core/public/panel.js',
      '/core/public/article-source.js',
      '/core/public/core-ready.js',
    ];
    let lastIndex = -1;
    for (const script of expected) {
      const index = page.indexOf(script);
      expect(index).toBeGreaterThan(lastIndex);
      lastIndex = index;
    }
    expect(page).not.toContain('/core/public/client.js');
  });

  it('core modules should expose namespaced APIs as their primary contract', async () => {
    const expectations = [
      ['src/core/public/selection-popup.js', 'core.selection.addAction'],
      ['src/core/public/selection-popup.js', 'core.selection.getContext'],
      ['src/core/public/floating-actions.js', 'core.floating.addButton'],
      ['src/core/public/floating-actions.js', 'core.floating.updateBadge'],
      ['src/core/public/panel.js', 'core.panel.addTab'],
      ['src/core/public/panel.js', 'core.panel.open'],
      ['src/core/public/article-source.js', 'core.article.locateText'],
      ['src/core/public/article-source.js', 'core.article.annotateText'],
      ['src/core/public/article-source.js', 'core.article.clearAnnotation'],
    ];

    for (const [file, symbol] of expectations) {
      const source = await readProjectFile(file);
      expect(source).toContain(symbol);
    }
  });

  it('panel should use the floating module instead of querying floating DOM', async () => {
    const source = await readProjectFile('src/core/public/panel.js');
    expect(source).toContain('core.floating.hide');
    expect(source).toContain('core.floating.show');
    expect(source).toContain('core.floating.placeAboveElement');
    expect(source).not.toContain("document.querySelector('.floating-actions");
  });

  it('core public modules should not expose legacy flat aliases', async () => {
    const files = [
      'src/core/public/core-state.js',
      'src/core/public/dom-utils.js',
      'src/core/public/selection-popup.js',
      'src/core/public/floating-actions.js',
      'src/core/public/panel.js',
      'src/core/public/article-source.js',
    ];
    const legacyAssignments = [
      'core.currentFile =',
      'core.escapeHtml =',
      'core.renderMarkdown =',
      'core.addSelectionAction =',
      'core.getSelectionContext =',
      'core.addFloatingButton =',
      'core.updateFloatingBadge =',
      'core.addPanelTab =',
      'core.openPanel =',
      'core.closePanel =',
      'core.togglePanel =',
      'core.locateArticleText =',
      'core.annotateArticleText =',
      'core.clearArticleAnnotation =',
    ];

    for (const file of files) {
      const source = await readProjectFile(file);
      for (const assignment of legacyAssignments) {
        expect(source).not.toContain(assignment);
      }
    }
  });

  it('plugin registers should consume namespaced core APIs', async () => {
    const files = [
      'src/plugins/comments/client/register.js',
      'src/plugins/ai-qa/client/register.js',
    ];

    for (const file of files) {
      const source = await readProjectFile(file);
      expect(source).toContain('core.selection.addAction');
      expect(source).toContain('core.floating.addButton');
      expect(source).toContain('core.panel.addTab');
      expect(source).toContain('core.panel.open');
      expect(source).toContain('core.article.locateText');
      expect(source).toContain('core.article.annotateText');
      expect(source).not.toContain('core.addSelectionAction');
      expect(source).not.toContain('core.addFloatingButton');
      expect(source).not.toContain('core.addPanelTab');
      expect(source).not.toContain('core.locateArticleText');
    }
  });
});

describe('plugin ownership seams', () => {
  it('comments should not implement article context or annotation internals', async () => {
    const source = await readProjectFile('src/plugins/comments/client/comment.js');
    expect(source).not.toContain('function getContext');
    expect(source).not.toContain('function highlightComment');
    expect(source).not.toContain("document.querySelector('.comment-highlight");
    expect(source).toContain('annotateSource');
    expect(source).toContain('clearSourceAnnotation');
  });

  it('plugin business files should receive required core bridge values instead of reading core directly', async () => {
    const files = [
      'src/plugins/comments/client/comment.js',
      'src/plugins/ai-qa/client/ai-qa.js',
    ];

    for (const file of files) {
      const source = await readProjectFile(file);
      expect(source).not.toContain('window.__core__');
      expect(source).not.toContain('function escapeHtml');
      expect(source).not.toContain("escapeHtml = function(str) { return String(str || ''); }");
      expect(source).toContain('options.currentFile');
      expect(source).toContain('options.escapeHtml');
      expect(source).toContain('throw new Error');
    }
  });
});

describe('plugin registration seams', () => {
  it('plugin registers should not poll for core readiness', async () => {
    const files = [
      'src/plugins/comments/client/register.js',
      'src/plugins/ai-qa/client/register.js',
    ];

    for (const file of files) {
      const source = await readProjectFile(file);
      expect(source).not.toContain('setTimeout(init');
    }
  });

  it('plugin registers should use the shared core readiness helper', async () => {
    const files = [
      'src/plugins/comments/client/register.js',
      'src/plugins/ai-qa/client/register.js',
    ];

    for (const file of files) {
      const source = await readProjectFile(file);
      expect(source).not.toContain('function whenCoreReady');
      expect(source).toContain('window.__coreWhenReady__');
    }
  });
});
