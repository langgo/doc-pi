import { describe, it, expect, afterEach } from 'bun:test';
import path from 'path';
import { getRuntimeConfig, setRuntimeConfig } from '../runtime-state.js';

const originalConfig = getRuntimeConfig();

afterEach(() => {
  setRuntimeConfig(originalConfig);
});

describe('setRuntimeConfig', () => {
  it('rebases comments and AI QA default directories when rootDir changes', () => {
    const rootDir = path.resolve('/tmp/doc-pi-runtime-state-rebased');

    const config = setRuntimeConfig({ rootDir });

    expect(config.rootDir).toBe(rootDir);
    expect(config.root).toBe(rootDir);
    expect(config.comments.dataDir).toBe(path.join(rootDir, 'data', 'comments'));
    expect(config.aiQa.agentDir).toBe(path.join(rootDir, 'config', 'ai-qa', 'omp', 'agent'));
    expect(config.aiQa.historyDir).toBe(path.join(rootDir, 'data', 'ai-qa'));
  });

  it('preserves explicit nested comments and AI QA directories when rootDir changes', () => {
    const rootDir = path.resolve('/tmp/doc-pi-runtime-state-explicit-root');
    const explicitCommentsDir = path.resolve('/tmp/doc-pi-runtime-state-explicit-comments');
    const explicitAgentDir = path.resolve('/tmp/doc-pi-runtime-state-explicit-agent');
    const explicitHistoryDir = path.resolve('/tmp/doc-pi-runtime-state-explicit-history');

    const config = setRuntimeConfig({
      rootDir,
      comments: { dataDir: explicitCommentsDir },
      aiQa: {
        agentDir: explicitAgentDir,
        historyDir: explicitHistoryDir,
      },
    });

    expect(config.rootDir).toBe(rootDir);
    expect(config.root).toBe(rootDir);
    expect(config.comments.dataDir).toBe(explicitCommentsDir);
    expect(config.aiQa.agentDir).toBe(explicitAgentDir);
    expect(config.aiQa.historyDir).toBe(explicitHistoryDir);
  });

  it('rebases default nested directories across later rootDir changes', () => {
    const firstRoot = path.resolve('/tmp/doc-pi-runtime-state-first-root');
    const nextRoot = path.resolve('/tmp/doc-pi-runtime-state-next-root');

    setRuntimeConfig({ rootDir: firstRoot });
    const config = setRuntimeConfig({ rootDir: nextRoot });

    expect(config.rootDir).toBe(nextRoot);
    expect(config.comments.dataDir).toBe(path.join(nextRoot, 'data', 'comments'));
    expect(config.aiQa.agentDir).toBe(path.join(nextRoot, 'config', 'ai-qa', 'omp', 'agent'));
    expect(config.aiQa.historyDir).toBe(path.join(nextRoot, 'data', 'ai-qa'));
  });

  it('resets plugin enabled flags when a later rootDir config omits plugins', () => {
    const firstRoot = path.resolve('/tmp/doc-pi-runtime-state-disabled-root');
    const nextRoot = path.resolve('/tmp/doc-pi-runtime-state-reset-root');

    setRuntimeConfig({
      rootDir: firstRoot,
      comments: { enabled: false },
      aiQa: { enabled: false },
    });
    const config = setRuntimeConfig({ rootDir: nextRoot });

    expect(config.rootDir).toBe(nextRoot);
    expect(config.comments.enabled).toBe(true);
    expect(config.aiQa.enabled).toBe(true);
    expect(config.comments.dataDir).toBe(path.join(nextRoot, 'data', 'comments'));
    expect(config.aiQa.agentDir).toBe(path.join(nextRoot, 'config', 'ai-qa', 'omp', 'agent'));
    expect(config.aiQa.historyDir).toBe(path.join(nextRoot, 'data', 'ai-qa'));
  });
});
