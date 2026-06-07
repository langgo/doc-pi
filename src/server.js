import { createServer } from 'http';
import { mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import boxen from 'boxen';
import gradient from 'gradient-string';
import { fileURLToPath } from 'url';
import { loadRuntimeConfig } from './runtime/config.js';
import { printRuntimeDiagnostics, validateRuntimeConfig } from './runtime/diagnostics.js';
import { renderHtml } from './core/server/render.js';
import { stripBOM, extractToc, buildTocHtml, processMarkdown, extractFrontmatter } from './core/server/markdown.js';
import { getChapterFiles, getChapterNav, buildFileListToc } from './core/server/navigation.js';
import { registerPlugin, resetPlugins, tryPluginApiRoutes, collectPluginInjections } from './core/server/plugins.js';
import { searchMarkdownFiles } from './core/server/search.js';
import { json, resolveSafePath, serveStatic } from './core/server/server.js';
import { setRuntimeConfig, getPackageSrcDir } from './core/server/runtime-state.js';
import commentsPlugin from './plugins/comments/index.js';
import createAiQaPlugin from './plugins/ai-qa/index.js';

async function handleDirectory(rootDir) {
  const readmePath = path.join(rootDir, 'README.md');
  const html = await processMarkdown(readmePath);
  const tocHtml = await buildFileListToc(rootDir, 'README.md');
  const pluginInjections = await collectPluginInjections('README.md');
  return renderHtml({ title: 'README.md', content: html, tocHtml, currentFile: 'README.md', pluginInjections });
}

async function handleMarkdown(filePath, chapterFiles, pluginInjections) {
  const html = await processMarkdown(filePath);
  const currentFile = path.basename(filePath);

  let mdContent = await readFile(filePath, 'utf-8');
  mdContent = stripBOM(mdContent);
  const frontmatterResult = extractFrontmatter(mdContent);
  mdContent = frontmatterResult.mdContent;
  const headings = extractToc(mdContent);
  const tocHtml = await buildFileListToc(path.dirname(filePath), currentFile) + buildTocHtml(headings, currentFile);

  const title = frontmatterResult.metadata?.title || currentFile;
  const chapterNav = getChapterNav(currentFile, chapterFiles);
  const chapterIndex = chapterFiles.indexOf(currentFile);
  const chapterPosition = chapterIndex === -1 ? '' : '<div class="chapter-position" aria-label="当前第 ' + (chapterIndex + 1) + ' 章，共 ' + chapterFiles.length + ' 章">第 ' + (chapterIndex + 1) + ' / ' + chapterFiles.length + ' 章</div>';
  const bottomChapterNav = getChapterNav(currentFile, chapterFiles, { position: 'bottom', withLabels: true });
  const contentWithNav = chapterNav + chapterPosition + html + bottomChapterNav;

  return renderHtml({ title, content: contentWithNav, tocHtml, currentFile, pluginInjections });
}

export function createDocPiServer(runtimeConfig) {
  const rootDir = runtimeConfig.rootDir;
  const packageSrcDir = runtimeConfig.packageSrcDir || getPackageSrcDir();

  return createServer(async (req, res) => {
    const url = req.url === '' ? '/' : req.url;

    // Plugin API routes
    if (await tryPluginApiRoutes(req, res)) return;

    if (url.startsWith('/api/search')) {
      const searchUrl = new URL(url, `http://${req.headers.host || 'localhost'}`);
      const query = searchUrl.searchParams.get('q') || '';
      if (!query.trim()) {
        json(res, 400, { error: 'q is required' });
        return;
      }
      try {
        json(res, 200, await searchMarkdownFiles(rootDir, query, { limit: 20 }));
      } catch (err) {
        json(res, 500, { error: err.message });
      }
      return;
    }

    // Static files owned by the package, not by the configured content root.
    if (url.startsWith('/core/public/') || url.startsWith('/plugins/')) {
      const result = await serveStatic(url, packageSrcDir);
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
        const html = await handleDirectory(rootDir);
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
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(pathOnly);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const filePath = path.join(rootDir, decodedPath);
    const searchParams = new URLSearchParams(queryString || '');

    const safePath = resolveSafePath(filePath, rootDir);
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
        const chapterFiles = await getChapterFiles(rootDir);
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
}

function tryListen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        reject(err);
      }
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

export async function startServer(runtimeConfig) {
  const config = setRuntimeConfig(runtimeConfig);
  printRuntimeDiagnostics(await validateRuntimeConfig(config));

  resetPlugins();
  if (config.comments.enabled !== false) {
    registerPlugin(commentsPlugin);
  }
  if (config.aiQa.enabled !== false) {
    await mkdir(config.aiQa.agentDir, { recursive: true });
    registerPlugin(createAiQaPlugin({
      agentDir: config.aiQa.agentDir,
      historyDir: config.aiQa.historyDir,
      persistThinking: config.aiQa.persistThinking,
    }));
  }

  const server = createDocPiServer(config);
  const startPort = Number(config.port) || 3000;
  const maxPort = startPort + 99;

  for (let port = startPort; port <= maxPort; port += 1) {
    const ok = await tryListen(server, port);
    if (ok) {
      const addr = server.address();
      const url = `http://localhost:${addr.port}`;
      console.log(boxen(
        gradient.pastel.multiline(`${config.siteTitle}\n\n  ${url}`),
        { padding: 1, margin: 1, borderStyle: 'round', borderColor: 'cyan' }
      ));
      return { server, port: addr.port, url, config };
    }
  }

  throw new Error(`No available port between ${startPort} and ${maxPort}`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const config = await loadRuntimeConfig(process.argv.slice(2));
  await startServer(config);
}
