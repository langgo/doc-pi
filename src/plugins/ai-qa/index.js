import { apiRoutes } from './server/api.js';
import { configure } from './server/session-manager.js';

/**
 * Create the AI QA plugin. Accepts configuration from the caller (server.js),
 * keeping plugin code decoupled from where config files live.
 *
 * @param {{ agentDir: string, persistThinking?: boolean }} options
 */
export default function createPlugin({ agentDir, persistThinking } = {}) {
  configure({ agentDir, persistThinking });

  return {
    name: 'ai-qa',
    apiRoutes,
    pageInjections: {
      cssUrls: ['/plugins/ai-qa/client/ai-qa.css'],
      jsUrls: ['/plugins/ai-qa/client/ai-qa.js', '/plugins/ai-qa/client/register.js'],
    },
  };
}
