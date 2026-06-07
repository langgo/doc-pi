import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { runInitCommand } from '../init.js';

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-init-'));
});

afterEach(async () => {
  if (tmpRoot) {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

describe('runInitCommand', () => {
  it('creates the default doc-pi project configuration files', async () => {
    const result = await runInitCommand({ root: tmpRoot });

    expect(result.created.map(file => path.relative(tmpRoot, file)).sort()).toEqual([
      'config/ai-qa/omp/agent/models.yml',
      'data/ai-qa/.gitkeep',
      'data/comments/.gitkeep',
      'doc-pi.config.js',
    ]);
    expect(result.skipped).toEqual([]);
    expect(existsSync(path.join(tmpRoot, 'doc-pi.config.js'))).toBe(true);
    expect(existsSync(path.join(tmpRoot, 'config/ai-qa/omp/agent/models.yml'))).toBe(true);
    const config = await readFile(path.join(tmpRoot, 'doc-pi.config.js'), 'utf-8');
    expect(config).toContain("root: '.'");
    expect(config).toContain("agentDir: 'config/ai-qa/omp/agent'");
    const models = await readFile(path.join(tmpRoot, 'config/ai-qa/omp/agent/models.yml'), 'utf-8');
    expect(models).toContain('models:');
  });

  it('does not overwrite existing files unless forced', async () => {
    const configPath = path.join(tmpRoot, 'doc-pi.config.js');
    await writeFile(configPath, 'custom config', 'utf-8');

    const result = await runInitCommand({ root: tmpRoot });
    expect(result.skipped).toContain(configPath);
    expect(await readFile(configPath, 'utf-8')).toBe('custom config');

    await runInitCommand({ root: tmpRoot, force: true });
    expect(await readFile(configPath, 'utf-8')).toContain('export default');
  });
});
