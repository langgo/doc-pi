import { readFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

const DEFAULTS = Object.freeze({
  root: '.',
  port: 3000,
  comments: Object.freeze({
    enabled: true,
    dataDir: 'data/comments',
  }),
  aiQa: Object.freeze({
    enabled: true,
    agentDir: 'config/ai-qa/omp/agent',
    historyDir: 'data/ai-qa',
  }),
});

const USAGE = `Usage: doc-pi [options]

Options:
  --root <dir>               Documentation root directory (default: .)
  --port <port>              Server port (default: 3000)
  --config <file>            Runtime config file (.js or .json)
  --comments-data-dir <dir>  Comments data directory, resolved from root
  --ai-agent-dir <dir>       AI QA agent directory, resolved from root
  --ai-history-dir <dir>     AI QA history directory, resolved from root
  --no-comments              Disable comments plugin
  --no-ai-qa                 Disable AI QA plugin
  --help                     Show this help
`;

function readOption(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArgv(argv = []) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--root':
        flags.root = readOption(argv, i, arg);
        i += 1;
        break;
      case '--port':
        flags.port = readOption(argv, i, arg);
        i += 1;
        break;
      case '--config':
        flags.config = readOption(argv, i, arg);
        i += 1;
        break;
      case '--comments-data-dir':
        flags.commentsDataDir = readOption(argv, i, arg);
        i += 1;
        break;
      case '--ai-agent-dir':
        flags.aiAgentDir = readOption(argv, i, arg);
        i += 1;
        break;
      case '--ai-history-dir':
        flags.aiHistoryDir = readOption(argv, i, arg);
        i += 1;
        break;
      case '--no-comments':
        flags.commentsEnabled = false;
        break;
      case '--no-ai-qa':
        flags.aiEnabled = false;
        break;
      case '--help':
        flags.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return flags;
}

function resolveFrom(baseDir, targetPath) {
  return path.resolve(baseDir, targetPath || '.');
}

function numberOrDefault(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Invalid port: ${value}`);
  }
  return number;
}

async function extractSiteTitle(rootDir) {
  try {
    const readme = await readFile(path.join(rootDir, 'README.md'), 'utf-8');
    const match = readme.match(/^#\s+(.+)/m);
    return match ? match[1].trim() : 'Docs';
  } catch {
    return 'Docs';
  }
}

async function loadConfigFile(configPath) {
  if (configPath.endsWith('.json')) {
    return JSON.parse(await readFile(configPath, 'utf-8'));
  }
  if (configPath.endsWith('.js') || configPath.endsWith('.mjs') || configPath.endsWith('.cjs')) {
    const moduleUrl = pathToFileURL(configPath).href;
    const mod = await import(`${moduleUrl}?mtime=${Date.now()}`);
    return mod.default ?? mod.config ?? {};
  }
  throw new Error(`Unsupported config file extension: ${configPath}`);
}

function mergeConfig(base, override) {
  const next = {
    ...base,
    ...(override ?? {}),
    comments: {
      ...base.comments,
      ...(override?.comments ?? {}),
    },
    aiQa: {
      ...base.aiQa,
      ...(override?.aiQa ?? {}),
    },
  };
  return next;
}

function applyCliFlags(config, flags) {
  const next = mergeConfig(config, null);
  if (flags.root !== undefined) next.root = flags.root;
  if (flags.port !== undefined) next.port = flags.port;
  if (flags.commentsEnabled !== undefined) next.comments.enabled = flags.commentsEnabled;
  if (flags.commentsDataDir !== undefined) next.comments.dataDir = flags.commentsDataDir;
  if (flags.aiEnabled !== undefined) next.aiQa.enabled = flags.aiEnabled;
  if (flags.aiAgentDir !== undefined) next.aiQa.agentDir = flags.aiAgentDir;
  if (flags.aiHistoryDir !== undefined) next.aiQa.historyDir = flags.aiHistoryDir;
  return next;
}

export async function resolveRuntimeConfig({ argv = [], cwd = process.cwd(), configObject = null } = {}) {
  const flags = parseArgv(argv);
  if (flags.help) {
    return { help: true, usage: USAGE };
  }

  let configPath = null;
  let config = mergeConfig({
    ...DEFAULTS,
    port: process.env.PORT || DEFAULTS.port,
  }, configObject);

  if (flags.config) {
    configPath = path.resolve(cwd, flags.config);
    config = mergeConfig(config, await loadConfigFile(configPath));
  }

  config = applyCliFlags(config, flags);

  const rootDir = resolveFrom(cwd, config.root);
  const commentsDataDir = resolveFrom(rootDir, config.comments.dataDir);
  const aiAgentDir = resolveFrom(rootDir, config.aiQa.agentDir);
  const aiHistoryDir = resolveFrom(rootDir, config.aiQa.historyDir);
  const siteTitle = config.siteTitle || await extractSiteTitle(rootDir);

  return {
    ...config,
    configPath,
    root: rootDir,
    rootDir,
    port: numberOrDefault(config.port, DEFAULTS.port),
    siteTitle,
    comments: {
      ...config.comments,
      enabled: config.comments.enabled !== false,
      dataDir: commentsDataDir,
    },
    aiQa: {
      ...config.aiQa,
      enabled: config.aiQa.enabled !== false,
      agentDir: aiAgentDir,
      historyDir: aiHistoryDir,
    },
  };
}

export async function loadRuntimeConfig(argv = process.argv.slice(2)) {
  const config = await resolveRuntimeConfig({ argv });
  if (config.help) {
    console.log(config.usage);
    process.exit(0);
  }
  return config;
}

export { USAGE as RUNTIME_CONFIG_USAGE };
