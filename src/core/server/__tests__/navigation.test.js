import { describe, it, expect } from 'bun:test';
import { getChapterFiles, getChapterNav, buildFileListToc } from '../navigation.js';

describe('navigation', () => {
  describe('getChapterFiles', () => {
    it('should return sorted chapter files matching pattern', async () => {
      const files = await getChapterFiles();
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);
      // All should match NN-xxx.md pattern
      for (const f of files) {
        expect(f).toMatch(/^\d{2}-.+\.md$/);
      }
      // Should be sorted
      for (let i = 1; i < files.length; i++) {
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

    it('should return empty string for single chapter', () => {
      expect(getChapterNav('01-概述.md', ['01-概述.md'])).toBe('');
    });
  });

  describe('buildFileListToc', () => {
    it('should build HTML list of chapter files', async () => {
      const html = await buildFileListToc();
      expect(html).toContain('<ul>');
      expect(html).toContain('toc-h1');
      // Should not include README.md or AGENTS.md
      expect(html).not.toContain('README');
      expect(html).not.toContain('AGENTS');
    });
  });
});
