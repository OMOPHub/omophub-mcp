import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OmopHubClient } from './client/api.js';
import { registerPrompts } from './prompts/index.js';
import { registerResources } from './resources/index.js';
import {
  registerConceptTools,
  registerHierarchyTools,
  registerMappingTools,
  registerSearchTools,
  registerVocabularyTools,
} from './tools/index.js';
import { logger } from './utils/logger.js';
import { VERSION } from './version.js';

export function createServer(apiKey: string, baseUrl?: string): McpServer {
  const server = new McpServer({
    name: 'omophub',
    version: VERSION,
    description:
      'Access OHDSI standardized medical vocabularies — search concepts, navigate hierarchies, and map between clinical coding systems like SNOMED CT, ICD-10, RxNorm, and LOINC.',
  });

  const client = new OmopHubClient(apiKey, baseUrl);

  // Register all Phase 1 tools
  registerSearchTools(server, client);
  registerConceptTools(server, client);
  registerMappingTools(server, client);
  registerHierarchyTools(server, client);
  registerVocabularyTools(server, client);

  // Register resources and prompts
  registerResources(server, client);
  registerPrompts(server);

  logger.info('OMOPHub MCP server initialized', {
    tools: 6,
    resources: 2,
    prompts: 2,
  });

  return server;
}
