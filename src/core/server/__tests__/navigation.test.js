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
    it('should return sorted chapter files matching pattern', async () => {
      const files = await getChapterFiles(fixtureRoot);
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
      const html = await buildFileListToc(fixtureRoot);
      expect(html).toContain('<ul>');
      expect(html).toContain('toc-h1');
      // Should not include README.md or AGENTS.md
      expect(html).not.toContain('README');
      expect(html).not.toContain('AGENTS');
    });
  });
});
