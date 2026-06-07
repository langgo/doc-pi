#!/usr/bin/env bun
import { loadRuntimeConfig } from '../src/runtime/config.js';
import { startServer } from '../src/server.js';

const config = await loadRuntimeConfig(process.argv.slice(2));
await startServer(config);
