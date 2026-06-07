import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { stripBOM, extractFrontmatter } from './markdown.js';

function extractTitle(fileName, content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fileName.replace(/\.md$/, '');
}

function parseQuery(query) {
  const normalized = String(query || '').trim();
  const tags = [];
  const terms = [];
  for (const token of normalized.split(/\s+/)) {
    if (!token) continue;
    if (token.toLowerCase().startsWith('tag:') && token.length > 4) {
      tags.push(token.slice(4).toLowerCase());
    } else {
      terms.push(token);
    }
  }
  return { normalized, text: terms.join(' '), tags };
}

export async function searchMarkdownFiles(rootDir, query, options = {}) {
  const parsed = parseQuery(query);
  const normalized = parsed.normalized;
  const limit = Math.max(1, Number(options.limit) || 20);
  if (!normalized || !parsed.text) return { query: normalized, results: [] };

  const needle = parsed.text.toLowerCase();
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
    const lowerTags = tags.map(tag => tag.toLowerCase());
    if (parsed.tags.length && !parsed.tags.every(tag => lowerTags.includes(tag))) continue;
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
