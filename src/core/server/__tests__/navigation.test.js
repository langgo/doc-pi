import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { getChapterFiles, getChapterNav, getChapterPosition, buildFileListToc, getChapterTree, flattenChapterTree } from '../navigation.js';

let fixtureRoot;

beforeAll(async () => {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-nav-'));
  await writeFile(path.join(fixtureRoot, '02-B.md'), '# B\n');
  await writeFile(path.join(fixtureRoot, '01-A.md'), '# A\n');
  await writeFile(path.join(fixtureRoot, 'README.md'), '# Readme\n');
});

afterAll(async () => {
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
});

describe('navigation', () => {
  describe('getChapterFiles', () => {
    it('should return README first followed by sorted markdown chapters', async () => {
      const files = await getChapterFiles(fixtureRoot);
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);
      expect(files[0]).toBe('README.md');
      for (const f of files.slice(1)) {
        expect(f.endsWith('.md')).toBe(true);
        expect(f).not.toBe('AGENTS.md');
      }
      for (let i = 2; i < files.length; i++) {
        expect(files[i] > files[i - 1]).toBe(true);
      }
    });
  });

  describe('getChapterNav', () => {
    const chapters = ['01-概述.md', '02-核心概念.md', '03-使用指南.md'];

    it('should return empty string when file not in list', () => {
      expect(getChapterNav('unknown.md', chapters)).toBe('');
    });

    it('should return only next link for first chapter', () => {
      const nav = getChapterNav('01-概述.md', chapters);
      expect(nav).toContain('nav-next');
      expect(nav).not.toContain('nav-prev');
      expect(nav).toContain('02-核心概念');
    });

    it('should return only prev link for last chapter', () => {
      const nav = getChapterNav('03-使用指南.md', chapters);
      expect(nav).toContain('nav-prev');
      expect(nav).not.toContain('nav-next');
      expect(nav).toContain('02-核心概念');
    });

    it('should return both links for middle chapter', () => {
      const nav = getChapterNav('02-核心概念.md', chapters);
      expect(nav).toContain('nav-prev');
      expect(nav).toContain('nav-next');
    });

    it('should label compact chapter links for assistive technology', () => {
      const nav = getChapterNav('02-核心概念.md', chapters);
      expect(nav).toContain('aria-label="上一章 01-概述"');
      expect(nav).toContain('aria-label="下一章 03-使用指南"');
    });

    it('should return empty string for single chapter', () => {
      expect(getChapterNav('01-概述.md', ['01-概述.md'])).toBe('');
    });

    it('should show disabled edge states in bottom navigation', () => {
      const firstNav = getChapterNav('01-概述.md', chapters, { position: 'bottom', withLabels: true });
      const lastNav = getChapterNav('03-使用指南.md', chapters, { position: 'bottom', withLabels: true });
      expect(firstNav).toContain('class="nav-prev nav-disabled"');
      expect(firstNav).toContain('aria-disabled="true"');
      expect(firstNav).toContain('已是第一章');
      expect(lastNav).toContain('class="nav-next nav-disabled"');
      expect(lastNav).toContain('aria-disabled="true"');
      expect(lastNav).toContain('已是最后一章');
    });

    it('should show chapter position in bottom navigation', () => {
      const nav = getChapterNav('02-核心概念.md', chapters, { position: 'bottom', withLabels: true });
      expect(nav).toContain('class="chapter-nav-position"');
      expect(nav).toContain('aria-label="当前第 2 章，共 3 章"');
      expect(nav).toContain('第 2 / 3 章');
    });

    it('should exclude README from reader chapter positions', () => {
      const chapters = ['README.md', '01-概述.md', '02-核心概念.md'];
      expect(getChapterPosition('02-核心概念.md', chapters)).toContain('第 2 / 2 章');
      expect(getChapterPosition('02-核心概念.md', chapters)).toContain('aria-label="当前第 2 章，共 2 章"');
    });
  });

  describe('buildFileListToc', () => {
    it('should build HTML list of chapter files', async () => {
      const html = await buildFileListToc(fixtureRoot);
      expect(html).toContain('<ul>');
      expect(html).toContain('toc-h1');
      // Should not include README.md or AGENTS.md
      expect(html).not.toContain('README');
      expect(html).not.toContain('AGENTS');
    });

    it('should mark the current chapter as active', async () => {
      const html = await buildFileListToc(fixtureRoot, '02-B.md');
      expect(html).toContain('toc-current');
      expect(html).toContain('chapter-active');
      expect(html).toContain('02-B');
    });
  });

  describe('nested directories', () => {
    let nestedRoot;

    beforeAll(async () => {
      nestedRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-nav-nested-'));
      await mkdir(path.join(nestedRoot, 'chapter-01'));
      await mkdir(path.join(nestedRoot, 'chapter-02'));
      await writeFile(path.join(nestedRoot, 'README.md'), '# Root\n');
      await writeFile(path.join(nestedRoot, 'chapter-01', 'intro.md'), '# Intro\n');
      await writeFile(path.join(nestedRoot, 'chapter-01', 'setup.md'), '# Setup\n');
      await writeFile(path.join(nestedRoot, 'chapter-02', 'advanced.md'), '# Advanced\n');
    });

    afterAll(async () => {
      if (nestedRoot) await rm(nestedRoot, { recursive: true, force: true });
    });

    it('should discover files recursively with getChapterTree', async () => {
      const tree = await getChapterTree(nestedRoot);
      expect(tree.length).toBe(3); // README.md + 2 dirs
      expect(tree[0].path).toBe('README.md');
      expect(tree[0].type).toBe('file');
      expect(tree[1].path).toBe('chapter-01/');
      expect(tree[1].type).toBe('dir');
      expect(tree[1].children.length).toBe(2);
      expect(tree[1].children[0].path).toBe('intro.md');
      expect(tree[1].children[1].path).toBe('setup.md');
      expect(tree[2].path).toBe('chapter-02/');
      expect(tree[2].type).toBe('dir');
      expect(tree[2].children.length).toBe(1);
      expect(tree[2].children[0].path).toBe('advanced.md');
    });

    it('should flatten tree to sorted file paths', async () => {
      const tree = await getChapterTree(nestedRoot);
      const flat = flattenChapterTree(tree);
      expect(flat).toEqual([
        'README.md',
        'chapter-01/intro.md',
        'chapter-01/setup.md',
        'chapter-02/advanced.md',
      ]);
    });

    it('should return flat file list from getChapterFiles', async () => {
      const files = await getChapterFiles(nestedRoot);
      expect(files[0]).toBe('README.md');
      expect(files).toContain('chapter-01/intro.md');
      expect(files).toContain('chapter-01/setup.md');
      expect(files).toContain('chapter-02/advanced.md');
    });

    it('should build tree TOC with directory nodes', async () => {
      const html = await buildFileListToc(nestedRoot);
      expect(html).toContain('toc-dir');
      expect(html).toContain('toc-dir-toggle');
      expect(html).toContain('chapter-01');
      expect(html).toContain('chapter-02');
      expect(html).toContain('href="/chapter-01/intro.md"');
      expect(html).toContain('href="/chapter-01/setup.md"');
      expect(html).toContain('href="/chapter-02/advanced.md"');
      // Should not include README.md in TOC
      expect(html).not.toContain('README');
    });

    it('should expand directory containing current file', async () => {
      const html = await buildFileListToc(nestedRoot, 'chapter-01/intro.md');
      expect(html).toContain('toc-dir-expanded');
      expect(html).toContain('aria-expanded="true"');
    });

    it('should support prev/next navigation across directories', () => {
      const chapters = [
        'README.md',
        'chapter-01/intro.md',
        'chapter-01/setup.md',
        'chapter-02/advanced.md',
      ];
      const nav = getChapterNav('chapter-01/intro.md', chapters);
      expect(nav).toContain('href="/README.md"');
      expect(nav).toContain('href="/chapter-01/setup.md"');
    });
  });
});
