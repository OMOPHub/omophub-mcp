import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerFhirTools } from '../../src/tools/fhir.js';
import { createMockClient, createMockServer } from '../helpers/mock-server.js';

// -- Fixtures ----------------------------------------------------------------

const SNOMED_RESOLVE_RESPONSE = {
  success: true,
  data: {
    input: { system: 'http://snomed.info/sct', code: '44054006', resource_type: 'Condition' },
    resolution: {
      vocabulary_id: 'SNOMED',
      source_concept: {
        concept_id: 201826,
        concept_name: 'Type 2 diabetes mellitus',
        vocabulary_id: 'SNOMED',
      },
      standard_concept: {
        concept_id: 201826,
        concept_name: 'Type 2 diabetes mellitus',
        vocabulary_id: 'SNOMED',
      },
      mapping_type: 'direct',
      target_table: 'condition_occurrence',
      domain_resource_alignment: 'aligned',
    },
  },
  meta: { request_id: 'test', timestamp: '2026-04-10T00:00:00Z', vocab_release: '2025.2' },
};

const CODEABLE_CONCEPT_RESPONSE = {
  success: true,
  data: {
    input: {
      coding: [
        { system: 'http://snomed.info/sct', code: '44054006' },
        { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9' },
      ],
    },
    best_match: SNOMED_RESOLVE_RESPONSE.data,
    alternatives: [],
    unresolved: [],
  },
};

// -- Tests -------------------------------------------------------------------

describe('FHIR tools', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers both FHIR tools', () => {
    const server = createMockServer();
    const client = createMockClient();
    registerFhirTools(server as never, client as never);

    expect(server.tool).toHaveBeenCalledTimes(2);
    expect(server.tools.has('fhir_resolve')).toBe(true);
    expect(server.tools.has('fhir_resolve_codeable_concept')).toBe(true);
  });

  // -- fhir_resolve -----------------------------------------------------------

  describe('fhir_resolve', () => {
    it('calls POST /fhir/resolve with correct body and returns text + JSON', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.post.mockResolvedValueOnce(SNOMED_RESOLVE_RESPONSE);

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve')!;

      const result = await handler({
        system: 'http://snomed.info/sct',
        code: '44054006',
        resource_type: 'Condition',
      });

      expect(client.post).toHaveBeenCalledWith(
        '/fhir/resolve',
        expect.objectContaining({
          system: 'http://snomed.info/sct',
          code: '44054006',
          resource_type: 'Condition',
        }),
        'fhir_resolve',
      );
      expect(result.content).toHaveLength(2);
      expect(result.content[0].text).toContain('Type 2 diabetes mellitus');
      expect(result.content[0].text).toContain('condition_occurrence');
      expect(result.isError).toBeUndefined();
    });

    it('includes quality and recommendations when requested', async () => {
      const server = createMockServer();
      const client = createMockClient();
      const recsResponse = {
        ...SNOMED_RESOLVE_RESPONSE,
        data: {
          ...SNOMED_RESOLVE_RESPONSE.data,
          resolution: {
            ...SNOMED_RESOLVE_RESPONSE.data.resolution,
            mapping_quality: 'high',
            similarity_score: 0.95,
            recommendations: [
              {
                concept_id: 4193704,
                concept_name: 'Hyperglycemia',
                relationship_id: 'Has finding',
              },
            ],
          },
        },
      };
      client.post.mockResolvedValueOnce(recsResponse);

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve')!;

      const result = await handler({
        system: 'http://snomed.info/sct',
        code: '44054006',
        include_recommendations: true,
        include_quality: true,
      });

      expect(client.post).toHaveBeenCalledWith(
        '/fhir/resolve',
        expect.objectContaining({
          include_recommendations: true,
          include_quality: true,
        }),
        'fhir_resolve',
      );
      expect(result.content[0].text).toContain('Quality: high');
      expect(result.content[0].text).toContain('Hyperglycemia');
      expect(result.content[0].text).toContain('0.95');
    });

    it('omits undefined optional params from the body', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.post.mockResolvedValueOnce(SNOMED_RESOLVE_RESPONSE);

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve')!;

      await handler({ system: 'http://snomed.info/sct', code: '44054006' });

      const body = client.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.system).toBe('http://snomed.info/sct');
      expect(body.code).toBe('44054006');
      // Falsy/default booleans should not be in the body
      expect(body.include_recommendations).toBeUndefined();
      expect(body.include_quality).toBeUndefined();
      expect(body.resource_type).toBeUndefined();
    });

    it('handles missing resolution data gracefully', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.post.mockResolvedValueOnce({ success: true, data: {} });

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve')!;

      const result = await handler({ display: 'something' });

      expect(result.content[0].text).toContain('Resolution failed');
    });

    it('returns error content on API failure', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.post.mockRejectedValueOnce(new Error('API error'));

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve')!;

      const result = await handler({ system: 'http://bad.uri', code: '123' });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(2);
    });
  });

  // -- fhir_resolve_codeable_concept ------------------------------------------

  describe('fhir_resolve_codeable_concept', () => {
    it('calls POST /fhir/resolve/codeable-concept and returns best_match text', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.post.mockResolvedValueOnce(CODEABLE_CONCEPT_RESPONSE);

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve_codeable_concept')!;

      const result = await handler({
        coding: [
          { system: 'http://snomed.info/sct', code: '44054006' },
          { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9' },
        ],
        resource_type: 'Condition',
      });

      expect(client.post).toHaveBeenCalledWith(
        '/fhir/resolve/codeable-concept',
        expect.objectContaining({
          coding: expect.any(Array),
          resource_type: 'Condition',
        }),
        'fhir_resolve_codeable_concept',
      );
      expect(result.content[0].text).toContain('Best match');
      expect(result.content[0].text).toContain('Type 2 diabetes mellitus');
    });

    it('passes text fallback and enrichment flags', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.post.mockResolvedValueOnce(CODEABLE_CONCEPT_RESPONSE);

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve_codeable_concept')!;

      await handler({
        coding: [{ system: 'http://loinc.org', code: '99999-9' }],
        text: 'Blood Sugar',
        include_recommendations: true,
      });

      const body = client.post.mock.calls[0][1] as Record<string, unknown>;
      expect(body.text).toBe('Blood Sugar');
      expect(body.include_recommendations).toBe(true);
    });

    it('handles null best_match gracefully', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.post.mockResolvedValueOnce({
        success: true,
        data: { best_match: null, alternatives: [], unresolved: [] },
      });

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve_codeable_concept')!;

      const result = await handler({
        coding: [{ system: 'http://loinc.org', code: '99999-9' }],
      });

      expect(result.content[0].text).toContain('No resolution found');
    });

    it('returns error content on API failure', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.post.mockRejectedValueOnce(new Error('forbidden'));

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve_codeable_concept')!;

      const result = await handler({
        coding: [{ system: 'http://www.ama-assn.org/go/cpt', code: '99213' }],
      });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(2);
    });
  });
});
