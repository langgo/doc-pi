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

// Process markdown content: protect mermaid/math blocks, render with marked, restore
export async function processMarkdown(filePath) {
  let mdContent = await readFile(filePath, 'utf-8');
  mdContent = stripBOM(mdContent);

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

  // Add id attributes to headings for TOC anchor navigation
  html = html.replace(/<(h[1-4])>(.*?)<\/\1>/g, (match, tag, text) => {
    const id = slugify(text);
    return '<' + tag + ' id="' + id + '">' + text + '</' + tag + '>';
  });

  // Restore mermaid blocks as plain divs for mermaid.js
  html = html.replace(/<!--MERMAID_(\d+)-->/g, (_, idx) => {
    const code = mermaidBlocks[parseInt(idx)];
    return `<div class="mermaid-container"><div class="mermaid">${code}</div></div>`;
  });

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
