import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import concept from './fixtures/concept-response.json';
import hierarchy from './fixtures/hierarchy-response.json';
import mappings from './fixtures/mappings-response.json';
import search from './fixtures/search-response.json';
import semantic from './fixtures/semantic-search-response.json';
import similar from './fixtures/similar-response.json';
import vocabularies from './fixtures/vocabularies-response.json';
import { createMockClient } from './helpers/mock-server.js';

it('validates the published inventory and tool results through an SDK client', async () => {
  const api = createMockClient();
  const server = createServer(api as never, 'http');
  const client = new Client({ name: 'contract-test', version: '1' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left);
  await client.connect(right);
  try {
    const id = { concept_id: concept.data.concept_id };
    const coding = { system: 'http://snomed.info/sct', code: '44054006' };
    const resolution = {
      standard_concept: concept.data,
      source_concept: concept.data,
      vocabulary_id: 'SNOMED',
      mapping_type: 'direct',
      domain_resource_alignment: 'aligned',
    };
    const cases: [string, Record<string, unknown>, unknown, boolean?][] = [
      ['get_concept', id, concept],
      ['get_concept_by_code', { vocabulary_id: 'SNOMED', concept_code: coding.code }, concept],
      ['search_concepts', { query: 'diabetes' }, search],
      ['semantic_search', { query: 'heart attack' }, semantic],
      ['find_similar_concepts', id, similar, true],
      ['explore_concept', { ...id, include_hierarchy: false, include_mappings: false }, concept],
      ['get_hierarchy', id, hierarchy],
      ['map_concept', id, mappings],
      ['list_vocabularies', {}, vocabularies],
      ['fhir_resolve', coding, { success: true, data: { input: coding, resolution } }, true],
      [
        'fhir_resolve_codeable_concept',
        { coding: [coding] },
        {
          success: true,
          data: { best_match: { input: coding, resolution }, alternatives: [], unresolved: [] },
        },
        true,
      ],
    ];
    const inventory = await client.listTools();
    expect(inventory.tools.map((tool) => tool.name).sort()).toEqual(
      cases.map(([name]) => name).sort(),
    );
    for (const tool of inventory.tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
      expect(tool.outputSchema?.type).toBe('object');
    }
    for (const [name, args, response, post] of cases) {
      (post ? api.post : api.request).mockResolvedValueOnce(response);
      const result = await client.callTool({ name, arguments: args }).catch((error) => {
        throw new Error(name, { cause: error });
      });
      expect(result.isError, name + JSON.stringify(result.content)).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
    }

    api.request.mockClear().mockResolvedValue(vocabularies);
    for (let i = 0; i < 2; i++) {
      await client.callTool({ name: 'list_vocabularies', arguments: {} });
      await client.readResource({ uri: 'omophub://vocabularies' });
    }
    expect(api.request).toHaveBeenCalledTimes(4);
    api.request.mockClear();
    const rejected = await client.callTool({
      name: 'search_concepts',
      arguments: { query: 'MRN: example-fixture' },
    });
    expect(rejected.isError).toBe(true);
    expect(JSON.stringify(rejected.content)).toContain('PHI_NOT_ACCEPTED');
    expect(JSON.stringify(rejected)).not.toContain('example-fixture');
    expect(api.request).not.toHaveBeenCalled();
    api.post.mockClear();
    const nested = await client.callTool({
      name: 'fhir_resolve_codeable_concept',
      arguments: {
        coding: [{ ...coding, display: '{"resourceType":"Patient","id":"example-fixture"}' }],
      },
    });
    expect(nested.isError).toBe(true);
    expect(JSON.stringify(nested.content)).toContain('PHI_NOT_ACCEPTED');
    expect(JSON.stringify(nested)).not.toContain('example-fixture');
    expect(api.post).not.toHaveBeenCalled();

    for (const query of [
      '{"resourceType":"Procedure","id":"fixture"}',
      'medicalRecordNumber: fixture',
    ]) {
      const result = await client.callTool({ name: 'semantic_search', arguments: { query } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain('PHI_NOT_ACCEPTED');
      expect(api.request).not.toHaveBeenCalled();
      expect(api.post).not.toHaveBeenCalled();
    }

    const fhirInput = {
      ...coding,
      resource_type: 'Condition',
      vocabulary_id: 'SNOMED',
      on_unmapped: 'sentinel',
    };
    const flagCases = [
      [{ include_quality: 'false', include_recommendations: 'false' }, {}],
      [{ include_quality: 'true', include_recommendations: false }, { include_quality: true }],
      [
        { include_quality: false, include_recommendations: 'true' },
        { include_recommendations: true },
      ],
    ] as const;
    for (const [flags, expected] of flagCases) {
      api.post.mockClear().mockResolvedValueOnce({ success: true, data: { resolution } });
      const result = await client.callTool({
        name: 'fhir_resolve',
        arguments: { ...fhirInput, ...flags },
      });
      expect(result.isError).toBeFalsy();
      expect(api.post).toHaveBeenCalledExactlyOnceWith(
        '/fhir/resolve',
        { ...fhirInput, ...expected },
        'fhir_resolve',
      );
    }
    const nullFlags = { include_quality: 'null', include_recommendations: 'null' };
    for (const [input, expected] of [
      [
        {
          ...coding,
          resource_type: 'Condition',
          on_unmapped: 'sentinel',
          display: 'null',
          vocabulary_id: 'null',
          ...nullFlags,
        },
        { ...coding, resource_type: 'Condition', on_unmapped: 'sentinel' },
      ],
      [
        {
          display: 'heart attack',
          system: 'null',
          code: 'null',
          resource_type: 'null',
          vocabulary_id: 'null',
          on_unmapped: 'null',
          ...nullFlags,
        },
        { display: 'heart attack' },
      ],
    ]) {
      api.post.mockClear().mockResolvedValueOnce({ success: true, data: { resolution } });
      const result = await client.callTool({ name: 'fhir_resolve', arguments: input });
      expect(result.isError).toBeFalsy();
      expect(api.post).toHaveBeenCalledExactlyOnceWith('/fhir/resolve', expected, 'fhir_resolve');
    }
    api.post.mockClear();
    for (const flags of [{ include_quality: 'no' }, { include_recommendations: 0 }]) {
      const rejected = await client.callTool({
        name: 'fhir_resolve',
        arguments: { ...fhirInput, ...flags },
      });
      expect(rejected.isError).toBe(true);
    }
    expect(api.post).not.toHaveBeenCalled();

    api.request.mockClear().mockResolvedValueOnce(mappings);
    const mappingPage = await client.callTool({
      name: 'map_concept',
      arguments: { ...id, page: '1', page_size: '100' },
    });
    expect(mappingPage.isError).toBeFalsy();
    expect(api.request).toHaveBeenCalledWith(
      `/concepts/${id.concept_id}/mappings`,
      { page: 1, page_size: 100 },
      'map_concept',
    );
    api.request.mockClear();
    const invalidPage = await client.callTool({
      name: 'map_concept',
      arguments: { ...id, page: '1.5', page_size: '201' },
    });
    expect(invalidPage.isError).toBe(true);
    expect(api.request).not.toHaveBeenCalled();

    const pagination = {
      page: 2,
      page_size: 2,
      total_pages: 2,
      total_items: 4,
      has_next: false,
      has_previous: true,
    };
    api.request.mockResolvedValue({
      ...hierarchy,
      data: { ...hierarchy.data, hierarchy_summary: { truncated: true } },
      meta: { pagination },
    });
    const page = await client.callTool({
      name: 'get_hierarchy',
      arguments: {
        concept_id: String(id.concept_id),
        direction: 'down',
        page: '2',
        page_size: '2',
      },
    });
    expect(page.structuredContent).toMatchObject({ truncated: true, pagination, has_more: false });
    expect(api.request).toHaveBeenCalledWith(
      '/concepts/201826/descendants',
      { page: 2, page_size: 2 },
      'get_hierarchy',
    );
    expect(page.structuredContent).not.toHaveProperty('next_page');
    expect(page.content[0]).toMatchObject({ text: expect.stringContaining('Truncated: true') });
    for (const invalid of ['0', '201', '1.5', '1e2', '', true]) {
      const rejected = await client.callTool({
        name: 'get_hierarchy',
        arguments: { ...id, direction: 'down', page_size: invalid },
      });
      expect(rejected.isError).toBe(true);
    }
    const combined = await client.callTool({
      name: 'get_hierarchy',
      arguments: { ...id, direction: 'both', page: 2 },
    });
    expect(combined.isError).toBe(true);
    expect(api.request).toHaveBeenCalledTimes(1);
    api.request.mockResolvedValueOnce({
      ...hierarchy,
      data: { ...hierarchy.data, hierarchy_summary: { truncated: false } },
      meta: { pagination: { ...pagination, page: 1, has_next: true, has_previous: false } },
    });
    const first = await client.callTool({
      name: 'get_hierarchy',
      arguments: { ...id, direction: 'down', page: 1, page_size: 2 },
    });
    expect(first.structuredContent).toMatchObject({
      truncated: false,
      has_more: true,
      next_page: 2,
    });
    expect(first.content[0]).toMatchObject({ text: expect.stringContaining('Truncated: false') });
  } finally {
    await client.close();
    await server.close();
  }
});
