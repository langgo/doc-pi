import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { marked } from 'marked';
import hljs from 'highlight.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Project root is 3 levels up from src/core/server/
export const ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
export const PORT = process.env.PORT || 3000;

// Extract site title from README.md H1 (first line starting with #)
function extractSiteTitle() {
  try {
    const readme = readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf-8');
    const match = readme.match(/^#\s+(.+)/m);
    return match ? match[1].trim() : 'Docs';
  } catch {
    return 'Docs';
  }
}
export const SITE_TITLE = extractSiteTitle();

marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
  gfm: true
});

export { marked };
