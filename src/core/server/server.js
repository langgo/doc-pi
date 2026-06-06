import { readFile } from 'fs/promises';
import path from 'path';
import { ROOT_DIR } from './config.js';

// Resolve and validate file path is within project directory
export function resolveSafePath(targetPath) {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(ROOT_DIR);
  if (resolved === root) return root;
  if (!resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

// Serve a static file from the filesystem. Returns { status, headers, body } or null.
export async function serveStatic(urlPath, rootDir) {
  const [pathOnly] = urlPath.split('?');
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathOnly);
  } catch {
    return null;
  }
  const staticPath = path.resolve(rootDir, '.' + decodedPath);
  const safeRoot = path.resolve(rootDir);
  if (staticPath !== safeRoot && !staticPath.startsWith(safeRoot + path.sep)) return null;
  try {
    const buf = await readFile(staticPath);
    const ext = path.extname(staticPath);
    const mime = ext === '.css' ? 'text/css' : ext === '.js' ? 'application/javascript' : 'application/octet-stream';
    return { status: 200, headers: { 'Content-Type': mime }, body: buf };
  } catch {
    return null;
  }
}

// Parse JSON request body
export function parseBody(req, options = {}) {
  const maxBytes = options.maxBytes || 1024 * 1024;
  return new Promise((resolve, reject) => {
    let body = '';
    let settled = false;

    function fail(err) {
      if (settled) return;
      settled = true;
      reject(err);
    }

    req.on('data', chunk => {
      if (settled) return;
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        fail(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      try { resolve(body ? JSON.parse(body) : null); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', fail);
  });
}

// Send JSON response
export function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
