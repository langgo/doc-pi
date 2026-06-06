import { describe, it, expect, beforeEach } from 'bun:test';
import { registerPlugin, getPlugins, tryPluginApiRoutes, collectPluginInjections } from '../plugins.js';

// Reset plugins before each test
beforeEach(() => {
  // Clear plugins array by re-importing — but since it's a module-level array,
  // we need to work with the existing one. The getPlugins() returns the same array.
  const plugins = getPlugins();
  plugins.length = 0;
});

describe('plugins', () => {
  describe('registerPlugin / getPlugins', () => {
    it('should register and retrieve plugins', () => {
      const plugin = { name: 'test', apiRoutes: [] };
      registerPlugin(plugin);
      expect(getPlugins()).toHaveLength(1);
      expect(getPlugins()[0].name).toBe('test');
    });

    it('should register multiple plugins', () => {
      registerPlugin({ name: 'a' });
      registerPlugin({ name: 'b' });
      expect(getPlugins()).toHaveLength(2);
    });
  });

  describe('tryPluginApiRoutes', () => {
    it('should return false when no plugins registered', async () => {
      const req = { url: '/api/test', method: 'GET', headers: { host: 'localhost' } };
      const res = {};
      const result = await tryPluginApiRoutes(req, res);
      expect(result).toBe(false);
    });

    it('should match route with params and call handler', async () => {
      let called = false;
      let capturedParams = null;
      registerPlugin({
        name: 'test',
        apiRoutes: [{
          method: 'GET',
          path: '/api/comments/:file',
          handler(req, res, params) {
            called = true;
            capturedParams = params;
          }
        }]
      });

      const req = { url: '/api/comments/test.md', method: 'GET', headers: { host: 'localhost' } };
      const res = {};
      const result = await tryPluginApiRoutes(req, res);
      expect(result).toBe(true);
      expect(called).toBe(true);
      expect(capturedParams).toEqual({ file: 'test.md' });
    });

    it('should not match wrong method', async () => {
      let called = false;
      registerPlugin({
        name: 'test',
        apiRoutes: [{
          method: 'POST',
          path: '/api/comments/:file',
          handler() { called = true; }
        }]
      });

      const req = { url: '/api/comments/test.md', method: 'GET', headers: { host: 'localhost' } };
      const res = {};
      const result = await tryPluginApiRoutes(req, res);
      expect(result).toBe(false);
      expect(called).toBe(false);
    });

    it('should not match wrong path', async () => {
      let called = false;
      registerPlugin({
        name: 'test',
        apiRoutes: [{
          method: 'GET',
          path: '/api/comments/:file',
          handler() { called = true; }
        }]
      });

      const req = { url: '/api/other/test.md', method: 'GET', headers: { host: 'localhost' } };
      const res = {};
      const result = await tryPluginApiRoutes(req, res);
      expect(result).toBe(false);
      expect(called).toBe(false);
    });

    it('should decode URI-encoded params', async () => {
      let capturedParams = null;
      registerPlugin({
        name: 'test',
        apiRoutes: [{
          method: 'GET',
          path: '/api/comments/:file',
          handler(req, res, params) { capturedParams = params; }
        }]
      });

      const req = { url: '/api/comments/01-%E6%A6%82%E8%BF%B0.md', method: 'GET', headers: { host: 'localhost' } };
      const res = {};
      await tryPluginApiRoutes(req, res);
      expect(capturedParams.file).toBe('01-概述.md');
    });

    it('should isolate plugin API handler failures with a 500 response', async () => {
      registerPlugin({
        name: 'broken-api',
        apiRoutes: [{
          method: 'GET',
          path: '/api/broken',
          handler() { throw new Error('boom'); }
        }]
      });

      let status = null;
      let headers = null;
      let body = '';
      const req = { url: '/api/broken', method: 'GET', headers: { host: 'localhost' } };
      const res = {
        headersSent: false,
        writeHead(code, h) { status = code; headers = h; this.headersSent = true; },
        end(chunk) { body = chunk; },
      };

      const originalWarn = console.warn;
      const warnings = [];
      console.warn = (message) => warnings.push(message);
      let handled;
      try {
        handled = await tryPluginApiRoutes(req, res);
      } finally {
        console.warn = originalWarn;
      }

      expect(warnings[0]).toContain('[plugin:broken-api] API route failed');
      expect(handled).toBe(true);
      expect(status).toBe(500);
      expect(headers['Content-Type']).toContain('application/json');
      expect(JSON.parse(body).error).toContain('Plugin route failed');
    });
  });

  describe('collectPluginInjections', () => {
    it('should return empty arrays when no plugins', async () => {
      const result = await collectPluginInjections('test.md');
      expect(result).toEqual({ cssUrls: [], jsUrls: [], dataScripts: '' });
    });

    it('should collect cssUrls and jsUrls from plugins', async () => {
      registerPlugin({
        name: 'test',
        pageInjections: {
          cssUrls: ['/plugins/test/style.css'],
          jsUrls: ['/plugins/test/script.js'],
        }
      });

      const result = await collectPluginInjections('test.md');
      expect(result.cssUrls).toEqual(['/plugins/test/style.css']);
      expect(result.jsUrls).toEqual(['/plugins/test/script.js']);
      expect(result.dataScripts).toBe('');
    });

    it('should collect data scripts from plugins', async () => {
      registerPlugin({
        name: 'test',
        pageInjections: {
          data: async (file) => ({ file, items: [1, 2, 3] }),
        }
      });

      const result = await collectPluginInjections('test.md');
      expect(result.dataScripts).toContain('window.__PLUGIN_test__');
      expect(result.dataScripts).toContain('"file":"test.md"');
      expect(result.dataScripts).toContain('"items":[1,2,3]');
    });

    it('should handle plugins without pageInjections', async () => {
      registerPlugin({ name: 'no-injections' });
      const result = await collectPluginInjections('test.md');
      expect(result).toEqual({ cssUrls: [], jsUrls: [], dataScripts: '' });
    });

    it('should isolate plugin data injection failures', async () => {
      registerPlugin({
        name: 'broken',
        pageInjections: {
          cssUrls: ['/plugins/broken/style.css'],
          jsUrls: ['/plugins/broken/script.js'],
          data: async () => { throw new Error('data unavailable'); },
        }
      });
      registerPlugin({
        name: 'healthy',
        pageInjections: {
          data: async () => ({ ok: true }),
        }
      });

      const originalWarn = console.warn;
      const warnings = [];
      console.warn = (message) => warnings.push(message);
      let result;
      try {
        result = await collectPluginInjections('test.md');
      } finally {
        console.warn = originalWarn;
      }

      expect(warnings[0]).toContain('[plugin:broken] data injection failed');
      expect(result.cssUrls).toEqual(['/plugins/broken/style.css']);
      expect(result.jsUrls).toEqual(['/plugins/broken/script.js']);
      expect(result.dataScripts).toContain('window.__PLUGIN_broken__ = null;');
      expect(result.dataScripts).toContain('window.__PLUGIN_healthy__');
      expect(result.dataScripts).toContain('"ok":true');
    });
  });
});
