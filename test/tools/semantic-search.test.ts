import { describe, expect, it } from 'vitest';
import { registerSemanticSearchTools } from '../../src/tools/semantic-search.js';
import semanticResponse from '../fixtures/semantic-search-response.json';
import { createMockClient, createMockServer } from '../helpers/mock-server.js';

describe('semantic_search', () => {
  it('registers the tool', () => {
    const server = createMockServer();
    const client = createMockClient();
    registerSemanticSearchTools(server as never, client as never);

    expect(server.tool).toHaveBeenCalledTimes(1);
    expect(server.tools.has('semantic_search')).toBe(true);
  });

  it('returns results with similarity scores', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.request.mockResolvedValueOnce(semanticResponse);

    registerSemanticSearchTools(server as never, client as never);
    const handler = server.tools.get('semantic_search')!;

    const result = await handler({ query: 'heart attack', page_size: 10, threshold: 0.5 });

    expect(client.request).toHaveBeenCalledWith(
      '/concepts/semantic-search',
      expect.objectContaining({ query: 'heart attack', page_size: 10, threshold: 0.5 }),
      'semantic_search',
    );
    expect(result.content).toHaveLength(2);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Acute myocardial infarction');
    expect(result.content[0].text).toContain('0.92');
  });

  it('passes optional filters', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.request.mockResolvedValueOnce(semanticResponse);

    registerSemanticSearchTools(server as never, client as never);
    const handler = server.tools.get('semantic_search')!;

    await handler({
      query: 'heart attack',
      vocabulary_ids: 'SNOMED',
      domain_ids: 'Condition',
      standard_concept: 'S',
      page_size: 10,
      threshold: 0.5,
    });

    expect(client.request).toHaveBeenCalledWith(
      '/concepts/semantic-search',
      expect.objectContaining({
        vocabulary_ids: 'SNOMED',
        domain_ids: 'Condition',
        standard_concept: 'S',
      }),
      'semantic_search',
    );
  });

  it('handles empty results', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.request.mockResolvedValueOnce({
      success: true,
      data: { results: [] },
    });

    registerSemanticSearchTools(server as never, client as never);
    const handler = server.tools.get('semantic_search')!;

    const result = await handler({ query: 'xyznotfound', page_size: 10, threshold: 0.5 });

    expect(result.content[0].text).toContain('No semantic matches');
    expect(result.isError).toBeUndefined();
  });

  it('handles missing similarity_score gracefully', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.request.mockResolvedValueOnce({
      success: true,
      data: {
        results: [
          {
            concept_id: 312327,
            concept_name: 'Acute myocardial infarction',
            domain_id: 'Condition',
            vocabulary_id: 'SNOMED',
            concept_code: '57054005',
            standard_concept: 'S',
            // similarity_score intentionally missing
          },
        ],
      },
    });

    registerSemanticSearchTools(server as never, client as never);
    const handler = server.tools.get('semantic_search')!;

    const result = await handler({ query: 'heart attack', page_size: 10, threshold: 0.5 });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('N/A');
  });

  it('returns error content on API failure', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.request.mockRejectedValueOnce(new Error('API error'));

    registerSemanticSearchTools(server as never, client as never);
    const handler = server.tools.get('semantic_search')!;

    const result = await handler({ query: 'test', page_size: 10, threshold: 0.5 });

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(2);
  });
});
