import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { validateRuntimeConfig } from '../diagnostics.js';

let tmpRoot;

beforeEach(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'doc-pi-diagnostics-'));
});

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe('validateRuntimeConfig', () => {
  it('rejects a missing content root with a doc-pi init hint', async () => {
    const missingRoot = path.join(tmpRoot, 'missing');
    await expect(validateRuntimeConfig({ rootDir: missingRoot, aiQa: { enabled: false } })).rejects.toThrow(
      `Content root does not exist: ${missingRoot}\nCreate it or run: doc-pi init --root ${missingRoot}`
    );
  });

  it('rejects a file content root', async () => {
    const fileRoot = path.join(tmpRoot, 'README.md');
    await writeFile(fileRoot, '# Not a directory', 'utf-8');
    await expect(validateRuntimeConfig({ rootDir: fileRoot, aiQa: { enabled: false } })).rejects.toThrow(
      `Content root is not a directory: ${fileRoot}`
    );
  });

  it('returns warnings for empty markdown roots and missing AI model config', async () => {
    await mkdir(tmpRoot, { recursive: true });
    const aiAgentDir = path.join(tmpRoot, 'config/ai-qa/omp/agent');
    const result = await validateRuntimeConfig({ rootDir: tmpRoot, aiQa: { enabled: true, agentDir: aiAgentDir } });

    expect(result.warnings).toContain(`No Markdown files found in content root: ${tmpRoot}`);
    expect(result.warnings).toContain(`AI QA model config not found: ${path.join(aiAgentDir, 'models.yml')}\nRun: doc-pi init --root ${tmpRoot}`);
  });

  it('accepts markdown roots with AI disabled', async () => {
    await writeFile(path.join(tmpRoot, 'README.md'), '# Docs', 'utf-8');
    const result = await validateRuntimeConfig({ rootDir: tmpRoot, aiQa: { enabled: false } });
    expect(result.warnings).toEqual([]);
  });
});
