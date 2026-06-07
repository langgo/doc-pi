import { copyFile, mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const modelsExamplePath = path.join(packageRoot, 'examples/ai-qa/omp/agent/models.yml.example');

function defaultConfig() {
  return `export default {
  root: '.',
  port: 3000,
  siteTitle: 'Docs',
  comments: {
    enabled: true,
    dataDir: 'data/comments',
  },
  aiQa: {
    enabled: true,
    agentDir: 'config/ai-qa/omp/agent',
    historyDir: 'data/ai-qa',
  },
};
`;
}

async function writeFileIfAllowed(filePath, content, { force, created, skipped }) {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (existsSync(filePath) && !force) {
    skipped.push(filePath);
    return;
  }
  await writeFile(filePath, content, 'utf-8');
  created.push(filePath);
}

async function copyFileIfAllowed(sourcePath, targetPath, { force, created, skipped }) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  if (existsSync(targetPath) && !force) {
    skipped.push(targetPath);
    return;
  }
  await copyFile(sourcePath, targetPath);
  created.push(targetPath);
}

export async function runInitCommand({ root = '.', force = false } = {}) {
  const rootDir = path.resolve(root);
  const created = [];
  const skipped = [];
  await mkdir(rootDir, { recursive: true });

  await writeFileIfAllowed(path.join(rootDir, 'doc-pi.config.js'), defaultConfig(), { force, created, skipped });
  await copyFileIfAllowed(modelsExamplePath, path.join(rootDir, 'config/ai-qa/omp/agent/models.yml'), { force, created, skipped });
  await writeFileIfAllowed(path.join(rootDir, 'data/comments/.gitkeep'), '', { force, created, skipped });
  await writeFileIfAllowed(path.join(rootDir, 'data/ai-qa/.gitkeep'), '', { force, created, skipped });

  return { root: rootDir, created, skipped };
}

export async function formatInitResult(result) {
  const lines = [`Initialized doc-pi project at ${result.root}`];
  if (result.created.length) {
    lines.push('', 'Created:');
    for (const file of result.created) lines.push(`  - ${path.relative(result.root, file)}`);
  }
  if (result.skipped.length) {
    lines.push('', 'Skipped existing files:');
    for (const file of result.skipped) lines.push(`  - ${path.relative(result.root, file)}`);
    lines.push('', 'Use --force to overwrite skipped files.');
  }
  return `${lines.join('\n')}\n`;
}
