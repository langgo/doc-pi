import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { stripBOM, extractFrontmatter, analyzeReadingStats } from './markdown.js';

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

async function discoverMarkdownFiles(rootDir, prefix = '') {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const children = await discoverMarkdownFiles(fullPath, prefix + entry.name + '/');
      files.push(...children);
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'AGENTS.md') {
      files.push({ file: prefix + entry.name, fullPath });
    }
  }
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

export async function searchMarkdownFiles(rootDir, query, options = {}) {
  const parsed = parseQuery(query);
  const normalized = parsed.normalized;
  const limit = Math.max(1, Number(options.limit) || 20);
  if (!normalized || !parsed.text) return { query: normalized, results: [] };

  const needle = parsed.text.toLowerCase();
  const files = await discoverMarkdownFiles(rootDir);
  const results = [];

  for (const { file, fullPath } of files) {
    const rawContent = stripBOM(await readFile(fullPath, 'utf-8'));
    const frontmatter = extractFrontmatter(rawContent);
    const content = frontmatter.mdContent;
    const title = frontmatter.metadata?.title || extractTitle(file, content);
    const tags = frontmatter.metadata?.tags
      ? frontmatter.metadata.tags.split(',').map(tag => tag.trim()).filter(Boolean)
      : [];
    const lowerTags = tags.map(tag => tag.toLowerCase());
    if (parsed.tags.length && !parsed.tags.every(tag => lowerTags.includes(tag))) continue;
    const readingStats = analyzeReadingStats(content);
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
        readingMinutes: readingStats.minutes,
        readingCount: readingStats.count,
      });
      if (results.length >= limit) {
        return { query: normalized, results };
      }
    }
  }

  return { query: normalized, results };
}
