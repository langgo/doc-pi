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
      },
    ]);
  });

  it('limits noisy queries and ignores empty input', async () => {
    await writeFile(path.join(tmpRoot, '01-many.md'), '# Many\nmatch\nmatch\nmatch\n', 'utf-8');

    expect((await searchMarkdownFiles(tmpRoot, '   ')).results).toEqual([]);
    expect((await searchMarkdownFiles(tmpRoot, 'match', { limit: 2 })).results).toHaveLength(2);
  });
});
