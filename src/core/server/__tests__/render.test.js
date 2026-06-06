import { describe, it, expect } from 'bun:test';
import { escapeHtml, renderHtml } from '../render.js';

describe('render', () => {
  describe('escapeHtml', () => {
    it('should escape &', () => {
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('should escape < and >', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('should escape "', () => {
      expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    });

    it('should return unchanged string when no special chars', () => {
      expect(escapeHtml('hello world')).toBe('hello world');
    });

    it('should handle empty string', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  describe('renderHtml', () => {
    it('should render a basic HTML page', () => {
      const html = renderHtml({
        title: 'Test',
        content: '<p>Hello</p>',
        tocHtml: '<ul><li>Item</li></ul>',
        currentFile: 'test.md',
      });
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Test');
      expect(html).toContain('<p>Hello</p>');
      expect(html).toContain('<ul><li>Item</li></ul>');
    });

    it('should include plugin CSS and JS URLs', () => {
      const html = renderHtml({
        title: 'Test',
        content: '',
        tocHtml: '',
        currentFile: 'test.md',
        pluginInjections: {
          cssUrls: ['/plugins/test/style.css'],
          jsUrls: ['/plugins/test/script.js'],
          dataScripts: 'window.__PLUGIN_test__ = {};',
        }
      });
      expect(html).toContain('/plugins/test/style.css');
      expect(html).toContain('/plugins/test/script.js');
      expect(html).toContain('window.__PLUGIN_test__ = {};');
    });

    it('should hide view toggle when showViewToggle is false', () => {
      const html = renderHtml({
        title: 'Test',
        content: '',
        tocHtml: '',
        currentFile: 'test.md',
        showViewToggle: false,
      });
      expect(html).not.toContain('btn-settings');
    });

    it('should show view toggle by default', () => {
      const html = renderHtml({
        title: 'Test',
        content: '',
        tocHtml: '',
        currentFile: 'test.md',
      });
      expect(html).toContain('btn-settings');
    });

    it('should handle null pluginInjections', () => {
      const html = renderHtml({
        title: 'Test',
        content: '',
        tocHtml: '',
        currentFile: 'test.md',
        pluginInjections: null,
      });
      expect(html).toContain('<!DOCTYPE html>');
    });
  });
});
