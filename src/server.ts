import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OmopHubClient } from './client/api.js';
import { registerPrompts } from './prompts/index.js';
import { registerResources } from './resources/index.js';
import {
  registerConceptTools,
  registerExploreTools,
  registerFhirTools,
  registerHierarchyTools,
  registerMappingTools,
  registerSearchTools,
  registerSemanticSearchTools,
  registerSimilarTools,
  registerVocabularyTools,
} from './tools/index.js';
import { conceptCache, hierarchyCache, vocabularyCache } from './utils/cache.js';
import { logger } from './utils/logger.js';
import { VERSION } from './version.js';

export function createServer(
  client: OmopHubClient,
  transport: 'stdio' | 'http' = 'stdio',
): McpServer {
  const server = new McpServer({
    name: 'omophub',
    version: VERSION,
    description:
      'Access OHDSI standardized medical vocabularies — search concepts, navigate hierarchies, and map between clinical coding systems like SNOMED CT, ICD-10, RxNorm, and LOINC.',
  });

  // Register tools
  registerSearchTools(server, client);
  registerSemanticSearchTools(server, client);
  registerSimilarTools(server, client);
  registerConceptTools(server, client, transport === 'stdio' ? conceptCache : null);
  registerExploreTools(server, client);
  registerMappingTools(server, client);
  registerHierarchyTools(server, client, transport === 'stdio' ? hierarchyCache : null);
  registerVocabularyTools(server, client, transport === 'stdio' ? vocabularyCache : null);
  registerFhirTools(server, client);

  // Register resources and prompts
  registerResources(server, client, transport === 'stdio' ? vocabularyCache : null);
  registerPrompts(server);

  logger.info('OMOPHub MCP server initialized', {
    tools: 11,
    resources: 2,
    prompts: 2,
  });

  return server;
}
