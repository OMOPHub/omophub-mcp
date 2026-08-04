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

  // Regression: mappings used to be selected by fetching the first 100
  // relationships of EVERY type and narrowing in JS. A concept whose first 100
  // relationships were hierarchy links reported "no mappings found" despite
  // having mappings. The narrowing has to happen server-side.
  it('asks the server for mapping relationships rather than filtering after the fact', async () => {
    const server = createMockServer();
    const client = createMockClient();

    client.request
      .mockResolvedValueOnce(conceptResponse)
      .mockResolvedValueOnce(hierarchyResponse)
      .mockResolvedValueOnce(relationshipsResponse);

    registerExploreTools(server as never, client as never);
    const handler = server.tools.get('explore_concept')!;

    await handler({
      concept_id: 201826,
      include_hierarchy: true,
      include_mappings: true,
      target_vocabularies: 'ICD10CM',
    });

    const relationshipsCall = client.request.mock.calls.find((c: unknown[]) =>
      String(c[0]).endsWith('/relationships'),
    );
    expect(relationshipsCall).toBeDefined();
    expect(relationshipsCall![1]).toEqual({
      relationship_ids: 'Maps to,Mapped from',
      vocabulary_ids: 'ICD10CM',
      page_size: 100,
    });
  });

  // Regression: the mappings header counted only the rows in the page it
  // received, so 200 of 309 rendered as "Cross-Vocabulary Mappings (200)" — a
  // truncated set presented as complete, with nothing pointing at the rest.
  it('reports the true total and marks the result partial when more pages exist', async () => {
    const server = createMockServer();
    const client = createMockClient();

    client.request
      .mockResolvedValueOnce(conceptResponse)
      .mockResolvedValueOnce(hierarchyResponse)
      .mockResolvedValueOnce({
        ...relationshipsResponse,
        meta: {
          pagination: {
            page: 1,
            page_size: 200,
            total_items: 309,
            total_pages: 2,
            has_next: true,
            has_previous: false,
          },
        },
      });

    registerExploreTools(server as never, client as never);
    const handler = server.tools.get('explore_concept')!;

    const result = await handler({
      concept_id: 201826,
      include_hierarchy: true,
      include_mappings: true,
    });

    const text = result.content[0].text as string;
    expect(text).toContain('of 309');
    expect(text).toContain('Partial');
    expect(text).toContain('map_concept');

    const json = JSON.parse(result.content[1].text as string);
    expect(json.mappings_truncated).toBe(true);
    expect(json.mappings_pagination.total_items).toBe(309);
  });

  it('does not mark the result partial when the page is the whole set', async () => {
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
      include_mappings: true,
    });

    expect(result.content[0].text as string).not.toContain('Partial');
    expect(JSON.parse(result.content[1].text as string).mappings_truncated).toBe(false);
  });

  it('honours an explicit mappings_page_size', async () => {
    const server = createMockServer();
    const client = createMockClient();

    client.request
      .mockResolvedValueOnce(conceptResponse)
      .mockResolvedValueOnce(relationshipsResponse);

    registerExploreTools(server as never, client as never);
    const handler = server.tools.get('explore_concept')!;

    await handler({
      concept_id: 201826,
      include_hierarchy: false,
      include_mappings: true,
      mappings_page_size: 200,
    });

    const relationshipsCall = client.request.mock.calls.find((c: unknown[]) =>
      String(c[0]).endsWith('/relationships'),
    );
    expect((relationshipsCall![1] as { page_size: number }).page_size).toBe(200);
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
