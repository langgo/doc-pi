import { mkdtemp, cp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { createServer } from 'net';
import { ROOT_DIR } from '../../../src/core/server/config.js';

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url) {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`E2E server failed to start: ${url}`);
}

export async function startE2EServer({ ai = true, fixtureRoot = 'tests/fixtures', healthPath = '/sample-chapter.md', extraArgs = [] } = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'doc-pi-e2e-'));
  await cp(path.join(ROOT_DIR, fixtureRoot), rootDir, { recursive: true });

  const port = await getFreePort();
  const args = ['bun', 'run', 'src/server.js', '--root', rootDir, '--port', String(port), ...extraArgs];
  if (!ai) args.push('--no-ai-qa');
  else args.push('--ai-agent-dir', path.join(rootDir, 'config', 'ai-qa', 'omp', 'agent'));

  const child = Bun.spawn(args, {
    cwd: ROOT_DIR,
    env: { ...globalThis.process.env },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const baseUrl = `http://localhost:${port}`;

  async function stop() {
    child.kill();
    await rm(rootDir, { recursive: true, force: true });
  }

  try {
    await waitForHttp(`${baseUrl}${healthPath}`);
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    rootDir,
    port,
    baseUrl,
    stop,
  };
}
