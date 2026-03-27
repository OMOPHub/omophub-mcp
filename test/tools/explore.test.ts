import { describe, expect, it } from 'vitest';
import { registerExploreTools } from '../../src/tools/explore.js';
import conceptResponse from '../fixtures/concept-response.json';
import hierarchyResponse from '../fixtures/hierarchy-response.json';
import relationshipsResponse from '../fixtures/relationships-response.json';
import { createMockClient, createMockServer } from '../helpers/mock-server.js';

describe('explore_concept', () => {
  it('registers the tool', () => {
    const server = createMockServer();
    const client = createMockClient();
    registerExploreTools(server as never, client as never);

    expect(server.tool).toHaveBeenCalledTimes(1);
    expect(server.tools.has('explore_concept')).toBe(true);
  });

  it('returns concept details + hierarchy + mappings', async () => {
    const server = createMockServer();
    const client = createMockClient();

    // Three parallel requests: concept, hierarchy, relationships
    client.request
      .mockResolvedValueOnce(conceptResponse)
      .mockResolvedValueOnce(hierarchyResponse)
      .mockResolvedValueOnce(relationshipsResponse);

    registerExploreTools(server as never, client as never);
    const handler = server.tools.get('explore_concept')!;

    const result = await handler({
      concept_id: 201826,
      include_hierarchy: true,
      hierarchy_levels: 2,
      include_mappings: true,
    });

    expect(client.request).toHaveBeenCalledTimes(3);
    expect(result.content).toHaveLength(2);
    expect(result.isError).toBeUndefined();

    const text = result.content[0].text;
    expect(text).toContain('Type 2 diabetes mellitus');
    expect(text).toContain('Hierarchy');
    expect(text).toContain('Diabetes mellitus');
    expect(text).toContain('Cross-Vocabulary Mappings');
    expect(text).toContain('ICD10CM');
  });

  it('handles concept not found', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.request.mockRejectedValue(new Error('Not found'));

    registerExploreTools(server as never, client as never);
    const handler = server.tools.get('explore_concept')!;

    const result = await handler({
      concept_id: 999999,
      include_hierarchy: true,
      hierarchy_levels: 2,
      include_mappings: true,
    });

    expect(result.isError).toBe(true);
  });

  it('respects include_hierarchy=false', async () => {
    const server = createMockServer();
    const client = createMockClient();

    // Only concept + relationships (no hierarchy)
    client.request
      .mockResolvedValueOnce(conceptResponse)
      .mockResolvedValueOnce(relationshipsResponse);

    registerExploreTools(server as never, client as never);
    const handler = server.tools.get('explore_concept')!;

    const result = await handler({
      concept_id: 201826,
      include_hierarchy: false,
      hierarchy_levels: 2,
      include_mappings: true,
    });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeUndefined();

    const text = result.content[0].text;
    expect(text).toContain('Type 2 diabetes mellitus');
    expect(text).not.toContain('Ancestors');
  });

  it('respects include_mappings=false', async () => {
    const server = createMockServer();
    const client = createMockClient();

    // Only concept + hierarchy (no relationships)
    client.request.mockResolvedValueOnce(conceptResponse).mockResolvedValueOnce(hierarchyResponse);

    registerExploreTools(server as never, client as never);
    const handler = server.tools.get('explore_concept')!;

    const result = await handler({
      concept_id: 201826,
      include_hierarchy: true,
      hierarchy_levels: 2,
      include_mappings: false,
    });

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(result.isError).toBeUndefined();

    const text = result.content[0].text;
    expect(text).toContain('Hierarchy');
    expect(text).not.toContain('Cross-Vocabulary Mappings');
  });

  it('filters mappings by target_vocabularies', async () => {
    const server = createMockServer();
    const client = createMockClient();

    client.request
      .mockResolvedValueOnce(conceptResponse)
      .mockResolvedValueOnce(hierarchyResponse)
      .mockResolvedValueOnce(relationshipsResponse);

    registerExploreTools(server as never, client as never);
    const handler = server.tools.get('explore_concept')!;

    const result = await handler({
      concept_id: 201826,
      include_hierarchy: true,
      hierarchy_levels: 2,
      include_mappings: true,
      target_vocabularies: 'ICD10CM',
    });

    const text = result.content[0].text;
    expect(text).toContain('ICD10CM');
    expect(text).not.toContain('MeSH');
  });

  it('propagates original error when concept fetch fails', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.request.mockRejectedValue(new Error('Network error'));

    registerExploreTools(server as never, client as never);
    const handler = server.tools.get('explore_concept')!;

    const result = await handler({
      concept_id: 201826,
      include_hierarchy: true,
      hierarchy_levels: 2,
      include_mappings: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(2);
    // Should get the formatted error, not a generic "not found"
    expect(result.content[0].text).toContain('failed');
    expect(result.content[0].text).not.toContain('not found');
  });
});
