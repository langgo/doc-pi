import { describe, it, expect } from 'bun:test';
import { createStartupProfiler } from '../startup-profile.js';

describe('startup-profile', () => {
  it('does not emit profile lines unless enabled', async () => {
    const lines = [];
    const profiler = createStartupProfiler({ enabled: false, now: () => 0, output: { write: line => lines.push(line) } });

    await profiler.step('config', async () => 'ok');
    profiler.done();

    expect(lines).toEqual([]);
  });

  it('emits per-step and total startup timings when enabled', async () => {
    const times = [100, 110, 145, 160, 210, 230];
    const lines = [];
    const profiler = createStartupProfiler({ enabled: true, now: () => times.shift(), output: { write: line => lines.push(line) } });

    const result = await profiler.step('config', async () => 'ok');
    await profiler.step('listen', async () => {});
    profiler.done();

    expect(result).toBe('ok');
    expect(lines).toEqual([
      '[doc-pi] startup config: 35ms\n',
      '[doc-pi] startup listen: 50ms\n',
      '[doc-pi] startup total: 130ms\n',
    ]);
  });
});
