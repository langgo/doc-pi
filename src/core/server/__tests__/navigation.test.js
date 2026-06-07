import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { getChapterFiles, getChapterNav, buildFileListToc } from '../navigation.js';

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
  });
});
