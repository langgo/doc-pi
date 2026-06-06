import { marked } from 'marked';
import hljs from 'highlight.js';
import { getRuntimeConfig, getContentRoot, getPackageRootDir } from './runtime-state.js';

export const ROOT_DIR = getPackageRootDir();
export const PORT = Number(process.env.PORT) || 3000;
export const SITE_TITLE = 'Docs';

export { getRuntimeConfig, getContentRoot };

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
