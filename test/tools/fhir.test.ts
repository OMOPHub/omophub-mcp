import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
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

const ALLERGY_VALUE_RESPONSE = {
  success: true,
  data: {
    input: { system: 'http://snomed.info/sct', code: '294499007' },
    resolution: {
      vocabulary_id: 'SNOMED',
      source_concept: {
        concept_id: 4222295,
        concept_name: 'Allergy to penicillin',
        vocabulary_id: 'SNOMED',
      },
      standard_concept: {
        concept_id: 439224,
        concept_name: 'Allergy to drug',
        vocabulary_id: 'SNOMED',
      },
      value_as_concept: {
        concept_id: 1728416,
        concept_name: 'Penicillin G',
        vocabulary_id: 'RxNorm',
      },
      value_target_field: 'value_as_concept_id',
      mapping_type: 'mapped',
      target_table: 'observation',
      domain_resource_alignment: 'aligned',
    },
  },
};

const UNMAPPED_RESPONSE = {
  success: true,
  data: {
    input: { system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9' },
    resolution: {
      vocabulary_id: 'ICD10CM',
      source_concept: {
        concept_id: 45576876,
        concept_name: 'Some non-standard code',
        vocabulary_id: 'ICD10CM',
      },
      standard_concept: {
        concept_id: 0,
        concept_name: 'No matching concept',
        vocabulary_id: '',
      },
      mapping_type: 'unmapped',
      target_table: null,
      domain_resource_alignment: 'not_checked',
    },
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

    it('forwards on_unmapped to the request body', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.post.mockResolvedValueOnce(SNOMED_RESOLVE_RESPONSE);

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve')!;

      await handler({
        system: 'http://snomed.info/sct',
        code: '44054006',
        on_unmapped: 'sentinel',
      });

      expect(client.post).toHaveBeenCalledWith(
        '/fhir/resolve',
        expect.objectContaining({ on_unmapped: 'sentinel' }),
        'fhir_resolve',
      );
    });

    it('surfaces value_as_concept (Maps to value) in the formatted output', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.post.mockResolvedValueOnce(ALLERGY_VALUE_RESPONSE);

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve')!;

      const result = await handler({
        system: 'http://snomed.info/sct',
        code: '294499007',
      });

      expect(result.content[0].text).toContain('Allergy to drug');
      expect(result.content[0].text).toContain('Value concept: Penicillin G (1728416)');
      expect(result.content[0].text).toContain('value_as_concept_id');
    });

    it('presents concept_id 0 as unmapped, not a successful resolution', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.post.mockResolvedValueOnce(UNMAPPED_RESPONSE);

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve')!;

      const result = await handler({
        system: 'http://hl7.org/fhir/sid/icd-10-cm',
        code: 'E11.9',
      });

      expect(result.content[0].text).toContain('Unmapped');
      expect(result.content[0].text).not.toContain('Resolved:');
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

    it('forwards on_unmapped to the request body', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.post.mockResolvedValueOnce(CODEABLE_CONCEPT_RESPONSE);

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve_codeable_concept')!;

      await handler({
        coding: [{ system: 'http://snomed.info/sct', code: '44054006' }],
        on_unmapped: 'sentinel',
      });

      expect(client.post).toHaveBeenCalledWith(
        '/fhir/resolve/codeable-concept',
        expect.objectContaining({ on_unmapped: 'sentinel' }),
        'fhir_resolve_codeable_concept',
      );
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

    it('presents a concept_id 0 best_match as unmapped, not a best match', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.post.mockResolvedValueOnce({
        success: true,
        data: { best_match: UNMAPPED_RESPONSE.data, alternatives: [], unresolved: [] },
      });

      registerFhirTools(server as never, client as never);
      const handler = server.tools.get('fhir_resolve_codeable_concept')!;

      const result = await handler({
        coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9' }],
        on_unmapped: 'sentinel',
      });

      expect(result.content[0].text).toContain('Unmapped');
      expect(result.content[0].text).not.toContain('Best match');
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

    it('rejects coding entries with empty or whitespace-only system/code', () => {
      const server = createMockServer();
      const client = createMockClient();
      registerFhirTools(server as never, client as never);

      // The MCP SDK validates tool input against this Zod shape before the
      // handler runs. The mock discards the shape, so rebuild it from the
      // recorded server.tool(name, desc, shape, handler) call to test it.
      const call = server.tool.mock.calls.find((c) => c[0] === 'fhir_resolve_codeable_concept')!;
      const schema = z.object(call[2] as z.ZodRawShape);

      // Empty or whitespace-only system/code must fail validation.
      expect(schema.safeParse({ coding: [{ system: '', code: '44054006' }] }).success).toBe(false);
      expect(
        schema.safeParse({ coding: [{ system: 'http://snomed.info/sct', code: '' }] }).success,
      ).toBe(false);
      expect(schema.safeParse({ coding: [{ system: '   ', code: '44054006' }] }).success).toBe(
        false,
      );

      // A well-formed coding still passes.
      expect(
        schema.safeParse({ coding: [{ system: 'http://snomed.info/sct', code: '44054006' }] })
          .success,
      ).toBe(true);
    });
  });
});
