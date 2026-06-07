#!/usr/bin/env bun
import { loadRuntimeConfig } from '../src/runtime/config.js';
import { formatInitResult, runInitCommand } from '../src/runtime/init.js';
import { startServer } from '../src/server.js';

const config = await loadRuntimeConfig(process.argv.slice(2));
if (config.command === 'init') {
  const result = await runInitCommand(config);
  process.stdout.write(await formatInitResult(result));
} else {
  await startServer(config);
}
