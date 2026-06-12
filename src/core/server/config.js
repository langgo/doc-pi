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

// marked v18 renderer hardcodes 'language-' prefix; patch to add hljs class.
const origCode = marked.Renderer.prototype.code;
marked.Renderer.prototype.code = function (token) {
  const html = origCode.call(this, token);
  return html.replace(/<code class="language-/, '<code class="hljs language-');
};

export { marked };
