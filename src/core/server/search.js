import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { stripBOM, extractFrontmatter } from './markdown.js';

function extractTitle(fileName, content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fileName.replace(/\.md$/, '');
}

function normalizeQuery(query) {
  return String(query || '').trim();
}

export async function searchMarkdownFiles(rootDir, query, options = {}) {
  const normalized = normalizeQuery(query);
  const limit = Math.max(1, Number(options.limit) || 20);
  if (!normalized) return { query: normalized, results: [] };

  const needle = normalized.toLowerCase();
  const files = (await readdir(rootDir))
    .filter(file => file.endsWith('.md') && file !== 'AGENTS.md')
    .sort((a, b) => a.localeCompare(b));
  const results = [];

  for (const file of files) {
    const fullPath = path.join(rootDir, file);
    const rawContent = stripBOM(await readFile(fullPath, 'utf-8'));
    const frontmatter = extractFrontmatter(rawContent);
    const content = frontmatter.mdContent;
    const title = frontmatter.metadata?.title || extractTitle(file, content);
    const tags = frontmatter.metadata?.tags
      ? frontmatter.metadata.tags.split(',').map(tag => tag.trim()).filter(Boolean)
      : [];
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.toLowerCase().includes(needle)) continue;
      results.push({
        file,
        line: index + 1,
        title,
        snippet: line.trim(),
        tags,
      });
      if (results.length >= limit) {
        return { query: normalized, results };
      }
    }
  }

  return { query: normalized, results };
}
