import { describe, it, expect } from 'bun:test';
import { stripBOM, slugify, extractToc, buildTocHtml, processMarkdown } from '../markdown.js';
import path from 'path';
import { ROOT_DIR } from '../config.js';

describe('markdown', () => {
  describe('stripBOM', () => {
    it('should strip UTF-8 BOM', () => {
      const content = '\uFEFF# Hello';
      expect(stripBOM(content)).toBe('# Hello');
    });

    it('should return unchanged string without BOM', () => {
      expect(stripBOM('# Hello')).toBe('# Hello');
    });

    it('should handle empty string', () => {
      expect(stripBOM('')).toBe('');
    });
  });

  describe('slugify', () => {
    it('should convert text to URL-safe slug', () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    it('should strip HTML tags', () => {
      expect(slugify('<b>Bold</b> Text')).toBe('bold-text');
    });

    it('should handle Chinese characters', () => {
      expect(slugify('概述 介绍')).toBe('概述-介绍');
    });

    it('should remove special characters', () => {
      expect(slugify('hello!@#world')).toBe('helloworld');
    });

    it('should truncate to 60 chars', () => {
      const long = 'a'.repeat(100);
      expect(slugify(long).length).toBeLessThanOrEqual(60);
    });
  });

  describe('extractToc', () => {
    it('should extract headings from markdown', () => {
      const md = '# H1\nSome text\n## H2\nMore text\n### H3';
      const headings = extractToc(md);
      expect(headings).toHaveLength(3);
      expect(headings[0]).toEqual({ level: 1, text: 'H1' });
      expect(headings[1]).toEqual({ level: 2, text: 'H2' });
      expect(headings[2]).toEqual({ level: 3, text: 'H3' });
    });

    it('should skip headings inside code blocks', () => {
      const md = '# Real H1\n```\n# Not a heading\n```\n## Real H2';
      const headings = extractToc(md);
      expect(headings).toHaveLength(2);
      expect(headings[0].text).toBe('Real H1');
      expect(headings[1].text).toBe('Real H2');
    });

    it('should strip markdown formatting from heading text', () => {
      const md = '## **Bold** and `code`';
      const headings = extractToc(md);
      expect(headings[0].text).toBe('Bold and code');
    });

    it('should return empty array for no headings', () => {
      expect(extractToc('Just text')).toEqual([]);
    });
  });

  describe('buildTocHtml', () => {
    it('should build HTML from headings', () => {
      const headings = [
        { level: 1, text: 'Chapter 1' },
        { level: 2, text: 'Section 1.1' },
      ];
      const html = buildTocHtml(headings, 'test.md');
      expect(html).toContain('<ul>');
      expect(html).toContain('toc-h1');
      expect(html).toContain('toc-h2');
      expect(html).toContain('href="/test.md#chapter-1"');
      expect(html).toContain('href="/test.md#section-11"');
    });

    it('should return empty string for empty headings', () => {
      expect(buildTocHtml([], 'test.md')).toBe('');
    });
  });

  describe('processMarkdown', () => {
    it('should render a real markdown file', async () => {
      const filePath = path.join(ROOT_DIR, 'README.md');
      const html = await processMarkdown(filePath);
      expect(typeof html).toBe('string');
      expect(html.length).toBeGreaterThan(0);
      // Should contain heading with id
      expect(html).toContain('<h');
    });

    it('should render markdown footnotes with backlinks', async () => {
      const fs = await import('fs/promises');
      const tmpPath = path.join(ROOT_DIR, 'data', 'test-footnotes.md');
      await fs.mkdir(path.join(ROOT_DIR, 'data'), { recursive: true });
      await fs.writeFile(tmpPath, 'Text with note.[^1]\n\n[^1]: Footnote content.\n');
      try {
        const html = await processMarkdown(tmpPath);
        expect(html).toContain('class="footnote-ref"');
        expect(html).toContain('id="fnref-1"');
        expect(html).toContain('href="#fn-1"');
        expect(html).toContain('<section class="footnotes">');
        expect(html).toContain('id="fn-1"');
        expect(html).toContain('Footnote content.');
        expect(html).toContain('class="footnote-backref"');
        expect(html).toContain('href="#fnref-1"');
      } finally {
        await fs.unlink(tmpPath);
      }
    });

    it('should secure external links without changing local or hash links', async () => {
      const fs = await import('fs/promises');
      const tmpPath = path.join(ROOT_DIR, 'data', 'test-link-safety.md');
      await fs.mkdir(path.join(ROOT_DIR, 'data'), { recursive: true });
      await fs.writeFile(tmpPath, '[External](https://example.com)\n[Local](/sample-chapter.md)\n[Hash](#section)\n[Mail](mailto:test@example.com)\n[Bad](javascript:alert(1))\n');
      try {
        const html = await processMarkdown(tmpPath);
        expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">External</a>');
        expect(html).toContain('<a href="/sample-chapter.md">Local</a>');
        expect(html).toContain('<a href="#section">Hash</a>');
        expect(html).toContain('<a href="mailto:test@example.com">Mail</a>');
        expect(html).not.toContain('javascript:alert');
      } finally {
        await fs.unlink(tmpPath);
      }
    });

    it('should render heading self-links for copyable anchors', async () => {
      const fs = await import('fs/promises');
      const tmpPath = path.join(ROOT_DIR, 'data', 'test-heading-anchor.md');
      await fs.mkdir(path.join(ROOT_DIR, 'data'), { recursive: true });
      await fs.writeFile(tmpPath, '# Copy Link\n\n## Deep Section\n');
      try {
        const html = await processMarkdown(tmpPath);
        expect(html).toContain('<h1 id="copy-link">');
        expect(html).toContain('class="heading-anchor"');
        expect(html).toContain('href="#copy-link"');
        expect(html).toContain('aria-label="Copy link to Copy Link"');
      } finally {
        await fs.unlink(tmpPath);
      }
    });

    it('should handle mermaid blocks', async () => {
      // Create a temp markdown file with mermaid
      const fs = await import('fs/promises');
      const tmpPath = path.join(ROOT_DIR, 'data', 'test-mermaid.md');
      await fs.mkdir(path.join(ROOT_DIR, 'data'), { recursive: true });
      await fs.writeFile(tmpPath, '# Test\n\n```mermaid\ngraph TD\nA-->B\n```\n');
      try {
        const html = await processMarkdown(tmpPath);
        expect(html).toContain('mermaid');
      } finally {
        await fs.unlink(tmpPath);
      }
    });
  });
});
