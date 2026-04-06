import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/tools/search.js', () => ({
  registerSearchTools: vi.fn(),
}));
vi.mock('../src/tools/concepts.js', () => ({
  registerConceptTools: vi.fn(),
}));
vi.mock('../src/tools/mappings.js', () => ({
  registerMappingTools: vi.fn(),
}));
vi.mock('../src/tools/hierarchy.js', () => ({
  registerHierarchyTools: vi.fn(),
}));
vi.mock('../src/tools/vocabularies.js', () => ({
  registerVocabularyTools: vi.fn(),
}));
vi.mock('../src/resources/index.js', () => ({
  registerResources: vi.fn(),
}));
vi.mock('../src/prompts/index.js', () => ({
  registerPrompts: vi.fn(),
}));

import { OmopHubClient } from '../src/client/api.js';
import { registerPrompts } from '../src/prompts/index.js';
import { registerResources } from '../src/resources/index.js';
import { createServer } from '../src/server.js';
import { registerConceptTools } from '../src/tools/concepts.js';
import { registerHierarchyTools } from '../src/tools/hierarchy.js';
import { registerMappingTools } from '../src/tools/mappings.js';
import { registerSearchTools } from '../src/tools/search.js';
import { registerVocabularyTools } from '../src/tools/vocabularies.js';

describe('createServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an McpServer instance', () => {
    const client = new OmopHubClient('test-api-key');
    const server = createServer(client);
    expect(server).toBeDefined();
    expect(server).toHaveProperty('connect');
  });

  it('calls all tool registration functions', () => {
    const client = new OmopHubClient('test-api-key');
    createServer(client);

    expect(registerSearchTools).toHaveBeenCalledOnce();
    expect(registerConceptTools).toHaveBeenCalledOnce();
    expect(registerMappingTools).toHaveBeenCalledOnce();
    expect(registerHierarchyTools).toHaveBeenCalledOnce();
    expect(registerVocabularyTools).toHaveBeenCalledOnce();
  });

  it('calls registerResources and registerPrompts', () => {
    const client = new OmopHubClient('test-api-key');
    createServer(client);

    expect(registerResources).toHaveBeenCalledOnce();
    expect(registerPrompts).toHaveBeenCalledOnce();
  });

  it('passes client to registration functions', () => {
    const client = new OmopHubClient('test-api-key', 'https://custom.api.com/v1');
    createServer(client);

    expect(registerSearchTools).toHaveBeenCalledWith(expect.anything(), client);
  });
});
