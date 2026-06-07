import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { searchMarkdownFiles } from '../search.js';

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-search-'));
});

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe('searchMarkdownFiles', () => {
  it('returns frontmatter tags with search results', async () => {
    await writeFile(path.join(tmpRoot, 'tagged.md'), '---\ntitle: Tagged Doc\ntags: docs, guide\n---\n# Tagged\nSearchable topic.\n', 'utf-8');
    await writeFile(path.join(tmpRoot, 'plain.md'), '# Plain\nSearchable topic.\n', 'utf-8');

    const result = await searchMarkdownFiles(tmpRoot, 'searchable');

    const tagged = result.results.find(item => item.file === 'tagged.md');
    const plain = result.results.find(item => item.file === 'plain.md');
    expect(tagged.tags).toEqual(['docs', 'guide']);
    expect(plain.tags).toEqual([]);
  });

  it('returns line-level snippets for case-insensitive markdown matches', async () => {
    await writeFile(path.join(tmpRoot, 'README.md'), '# Home\nWelcome to Doc Pi\n', 'utf-8');
    await writeFile(path.join(tmpRoot, '01-intro.md'), '# Intro\nThis chapter explains Mermaid diagrams.\n', 'utf-8');
    await writeFile(path.join(tmpRoot, 'notes.txt'), 'Mermaid outside markdown', 'utf-8');

    const result = await searchMarkdownFiles(tmpRoot, 'mermaid');

    expect(result.query).toBe('mermaid');
    expect(result.results).toEqual([
      {
        file: '01-intro.md',
        line: 2,
        title: 'Intro',
        snippet: 'This chapter explains Mermaid diagrams.',
        tags: [],
      },
    ]);
  });

  it('limits noisy queries and ignores empty input', async () => {
    await writeFile(path.join(tmpRoot, '01-many.md'), '# Many\nmatch\nmatch\nmatch\n', 'utf-8');

    expect((await searchMarkdownFiles(tmpRoot, '   ')).results).toEqual([]);
    expect((await searchMarkdownFiles(tmpRoot, 'match', { limit: 2 })).results).toHaveLength(2);
  });
});
