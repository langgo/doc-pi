#!/usr/bin/env bun
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import boxen from 'boxen';
import gradient from 'gradient-string';
import { ROOT_DIR, PORT, SITE_TITLE } from './core/server/config.js';
import { renderHtml } from './core/server/render.js';
import { stripBOM, extractToc, buildTocHtml, processMarkdown } from './core/server/markdown.js';
import { getChapterFiles, getChapterNav, buildFileListToc } from './core/server/navigation.js';
import { registerPlugin, tryPluginApiRoutes, collectPluginInjections } from './core/server/plugins.js';
import { resolveSafePath, serveStatic } from './core/server/server.js';
import commentsPlugin from './plugins/comments/index.js';
import createAiQaPlugin from './plugins/ai-qa/index.js';

async function handleDirectory() {
  const readmePath = path.join(ROOT_DIR, 'README.md');
  const html = await processMarkdown(readmePath);
  const tocHtml = await buildFileListToc();
  const pluginInjections = await collectPluginInjections('README.md');
  return renderHtml({ title: 'README.md', content: html, tocHtml, currentFile: 'README.md', pluginInjections });
}

async function handleMarkdown(filePath, chapterFiles, pluginInjections) {
  const html = await processMarkdown(filePath);
  const currentFile = path.basename(filePath);

  let mdContent = await readFile(filePath, 'utf-8');
  mdContent = stripBOM(mdContent);
  const headings = extractToc(mdContent);
  const tocHtml = buildTocHtml(headings, currentFile);

  const title = currentFile;
  const chapterNav = getChapterNav(currentFile, chapterFiles);
  const contentWithNav = chapterNav + html + chapterNav;

  return renderHtml({ title, content: contentWithNav, tocHtml, currentFile, pluginInjections });
}

const server = createServer(async (req, res) => {
  let url = req.url === '' ? '/' : req.url;

  // Plugin API routes
  if (await tryPluginApiRoutes(req, res)) return;

  // Static files: /core/public/* and /plugins/*
  if (url.startsWith('/core/public/') || url.startsWith('/plugins/')) {
    const result = await serveStatic(url, path.join(ROOT_DIR, 'src'));
    if (result) {
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    } else {
      res.writeHead(404);
      res.end('404 Not Found');
    }
    return;
  }

  if (url === '/') {
    try {
      const html = await handleDirectory();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Server error: ${err.message}`);
      return;
    }
  }

  const [pathOnly, queryString] = url.split('?');
  const decodedPath = decodeURIComponent(pathOnly);
  const filePath = path.join(ROOT_DIR, decodedPath);
  const searchParams = new URLSearchParams(queryString || '');

  const safePath = resolveSafePath(filePath);
  if (!safePath || !existsSync(safePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  if (decodedPath.endsWith('.md')) {
    try {
      if (searchParams.has('raw')) {
        const rawContent = await readFile(safePath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(stripBOM(rawContent));
        return;
      }
      const chapterFiles = await getChapterFiles();
      const pluginInjections = await collectPluginInjections(path.basename(safePath));
      const html = await handleMarkdown(safePath, chapterFiles, pluginInjections);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Error reading file: ${err.message}`);
      return;
    }
  }

  try {
    const buf = await readFile(safePath);
    res.writeHead(200);
    res.end(buf);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Error reading file: ${err.message}`);
  }
});

// Register plugins
registerPlugin(commentsPlugin);
registerPlugin(createAiQaPlugin({ agentDir: path.join(ROOT_DIR, 'config', 'ai-qa', 'omp', 'agent') }));

function tryListen(port) {
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        reject(err);
      }
    });
    server.listen(port, () => {
      resolve(true);
    });
  });
}

const MAX_PORT = PORT + 99;

for (let port = PORT; port <= MAX_PORT; port++) {
  const ok = await tryListen(port);
  if (ok) {
    const addr = server.address();
    const url = `http://localhost:${addr.port}`;
    console.log(boxen(
      gradient.pastel.multiline(`${SITE_TITLE}\n\n  ${url}`),
      { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'cyan' }
    ));
    break;
  }
}
