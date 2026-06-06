import { describe, it, expect } from 'bun:test';
import { ROOT_DIR, PORT, SITE_TITLE, getContentRoot } from '../config.js';
import path from 'path';

describe('config', () => {
  it('ROOT_DIR should be the package root', () => {
    expect(ROOT_DIR).toEndWith('/doc-pi');
    // Should contain README.md
    const fs = require('fs');
    expect(fs.existsSync(path.join(ROOT_DIR, 'README.md'))).toBe(true);
  });

  it('PORT should default to 3000', () => {
    expect(PORT).toBe(3000);
  });

  it('SITE_TITLE should provide a default title for pre-runtime imports', () => {
    expect(SITE_TITLE).toBe('Docs');
  });

  it('content root defaults to the parent document repo before runtime config is loaded', () => {
    expect(getContentRoot()).toBe(path.resolve(ROOT_DIR, '..'));
  });
});
