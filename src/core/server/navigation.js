import { readdir } from 'fs/promises';
import path from 'path';
import { getContentRoot } from './runtime-state.js';
import { escapeHtml } from './render.js';

// ── Recursive file discovery ────────────────────────────────────────────────

/**
 * Recursively discover markdown files and directories.
 * Returns a tree: [{ path, name, type: 'file'|'dir', children? }]
 * Sorted: README.md first, then localeCompare. Directories before files.
 */
export async function getChapterTree(rootDir = getContentRoot()) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      // Skip hidden dirs and common non-content dirs
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const children = await getChapterTree(fullPath);
      if (children.length > 0) {
        result.push({ path: entry.name + '/', name: entry.name, type: 'dir', children });
      }
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'AGENTS.md') {
      result.push({ path: entry.name, name: entry.name.replace(/\.md$/, ''), type: 'file' });
    }
  }

  result.sort((a, b) => {
    // README.md first
    if (a.path === 'README.md') return -1;
    if (b.path === 'README.md') return 1;
    // Directories before files
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

/**
 * Flatten a chapter tree into a sorted list of relative file paths.
 * Used for prev/next navigation and chapter position.
 */
export function flattenChapterTree(tree, prefix = '') {
  const result = [];
  for (const node of tree) {
    if (node.type === 'file') {
      result.push(prefix + node.path);
    } else if (node.type === 'dir') {
      result.push(...flattenChapterTree(node.children, prefix + node.path));
    }
  }
  return result;
}

// ── Legacy flat API (kept for backward compat) ──────────────────────────────

export async function getChapterFiles(rootDir = getContentRoot()) {
  return flattenChapterTree(await getChapterTree(rootDir));
}

export function getReadableChapterFiles(chapterFiles) {
  return chapterFiles.filter(function (file) { return file !== 'README.md'; });
}

// ── Chapter position ────────────────────────────────────────────────────────

export function getChapterPosition(currentFile, chapterFiles, className = 'chapter-position') {
  const readableFiles = getReadableChapterFiles(chapterFiles);
  const idx = readableFiles.indexOf(currentFile);
  if (idx === -1) return '';
  const currentChapter = idx + 1;
  const totalChapters = readableFiles.length;
  return `<div class="${className}" aria-label="当前第 ${currentChapter} 章，共 ${totalChapters} 章">第 ${currentChapter} / ${totalChapters} 章</div>`;
}

// ── Chapter navigation (prev/next) ──────────────────────────────────────────

export function getChapterNav(currentFile, chapterFiles, options = {}) {
  const idx = chapterFiles.indexOf(currentFile);
  if (idx === -1) return '';
  const prev = idx > 0 ? chapterFiles[idx - 1] : null;
  const next = idx < chapterFiles.length - 1 ? chapterFiles[idx + 1] : null;
  const parts = [];
  const withLabels = options.withLabels === true;
  if (prev) {
    const prevName = escapeHtml(prev.replace(/\.md$/, ''));
    const aria = withLabels ? ` aria-label="上一章 ${prevName}，快捷键 ["` : ` aria-label="上一章 ${prevName}"`;
    parts.push(`<a href="/${prev}" class="nav-prev"${aria}>← ${withLabels ? '<span>上一章</span> ' + prevName : prevName}</a>`);
  } else if (withLabels) {
    parts.push('<span class="nav-prev nav-disabled" aria-disabled="true"><span>上一章</span> 已是第一章</span>');
  }
  if (next) {
    const nextName = escapeHtml(next.replace(/\.md$/, ''));
    const aria = withLabels ? ` aria-label="下一章 ${nextName}，快捷键 ]"` : ` aria-label="下一章 ${nextName}"`;
    parts.push(`<a href="/${next}" class="nav-next"${aria}>${withLabels ? '<span>下一章</span> ' + nextName : nextName} →</a>`);
  } else if (withLabels) {
    parts.push('<span class="nav-next nav-disabled" aria-disabled="true"><span>下一章</span> 已是最后一章</span>');
  }
  if (!parts.length) return '';
  if (withLabels) {
    const currentChapter = idx + 1;
    const totalChapters = chapterFiles.length;
    parts.splice(1, 0, `<span class="chapter-nav-position" aria-label="当前第 ${currentChapter} 章，共 ${totalChapters} 章">第 ${currentChapter} / ${totalChapters} 章</span>`);
  }
  const className = options.position === 'bottom' ? 'chapter-nav chapter-nav-bottom' : 'chapter-nav';
  const aria = options.position === 'bottom' ? ' aria-label="章节导航"' : '';
  return `<nav class="${className}"${aria}>${parts.join('')}</nav>`;
}

// ── Tree-based TOC ──────────────────────────────────────────────────────────

function buildTocTreeHtml(nodes, currentFile, prefix = '', depth = 0) {
  if (!nodes || nodes.length === 0) return '';
  let html = '<ul>';
  for (const node of nodes) {
    const fullPath = prefix + node.path;
    if (node.type === 'dir') {
      const childrenHtml = buildTocTreeHtml(node.children, currentFile, fullPath, depth + 1);
      const isExpanded = currentFile.startsWith(fullPath);
      html += `<li class="toc-dir${isExpanded ? ' toc-dir-expanded' : ''}">`;
      html += `<span class="toc-dir-toggle" role="button" tabindex="0" aria-expanded="${isExpanded}">${escapeHtml(node.name)}</span>`;
      html += childrenHtml;
      html += '</li>';
    } else {
      const activeClass = fullPath === currentFile ? ' toc-current chapter-active' : '';
      html += `<li><a href="/${fullPath}" class="toc-h1${activeClass}"><span class="toc-chapter-title">${escapeHtml(node.name)}</span></a></li>`;
    }
  }
  html += '</ul>';
  return html;
}

export async function buildFileListToc(rootDir = getContentRoot(), currentFile = '') {
  const tree = await getChapterTree(rootDir);
  // Filter out README.md from TOC (it's the index page)
  const filtered = tree.filter(n => n.path !== 'README.md');
  return buildTocTreeHtml(filtered, currentFile);
}
