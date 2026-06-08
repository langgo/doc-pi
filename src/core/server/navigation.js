import { readdir } from 'fs/promises';
import { getContentRoot } from './runtime-state.js';
import { escapeHtml } from './render.js';

// Auto-discover chapter files from filesystem (sorted by filename)
export async function getChapterFiles(rootDir = getContentRoot()) {
  const files = await readdir(rootDir);
  return files
    .filter(f => f.endsWith('.md') && f !== 'AGENTS.md')
    .sort((a, b) => {
      if (a === 'README.md') return -1;
      if (b === 'README.md') return 1;
      return a.localeCompare(b);
    });
}

export function getReadableChapterFiles(chapterFiles) {
  return chapterFiles.filter(function (file) { return file !== 'README.md'; });
}

export function getChapterPosition(currentFile, chapterFiles, className = 'chapter-position') {
  const readableFiles = getReadableChapterFiles(chapterFiles);
  const idx = readableFiles.indexOf(currentFile);
  if (idx === -1) return '';
  const currentChapter = idx + 1;
  const totalChapters = readableFiles.length;
  return `<div class="${className}" aria-label="当前第 ${currentChapter} 章，共 ${totalChapters} 章">第 ${currentChapter} / ${totalChapters} 章</div>`;
}

export function getChapterNav(currentFile, chapterFiles, options = {}) {
  const idx = chapterFiles.indexOf(currentFile);
  if (idx === -1) return '';
  const prev = idx > 0 ? chapterFiles[idx - 1] : null;
  const next = idx < chapterFiles.length - 1 ? chapterFiles[idx + 1] : null;
  const parts = [];
  const withLabels = options.withLabels === true;
  if (prev) {
    const prevName = escapeHtml(prev.replace(/\.md$/, ''));
    const hint = withLabels ? '<em>快捷键 [</em>' : '';
    const aria = withLabels ? ` aria-label="上一章 ${prevName}，快捷键 ["` : ` aria-label="上一章 ${prevName}"`;
    parts.push(`<a href="/${prev}" class="nav-prev"${aria}>← ${withLabels ? '<span>上一章</span><strong>' + prevName + '</strong>' + hint : prevName}</a>`);
  } else if (withLabels) {
    parts.push('<span class="nav-prev nav-disabled" aria-disabled="true"><span>上一章</span><strong>已是第一章</strong><em>快捷键 [</em></span>');
  }
  if (next) {
    const nextName = escapeHtml(next.replace(/\.md$/, ''));
    const hint = withLabels ? '<em>快捷键 ]</em>' : '';
    const aria = withLabels ? ` aria-label="下一章 ${nextName}，快捷键 ]"` : ` aria-label="下一章 ${nextName}"`;
    parts.push(`<a href="/${next}" class="nav-next"${aria}>${withLabels ? '<span>下一章</span><strong>' + nextName + '</strong>' + hint : nextName} →</a>`);
  } else if (withLabels) {
    parts.push('<span class="nav-next nav-disabled" aria-disabled="true"><span>下一章</span><strong>已是最后一章</strong><em>快捷键 ]</em></span>');
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

export async function buildFileListToc(rootDir = getContentRoot(), currentFile = '') {
  const files = await readdir(rootDir);
  const mdFiles = files.filter(f => f.endsWith('.md') && f !== 'AGENTS.md' && f !== 'README.md');
  // Numbered chapters sorted by filename
  mdFiles.sort((a, b) => a.localeCompare(b));
  let html = '<ul>';
  for (let i = 0; i < mdFiles.length; i += 1) {
    const f = mdFiles[i];
    const name = f.replace(/\.md$/, '');
    const activeClass = f === currentFile ? ' toc-current chapter-active' : '';
    const position = f === currentFile ? `<span class="toc-chapter-position" aria-label="当前第 ${i + 1} 章，共 ${mdFiles.length} 章">${i + 1}/${mdFiles.length}</span>` : '';
    html += `<li><a href="/${f}" class="toc-h1${activeClass}"><span class="toc-chapter-title">${escapeHtml(name)}</span>${position}</a></li>`;
  }
  html += '</ul>';
  return html;
}
