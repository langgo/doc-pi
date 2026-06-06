import path from 'path';
import { fileURLToPath } from 'url';

const packageSrcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageRootDir = path.resolve(packageSrcDir, '..');
const defaultContentRootDir = path.basename(packageRootDir) === 'doc-pi'
  ? path.resolve(packageRootDir, '..')
  : packageRootDir;

function rootDefaults(rootDir) {
  return {
    comments: Object.freeze({
      enabled: true,
      dataDir: path.join(rootDir, 'data', 'comments'),
    }),
    aiQa: Object.freeze({
      enabled: true,
      agentDir: path.join(rootDir, 'config', 'ai-qa', 'omp', 'agent'),
      historyDir: path.join(rootDir, 'data', 'ai-qa'),
    }),
  };
}

const defaultPluginConfig = rootDefaults(defaultContentRootDir);

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function mergePluginConfig(rootDir, config) {
  const pluginDefaults = rootDefaults(rootDir);
  const comments = config.comments || {};
  const aiQa = config.aiQa || {};
  return {
    comments: Object.freeze({
      ...pluginDefaults.comments,
      ...comments,
      dataDir: hasOwn(comments, 'dataDir') ? comments.dataDir : pluginDefaults.comments.dataDir,
    }),
    aiQa: Object.freeze({
      ...pluginDefaults.aiQa,
      ...aiQa,
      agentDir: hasOwn(aiQa, 'agentDir') ? aiQa.agentDir : pluginDefaults.aiQa.agentDir,
      historyDir: hasOwn(aiQa, 'historyDir') ? aiQa.historyDir : pluginDefaults.aiQa.historyDir,
    }),
  };
}

let runtimeConfig = Object.freeze({
  rootDir: defaultContentRootDir,
  root: defaultContentRootDir,
  packageSrcDir,
  packageRootDir,
  port: Number(process.env.PORT) || 3000,
  siteTitle: 'Docs',
  comments: defaultPluginConfig.comments,
  aiQa: defaultPluginConfig.aiQa,
});

export function setRuntimeConfig(config = {}) {
  const rootDir = path.resolve(config.rootDir || config.root || runtimeConfig.rootDir);
  const pluginConfig = mergePluginConfig(rootDir, config);
  runtimeConfig = Object.freeze({
    ...runtimeConfig,
    ...config,
    root: rootDir,
    rootDir,
    packageSrcDir,
    packageRootDir,
    port: Number(config.port ?? runtimeConfig.port),
    siteTitle: config.siteTitle || runtimeConfig.siteTitle,
    comments: pluginConfig.comments,
    aiQa: pluginConfig.aiQa,
  });
  return runtimeConfig;
}

export function getRuntimeConfig() {
  return runtimeConfig;
}

export function getContentRoot() {
  return runtimeConfig.rootDir;
}

export function getPackageSrcDir() {
  return packageSrcDir;
}

export function getPackageRootDir() {
  return packageRootDir;
}
