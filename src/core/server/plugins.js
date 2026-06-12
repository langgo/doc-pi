// Plugin system — allows independent modules to hook into the server.
//
// Each plugin exports:
//   { name, apiRoutes, pageInjections, staticDir }
//
// apiRoutes: [{ method, path, handler(req, res, params) }]
//   - path supports :param segments (e.g. '/api/comments/:file')
//
// pageInjections: { cssUrls, jsUrls, data(file) }
//   - cssUrls: array of URL paths (e.g. ['/plugins/comments/comment.css'])
//   - jsUrls: array of URL paths (e.g. ['/plugins/comments/comment.js'])
//   - data(file): async function returning arbitrary JSON, injected as window.__PLUGIN_<name>__
//
// staticDir: { urlPrefix, dirPath } — maps URL prefix to filesystem directory

import { json } from './server.js';

const plugins = [];

export function registerPlugin(plugin) {
  plugins.push(plugin);
}

export function resetPlugins() {
  plugins.length = 0;
}

export function getPlugins() {
  return plugins;
}

// Match a route pattern like '/api/comments/:file' against a path
function matchRoute(pattern, pathname) {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');

  // If the last pattern segment is a :param, allow it to capture multiple path segments
  const lastPattern = patternParts[patternParts.length - 1];
  if (lastPattern && lastPattern.startsWith(':')) {
    if (pathParts.length < patternParts.length) return null;
    const params = {};
    for (let i = 0; i < patternParts.length - 1; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }
    // Capture remaining segments as the last param
    const remaining = pathParts.slice(patternParts.length - 1);
    params[lastPattern.slice(1)] = decodeURIComponent(remaining.join('/'));
    return params;
  }

  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(':')) {
      params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
    } else if (patternParts[i] !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

// Try to handle a request via plugin API routes. Returns true if handled.
export async function tryPluginApiRoutes(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  for (const plugin of plugins) {
    if (!plugin.apiRoutes) continue;
    for (const route of plugin.apiRoutes) {
      const params = matchRoute(route.path, url.pathname);
      if (params && route.method === req.method) {
        try {
          await route.handler(req, res, params);
        } catch (err) {
          console.warn(`[plugin:${plugin.name}] API route failed: ${err.message}`);
          if (!res.headersSent) {
            json(res, 500, { error: `Plugin route failed: ${plugin.name}` });
          } else {
            res.end();
          }
        }
        return true;
      }
    }
  }
  return false;
}

// Collect page injections from all plugins for a given file.
// Returns { cssUrls: string[], jsUrls: string[], dataScripts: string }
export async function collectPluginInjections(file) {
  const cssUrls = [];
  const jsUrls = [];
  const dataScripts = [];

  for (const plugin of plugins) {
    if (!plugin.pageInjections) continue;
    if (plugin.pageInjections.cssUrls) {
      cssUrls.push(...plugin.pageInjections.cssUrls);
    }
    if (plugin.pageInjections.jsUrls) {
      jsUrls.push(...plugin.pageInjections.jsUrls);
    }
    if (plugin.pageInjections.data) {
      try {
        const data = await plugin.pageInjections.data(file);
        dataScripts.push(`window.__PLUGIN_${plugin.name}__ = ${JSON.stringify(data)};`);
      } catch (err) {
        console.warn(`[plugin:${plugin.name}] data injection failed: ${err.message}`);
        dataScripts.push(`window.__PLUGIN_${plugin.name}__ = null;`);
      }
    }
  }

  return { cssUrls, jsUrls, dataScripts: dataScripts.join('\n  ') };
}
