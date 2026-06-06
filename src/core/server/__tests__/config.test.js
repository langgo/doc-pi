import { describe, it, expect } from 'bun:test';
import { ROOT_DIR, PORT, SITE_TITLE } from '../config.js';
import path from 'path';

describe('config', () => {
  it('ROOT_DIR should be the project root (3 levels up)', () => {
    expect(ROOT_DIR).toEndWith('/es_arch_book');
    // Should contain README.md
    const fs = require('fs');
    expect(fs.existsSync(path.join(ROOT_DIR, 'README.md'))).toBe(true);
  });

  it('PORT should default to 3000', () => {
    expect(PORT).toBe(3000);
  });

  it('SITE_TITLE should be extracted from README.md H1', () => {
    expect(typeof SITE_TITLE).toBe('string');
    expect(SITE_TITLE.length).toBeGreaterThan(0);
  });
});
