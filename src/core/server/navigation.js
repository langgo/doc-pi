import { readdir } from 'fs/promises';
import { ROOT_DIR } from './config.js';
import { escapeHtml } from './render.js';

// Auto-discover chapter files from filesystem (sorted by filename)
export async function getChapterFiles() {
  const files = await readdir(ROOT_DIR);
  return files
    .filter(f => /^\d{2}-.+\.md$/.test(f))
    .sort();
}

export function getChapterNav(currentFile, chapterFiles) {
  const idx = chapterFiles.indexOf(currentFile);
  if (idx === -1) return '';
  const prev = idx > 0 ? chapterFiles[idx - 1] : null;
  const next = idx < chapterFiles.length - 1 ? chapterFiles[idx + 1] : null;
  const parts = [];
  if (prev) {
    parts.push(`<a href="/${prev}" class="nav-prev">← ${escapeHtml(prev.replace(/\.md$/, ''))}</a>`);
  }
  if (next) {
    parts.push(`<a href="/${next}" class="nav-next">${escapeHtml(next.replace(/\.md$/, ''))} →</a>`);
  }
  if (!parts.length) return '';
  return `<div class="chapter-nav">${parts.join('')}</div>`;
}

export async function buildFileListToc() {
  const files = await readdir(ROOT_DIR);
  const mdFiles = files.filter(f => f.endsWith('.md') && f !== 'AGENTS.md' && f !== 'README.md');
  // Numbered chapters sorted by filename
  mdFiles.sort((a, b) => a.localeCompare(b));
  let html = '<ul>';
  for (const f of mdFiles) {
    const name = f.replace(/\.md$/, '');
    html += `<li><a href="/${f}" class="toc-h1">${escapeHtml(name)}</a></li>`;
  }
  html += '</ul>';
  return html;
}
