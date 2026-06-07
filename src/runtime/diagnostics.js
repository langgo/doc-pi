import { readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

async function listMarkdownFiles(rootDir) {
  const files = await readdir(rootDir);
  return files.filter(file => file.endsWith('.md') && file !== 'AGENTS.md');
}

export async function validateRuntimeConfig(config) {
  const rootDir = path.resolve(config.rootDir || config.root || '.');
  let rootStat;
  try {
    rootStat = await stat(rootDir);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new Error(`Content root does not exist: ${rootDir}\nCreate it or run: doc-pi init --root ${rootDir}`);
    }
    throw err;
  }

  if (!rootStat.isDirectory()) {
    throw new Error(`Content root is not a directory: ${rootDir}`);
  }

  const warnings = [];
  const markdownFiles = await listMarkdownFiles(rootDir);
  if (markdownFiles.length === 0) {
    warnings.push(`No Markdown files found in content root: ${rootDir}`);
  }

  if (config.aiQa?.enabled !== false) {
    const modelsPath = path.join(config.aiQa.agentDir, 'models.yml');
    if (!existsSync(modelsPath)) {
      warnings.push(`AI QA model config not found: ${modelsPath}\nRun: doc-pi init --root ${rootDir}`);
    }
  }

  return { warnings };
}

export function printRuntimeDiagnostics(diagnostics, output = process.stderr) {
  if (!diagnostics?.warnings?.length) return;
  for (const warning of diagnostics.warnings) {
    output.write(`[doc-pi] Warning: ${warning}\n`);
  }
}
