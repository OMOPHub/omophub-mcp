import { describe, expect, it } from 'vitest';
import { registerSimilarTools } from '../../src/tools/similar.js';
import similarResponse from '../fixtures/similar-response.json';
import { createMockClient, createMockServer } from '../helpers/mock-server.js';

describe('find_similar_concepts', () => {
  it('registers the tool', () => {
    const server = createMockServer();
    const client = createMockClient();
    registerSimilarTools(server as never, client as never);

    expect(server.tool).toHaveBeenCalledTimes(1);
    expect(server.tools.has('find_similar_concepts')).toBe(true);
  });

  it('returns similar concepts by concept_id', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce(similarResponse);

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    const result = await handler({
      concept_id: 201826,
      algorithm: 'hybrid',
      similarity_threshold: 0.7,
      page_size: 20,
    });

    expect(client.post).toHaveBeenCalledWith(
      '/search/similar',
      expect.objectContaining({ concept_id: 201826, algorithm: 'hybrid' }),
      'find_similar_concepts',
    );
    expect(result.content).toHaveLength(2);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Type 2 diabetes mellitus without complication');
  });

  it('returns similar concepts by query', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce(similarResponse);

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    await handler({
      query: 'diabetes',
      algorithm: 'semantic',
      similarity_threshold: 0.7,
      page_size: 20,
    });

    expect(client.post).toHaveBeenCalledWith(
      '/search/similar',
      expect.objectContaining({ query: 'diabetes', algorithm: 'semantic' }),
      'find_similar_concepts',
    );
  });

  it('rejects when multiple input sources provided', async () => {
    const server = createMockServer();
    const client = createMockClient();

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    const result = await handler({
      concept_id: 201826,
      concept_name: 'diabetes',
      algorithm: 'hybrid',
      similarity_threshold: 0.7,
      page_size: 20,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('exactly one');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('rejects when no input source provided', async () => {
    const server = createMockServer();
    const client = createMockClient();

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    const result = await handler({
      algorithm: 'hybrid',
      similarity_threshold: 0.7,
      page_size: 20,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('exactly one');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('filters empty strings from vocabulary_ids and domain_ids', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce(similarResponse);

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    await handler({
      concept_id: 201826,
      vocabulary_ids: 'SNOMED, , ICD10CM',
      domain_ids: ',Condition,',
      algorithm: 'hybrid',
      similarity_threshold: 0.7,
      page_size: 20,
    });

    const body = client.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.vocabulary_ids).toEqual(['SNOMED', 'ICD10CM']);
    expect(body.domain_ids).toEqual(['Condition']);
  });

  it('handles empty results', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce({
      success: true,
      data: {
        similar_concepts: [],
        search_metadata: {
          algorithm_used: 'hybrid',
          similarity_threshold: 0.7,
          results_returned: 0,
        },
      },
    });

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    const result = await handler({
      concept_id: 999999,
      algorithm: 'hybrid',
      similarity_threshold: 0.7,
      page_size: 20,
    });

    expect(result.content[0].text).toContain('No similar concepts');
    expect(result.isError).toBeUndefined();
  });

  it('handles missing similarity_score gracefully', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce({
      success: true,
      data: {
        similar_concepts: [
          {
            concept_id: 4193704,
            concept_name: 'Test concept',
            domain_id: 'Condition',
            vocabulary_id: 'SNOMED',
            concept_class_id: 'Clinical Finding',
            standard_concept: 'S',
            concept_code: '313436004',
            // similarity_score intentionally missing
          },
        ],
        search_metadata: {
          algorithm_used: 'hybrid',
          similarity_threshold: 0.7,
          results_returned: 1,
        },
      },
    });

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    const result = await handler({
      concept_id: 201826,
      algorithm: 'hybrid',
      similarity_threshold: 0.7,
      page_size: 20,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('N/A');
  });

  it('renders the explanation field the API actually emits', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce(similarResponse);

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    const result = await handler({
      concept_id: 201826,
      algorithm: 'semantic',
      similarity_threshold: 0.7,
      page_size: 20,
    });

    // The tool read `similarity_explanation` while the API emitted
    // `explanation`, so explanations silently disappeared from every result.
    expect(result.content[0].text).toContain('Related diabetic complication');
  });

  it('still renders the deprecated similarity_explanation alias', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce({
      success: true,
      data: {
        similar_concepts: [
          {
            concept_id: 443238,
            concept_name: 'Diabetic retinopathy',
            domain_id: 'Condition',
            vocabulary_id: 'SNOMED',
            concept_class_id: 'Clinical Finding',
            standard_concept: 'S',
            concept_code: '422034002',
            similarity_score: 0.85,
            similarity_explanation: 'Legacy field name',
          },
        ],
        search_metadata: {
          algorithm_used: 'semantic',
          similarity_threshold: 0.7,
          results_returned: 1,
        },
      },
    });

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    const result = await handler({
      concept_id: 201826,
      algorithm: 'semantic',
      similarity_threshold: 0.7,
      page_size: 20,
    });

    expect(result.content[0].text).toContain('Legacy field name');
  });

  it('sends the API default algorithm when none is chosen', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce(similarResponse);

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    await handler({ concept_id: 201826 });

    const body = client.post.mock.calls[0][1] as Record<string, unknown>;
    // Was 'hybrid', which is not what the API runs when `algorithm` is omitted.
    expect(body.algorithm).toBe('semantic');
  });

  it('preserves a similarity_threshold of zero', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce(similarResponse);

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    await handler({ concept_id: 201826, similarity_threshold: 0 });

    const body = client.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.similarity_threshold).toBe(0);
  });

  it('forwards page and concept_class_ids', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce(similarResponse);

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    await handler({
      concept_id: 201826,
      page: 3,
      concept_class_ids: 'Clinical Finding, Ingredient',
    });

    const body = client.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.page).toBe(3);
    expect(body.concept_class_ids).toEqual(['Clinical Finding', 'Ingredient']);
  });

  it('says so when hybrid degraded to its lexical half', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce({
      success: true,
      data: {
        similar_concepts: [
          {
            concept_id: 443238,
            concept_name: 'Diabetic retinopathy',
            domain_id: 'Condition',
            vocabulary_id: 'SNOMED',
            concept_class_id: 'Clinical Finding',
            standard_concept: 'S',
            concept_code: '422034002',
            similarity_score: 0.85,
          },
        ],
        search_metadata: {
          algorithm_used: 'lexical',
          degraded_from: 'hybrid',
          similarity_threshold: 0.7,
          results_returned: 1,
        },
      },
    });

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    const result = await handler({ concept_id: 201826, algorithm: 'hybrid' });

    expect(result.content[0].text).toContain('hybrid was requested');
    expect(result.content[0].text).toContain('lexical');
  });

  it('requests explanations when asked', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce(similarResponse);

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    await handler({ concept_id: 201826, include_explanations: true });

    const body = client.post.mock.calls[0][1] as Record<string, unknown>;
    // The formatter renders `explanation`, but the API omits it unless asked -
    // so without this the rendering could only ever fire on a fixture.
    expect(body.include_explanations).toBe(true);
  });

  it('surfaces pagination in both outputs', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce({
      ...similarResponse,
      meta: {
        pagination: {
          page: 2,
          page_size: 20,
          total_items: 55,
          total_pages: 3,
          has_next: true,
          has_previous: true,
        },
      },
    });

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    const result = await handler({ concept_id: 201826, page: 2 });

    // Pagination lives in the envelope; rebuilding the output from
    // `similar_concepts` and `search_metadata` alone dropped it, leaving the
    // `page` argument unusable.
    expect(result.content[0].text).toContain('Page 2 of 3');
    expect(result.content[0].text).toContain('request page 3');
    expect(JSON.parse(result.content[1].text).pagination.has_next).toBe(true);
  });

  it('says when there are no further pages', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockResolvedValueOnce({
      ...similarResponse,
      meta: {
        pagination: {
          page: 1,
          page_size: 20,
          total_items: 2,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        },
      },
    });

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    const result = await handler({ concept_id: 201826 });

    expect(result.content[0].text).toContain('no further pages');
  });

  it('returns error content on API failure', async () => {
    const server = createMockServer();
    const client = createMockClient();
    client.post.mockRejectedValueOnce(new Error('API error'));

    registerSimilarTools(server as never, client as never);
    const handler = server.tools.get('find_similar_concepts')!;

    const result = await handler({
      concept_id: 201826,
      algorithm: 'hybrid',
      similarity_threshold: 0.7,
      page_size: 20,
    });

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(2);
  });
});
