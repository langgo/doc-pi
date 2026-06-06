import ejs from 'ejs';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getRuntimeConfig } from './runtime-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templatePath = path.join(__dirname, '..', 'public', 'template', 'page.ejs');
const template = readFileSync(templatePath, 'utf-8');

export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderHtml({ title, content, tocHtml, currentFile, showViewToggle = true, pluginInjections }) {
  const { cssUrls = [], jsUrls = [], dataScripts = '' } = pluginInjections || {};

  return ejs.render(template, {
    title,
    siteTitle: getRuntimeConfig().siteTitle,
    content,
    tocHtml,
    currentFile,
    showViewToggle,
    pluginCssUrls: cssUrls,
    pluginJsUrls: jsUrls,
    dataScripts,
  });
}
