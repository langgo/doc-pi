import { describe, it, expect } from 'bun:test';
import { resolveSafePath, serveStatic, parseBody, json } from '../server.js';
import { ROOT_DIR } from '../config.js';
import path from 'path';
import { EventEmitter } from 'events';

describe('server utilities', () => {
  describe('resolveSafePath', () => {
    it('should resolve a valid path within ROOT_DIR', () => {
      const result = resolveSafePath(path.join(ROOT_DIR, 'README.md'));
      expect(result).toBe(path.join(ROOT_DIR, 'README.md'));
    });

    it('should return ROOT_DIR when path equals root', () => {
      const result = resolveSafePath(ROOT_DIR);
      expect(result).toBe(ROOT_DIR);
    });

    it('should return null for path outside ROOT_DIR', () => {
      const result = resolveSafePath('/etc/passwd');
      expect(result).toBeNull();
    });

    it('should return null for path traversal attempt', () => {
      const result = resolveSafePath(path.join(ROOT_DIR, '..', '..', 'etc', 'passwd'));
      expect(result).toBeNull();
    });
  });

  describe('serveStatic', () => {
    it('should serve an existing file', async () => {
      const result = await serveStatic('/core/public/style.css', path.join(ROOT_DIR, 'src'));
      expect(result).not.toBeNull();
      expect(result.status).toBe(200);
      expect(result.headers['Content-Type']).toBe('text/css');
      expect(result.body).toBeInstanceOf(Buffer);
    });

    it('should return null for non-existent file', async () => {
      const result = await serveStatic('/core/public/nonexistent.css', path.join(ROOT_DIR, 'src'));
      expect(result).toBeNull();
    });

    it('should serve modular core JS with correct MIME type', async () => {
      const result = await serveStatic('/core/public/core-state.js', path.join(ROOT_DIR, 'src'));
      expect(result).not.toBeNull();
      expect(result.headers['Content-Type']).toBe('application/javascript');
    });

    it('should reject path traversal outside static root', async () => {
      const result = await serveStatic('/core/public/../../../package.json', path.join(ROOT_DIR, 'src'));
      expect(result).toBeNull();
    });
  });

  describe('parseBody', () => {
    it('should parse valid JSON body', async () => {
      const req = new EventEmitter();
      req.headers = { 'content-type': 'application/json' };
      const promise = parseBody(req);
      req.emit('data', '{"key":');
      req.emit('data', '"value"}');
      req.emit('end');
      const result = await promise;
      expect(result).toEqual({ key: 'value' });
    });

    it('should return null for empty body', async () => {
      const req = new EventEmitter();
      const promise = parseBody(req);
      req.emit('end');
      const result = await promise;
      expect(result).toBeNull();
    });

    it('should reject on invalid JSON', async () => {
      const req = new EventEmitter();
      const promise = parseBody(req);
      req.emit('data', 'not json');
      req.emit('end');
      await expect(promise).rejects.toThrow('Invalid JSON');
    });

    it('should reject on stream error', async () => {
      const req = new EventEmitter();
      const promise = parseBody(req);
      req.emit('error', new Error('stream error'));
      await expect(promise).rejects.toThrow('stream error');
    });

    it('should reject request bodies over the configured limit', async () => {
      const req = new EventEmitter();
      const promise = parseBody(req, { maxBytes: 10 });
      req.emit('data', '{"value":"too large"}');
      req.emit('end');
      await expect(promise).rejects.toThrow('Request body too large');
    });
  });

  describe('json', () => {
    it('should send JSON response with correct headers', () => {
      let statusCode, headers, body;
      const res = {
        writeHead(code, hdrs) { statusCode = code; headers = hdrs; },
        end(data) { body = data; }
      };
      json(res, 200, { ok: true });
      expect(statusCode).toBe(200);
      expect(headers['Content-Type']).toBe('application/json; charset=utf-8');
      expect(JSON.parse(body)).toEqual({ ok: true });
    });

    it('should send error status codes', () => {
      let statusCode;
      const res = {
        writeHead(code) { statusCode = code; },
        end() {}
      };
      json(res, 404, { error: 'Not found' });
      expect(statusCode).toBe(404);
    });
  });
});
