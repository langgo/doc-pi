import { readFile } from 'fs/promises';
import katex from 'katex';
import { marked } from './config.js';
import { escapeHtml } from './render.js';

// Strip UTF-8 BOM if present
export function stripBOM(content) {
  if (content.charCodeAt(0) === 0xFEFF) {
    return content.slice(1);
  }
  return content;
}

// Generate a URL-safe slug from heading text
export function slugify(text) {
  return text
    .replace(/<[^>]*>/g, '')  // strip HTML tags
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 60);
}

// Extract headings from markdown for TOC
export function extractToc(mdContent) {
  const lines = mdContent.split('\n');
  const headings = [];
  let inCodeBlock = false;
  for (const line of lines) {
    // Track code fences: skip headings inside code blocks
    if (/^```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const m = line.match(/^(#{1,4})\s+(.+)$/);
    if (m) {
      const level = m[1].length;
      let text = m[2].trim();
      // Remove markdown formatting
      text = text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/`/g, '');
      headings.push({ level, text });
    }
  }
  return headings;
}

export function buildTocHtml(headings, currentFile) {
  if (!headings.length) return '';
  let html = '<ul>';
  for (const h of headings) {
    const cls = `toc-h${h.level}`;
    const anchor = slugify(h.text);
    html += `<li><a href="/${currentFile}#${anchor}" class="${cls}">${escapeHtml(h.text)}</a></li>`;
  }
  html += '</ul>';
  return html;
}

export function extractFrontmatter(mdContent) {
  if (!mdContent.startsWith('---\n')) return { mdContent, metadata: null };
  const end = mdContent.indexOf('\n---', 4);
  if (end === -1) return { mdContent, metadata: null };
  const raw = mdContent.slice(4, end).trim();
  const metadata = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) metadata[key] = value;
  }
  return { mdContent: mdContent.slice(end + 4).replace(/^\n+/, ''), metadata };
}

function estimateReadingMinutes(mdContent) {
  const text = mdContent
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#>*_`\[\]()|:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 1;
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const wordCount = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return Math.max(1, Math.ceil((cjkCount + wordCount) / 220));
}

function renderReadingTime(minutes) {
  return '<div class="reading-time" aria-label="预计阅读时间 ' + minutes + ' 分钟">约 ' + minutes + ' 分钟阅读</div>';
}

function renderFrontmatterMetadata(metadata) {
  if (!metadata || (!metadata.title && !metadata.description && !metadata.tags)) return '';
  let html = '<section class="frontmatter-metadata" aria-label="文档元数据">';
  if (metadata.title) html += '<div class="frontmatter-title">' + escapeHtml(metadata.title) + '</div>';
  if (metadata.description) html += '<div class="frontmatter-description">' + escapeHtml(metadata.description) + '</div>';
  if (metadata.tags) {
    html += '<div class="frontmatter-tags">';
    for (const tag of metadata.tags.split(',')) {
      const trimmed = tag.trim();
      if (trimmed) html += '<span class="frontmatter-tag">' + escapeHtml(trimmed) + '</span>';
    }
    html += '</div>';
  }
  html += '</section>';
  return html;
}

function extractFootnotes(mdContent) {
  const footnotes = [];
  const withoutDefinitions = mdContent.replace(/^\[\^([^\]]+)\]:\s+(.+)$/gm, (_, id, content) => {
    footnotes.push({ id: id.trim(), content: content.trim() });
    return '';
  });
  return { mdContent: withoutDefinitions, footnotes };
}

function renderFootnoteRefs(html, footnotes) {
  if (!footnotes.length) return html;
  const known = new Set(footnotes.map(footnote => footnote.id));
  return html.replace(/\[\^([^\]]+)\]/g, (match, id) => {
    const safeId = slugify(id);
    if (!known.has(id)) return match;
    return '<sup><a class="footnote-ref" id="fnref-' + safeId + '" href="#fn-' + safeId + '">' + escapeHtml(id) + '</a></sup>';
  });
}

function appendFootnotes(html, footnotes) {
  if (!footnotes.length) return html;
  let list = '<section class="footnotes"><hr><ol>';
  for (const footnote of footnotes) {
    const safeId = slugify(footnote.id);
    const content = secureExternalLinks(marked(footnote.content).trim());
    list += '<li id="fn-' + safeId + '">' + content + ' <a class="footnote-backref" href="#fnref-' + safeId + '" aria-label="返回脚注引用">↩</a></li>';
  }
  list += '</ol></section>';
  return html + list;
}

function secureExternalLinks(html) {
  return html.replace(/<a\b([^>]*)>/gi, (match, attrs) => {
    const hrefMatch = attrs.match(/\s+href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (!hrefMatch) return match;
    const href = hrefMatch[2] || hrefMatch[3] || hrefMatch[4] || '';
    if (!/^https?:\/\//i.test(href)) return match;
    let nextAttrs = attrs
      .replace(/\s+target\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '')
      .replace(/\s+rel\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '');
    return '<a' + nextAttrs + ' target="_blank" rel="noopener noreferrer">';
  });
}

// Process markdown content: protect mermaid/math blocks, render with marked, restore
export async function processMarkdown(filePath) {
  let mdContent = await readFile(filePath, 'utf-8');
  mdContent = stripBOM(mdContent);

  const frontmatterResult = extractFrontmatter(mdContent);
  mdContent = frontmatterResult.mdContent;
  const metadata = frontmatterResult.metadata;

  const footnoteResult = extractFootnotes(mdContent);
  mdContent = footnoteResult.mdContent;
  const footnotes = footnoteResult.footnotes;
  const readingMinutes = estimateReadingMinutes(mdContent);

  // Replace mermaid blocks with placeholders before marked processing
  const mermaidBlocks = [];
  mdContent = mdContent.replace(/\`\`\`mermaid\n([\s\S]*?)\n\`\`\`/g, (_, code) => {
    const idx = mermaidBlocks.length;
    mermaidBlocks.push(code);
    return `<!--MERMAID_${idx}-->`;
  });

  // Protect math blocks ($$...$$) from marked processing
  const mathBlocks = [];
  const lines = mdContent.split('\n');
  let inMath = false;
  let current = [];
  let newLines = [];
  for (const line of lines) {
    if (line.trim() === '$$') {
      if (inMath) {
        const idx = mathBlocks.length;
        const code = current.join(' ');
        const cleaned = code
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
          .replace(/[\t\f\r]/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim();
        mathBlocks.push(cleaned);
        newLines.push(`<!--MATH_${idx}-->`);
        current = [];
      }
      inMath = !inMath;
    } else {
      if (inMath) {
        current.push(line);
      } else {
        newLines.push(line);
      }
    }
  }
  mdContent = newLines.join('\n');

  // Convert inline $...$ to placeholders before marked processing
  const inlineMathBlocks = [];
  mdContent = mdContent.replace(/\$\s*([^$]+?)\s*\$/g, (_, code) => {
    const idx = inlineMathBlocks.length;
    const cleaned = code
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/[\t\f\r]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    inlineMathBlocks.push(cleaned);
    return `<!--INLINE_MATH_${idx}-->`;
  });

  // Fix marked.js bug: ** directly adjacent to Chinese char fails when content has parens
  // Replace **...(...)...** with <strong>...</strong> before marked processing
  mdContent = mdContent.replace(/\*\*([^*]+?)\*\*/g, (match, content) => {
    if (/[（(].*[）)]/.test(content)) {
      return '<strong>' + content + '</strong>';
    }
    return match;
  });

  // Process markdown
  let html = marked(mdContent);
  html = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<([a-z][\w:-]*)([^>]*)>/gi, (match, tag, attrs) => {
      const safeAttrs = attrs
        .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\s+href\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi, '')
        .replace(/\s+src\s*=\s*("\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]+)/gi, '');
      return '<' + tag + safeAttrs + '>';
    });

  html = renderReadingTime(readingMinutes) + renderFrontmatterMetadata(metadata) + html;
  html = secureExternalLinks(html);

  // Add id attributes and self-links to headings for TOC anchor navigation.
  html = html.replace(/<(h[1-4])>(.*?)<\/\1>/g, (match, tag, text) => {
    const id = slugify(text);
    const plainText = text.replace(/<[^>]*>/g, '').trim();
    const anchor = '<a class="heading-anchor" href="#' + id + '" aria-label="Copy link to ' + escapeHtml(plainText) + '">#</a>';
    return '<' + tag + ' id="' + id + '">' + text + anchor + '</' + tag + '>';
  });

  html = html
    .replace(/<li>(\s*<input[^>]*type="checkbox"[^>]*>)/g, '<li class="task-list-item">$1')
    .replace(/<ul>\s*(<li class="task-list-item">)/g, '<ul class="task-list">$1');

  let sourceLine = 0;
  let inSourceFence = false;
  for (const line of mdContent.split(/\r?\n/)) {
    sourceLine += 1;
    const rawText = line.trim();
    if (/^```/.test(rawText)) {
      inSourceFence = !inSourceFence;
      continue;
    }
    if (inSourceFence || !rawText || /^#{1,6}\s+/.test(rawText) || /^[-*+]\s+/.test(rawText)) continue;
    const text = rawText.replace(/^>\s+/, '');
    const renderedText = escapeHtml(text).replace(/\*\*/g, '').replace(/`/g, '');
    html = html.replace(renderedText, '<span id="L' + sourceLine + '" class="doc-search-line-target" aria-label="搜索结果第 ' + sourceLine + ' 行" tabindex="-1"></span>' + renderedText);
  }

  // Restore mermaid blocks as plain divs for mermaid.js
  html = html.replace(/<!--MERMAID_(\d+)-->/g, (_, idx) => {
    const code = mermaidBlocks[parseInt(idx)];
    return `<div class="mermaid-container"><div class="mermaid">${code}</div></div>`;
  });

  html = renderFootnoteRefs(html, footnotes);
  html = appendFootnotes(html, footnotes);

  // Render display math blocks server-side with KaTeX
  html = html.replace(/<!--MATH_(\d+)-->/g, (_, idx) => {
    const code = mathBlocks[parseInt(idx)];
    try {
      return katex.renderToString(code, { throwOnError: false, displayMode: true });
    } catch (e) {
      return `<pre class="math-error">Math render error: ${escapeHtml(e.message)}\n${escapeHtml(code)}</pre>`;
    }
  });

  // Render inline math blocks server-side with KaTeX
  html = html.replace(/<!--INLINE_MATH_(\d+)-->/g, (_, idx) => {
    const code = inlineMathBlocks[parseInt(idx)];
    try {
      return katex.renderToString(code, { throwOnError: false, displayMode: false });
    } catch (e) {
      return `$${escapeHtml(code)}$`;
    }
  });

  return html;
}
