import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import { resolveClient } from '../client/resolve.js';
import { formatErrorForMcp } from '../utils/errors.js';

interface FhirResolution {
  vocabulary_id: string | null;
  source_concept: { concept_id: number; concept_name: string; vocabulary_id: string };
  standard_concept: { concept_id: number; concept_name: string; vocabulary_id: string };
  // Value concept for composite source concepts decomposed via `Maps to value`
  // (HL7 FHIR-to-OMOP IG Value-as-Concept pattern).
  value_as_concept?: { concept_id: number; concept_name: string; vocabulary_id: string };
  value_target_field?: string;
  mapping_type: string;
  target_table: string | null;
  domain_resource_alignment: string;
  similarity_score?: number;
  mapping_quality?: string;
  recommendations?: Array<{ concept_id: number; concept_name: string; relationship_id: string }>;
  // Set when a FHIR administrative code resolved via an IG ConceptMap.
  concept_map_id?: string;
  mapping_note?: string;
}

interface FhirResolveResponse {
  input: Record<string, unknown>;
  resolution: FhirResolution;
}

interface FhirCodeableConceptResponse {
  input: Record<string, unknown>;
  best_match: FhirResolveResponse | null;
  alternatives: FhirResolveResponse[];
  unresolved: Array<Record<string, unknown>>;
}

function formatResolution(res: FhirResolution): string {
  // concept_id 0 is the OMOP "no matching concept" sentinel — surface it as
  // unmapped rather than presenting it as a successful resolution.
  const header =
    res.standard_concept.concept_id === 0
      ? 'Unmapped: no OMOP standard concept (concept_id 0) for this input'
      : `Resolved: ${res.standard_concept.concept_name} (ID: ${res.standard_concept.concept_id})`;
  const lines = [
    header,
    `Vocabulary: ${res.vocabulary_id ?? 'N/A'} | Type: ${res.mapping_type}`,
    `Target table: ${res.target_table ?? 'unknown'} | Alignment: ${res.domain_resource_alignment}`,
  ];
  if (res.similarity_score !== undefined) {
    lines.push(`Similarity: ${res.similarity_score.toFixed(2)}`);
  }
  if (res.mapping_quality) {
    lines.push(`Quality: ${res.mapping_quality}`);
  }
  if (res.value_as_concept) {
    lines.push(
      `Value concept: ${res.value_as_concept.concept_name} (${res.value_as_concept.concept_id}) → ${res.value_target_field ?? 'value_as_concept_id'}`,
    );
  }
  if (res.concept_map_id) {
    lines.push(`Via IG ConceptMap: ${res.concept_map_id}`);
  }
  if (res.mapping_note) {
    lines.push(`Note: ${res.mapping_note}`);
  }
  if (res.recommendations && res.recommendations.length > 0) {
    lines.push(`Recommendations (${res.recommendations.length}):`);
    for (const rec of res.recommendations.slice(0, 5)) {
      lines.push(`  - ${rec.concept_name} (${rec.concept_id}) via ${rec.relationship_id}`);
    }
  }
  return lines.join('\n');
}

export function registerFhirTools(server: McpServer, client: OmopHubClient): void {
  server.tool(
    'fhir_resolve',
    "Resolve a FHIR coded value (system URI + code) to its OMOP standard concept and CDM target table. Supports text-only input via semantic search fallback and optional Phoebe recommendations. Examples: system='http://snomed.info/sct' code='44054006' for Type 2 diabetes, or display='heart attack' for text-only resolution.",
    {
      system: z
        .string()
        .optional()
        .describe('FHIR code system URI (e.g. http://snomed.info/sct, http://loinc.org)'),
      code: z.string().optional().describe('Code value from the FHIR Coding'),
      display: z
        .string()
        .optional()
        .describe('Display text for semantic search fallback when code is unavailable'),
      vocabulary_id: z
        .string()
        .optional()
        .describe('Direct OMOP vocabulary_id (e.g. SNOMED, ICD10CM), bypasses URI resolution'),
      resource_type: z
        .string()
        .optional()
        .describe(
          'FHIR resource type (Condition, Observation, MedicationRequest, Procedure, etc.)',
        ),
      include_recommendations: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include Phoebe-recommended related concepts'),
      include_quality: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include mapping quality signal (high/medium/low/manual_review)'),
      on_unmapped: z
        .enum(['error', 'sentinel'])
        .optional()
        .describe(
          "Behavior when nothing resolves: 'error' (default, 404) or 'sentinel' (return a concept_id 0 record)",
        ),
    },
    async (params, extra) => {
      try {
        const rc = resolveClient(extra, client);
        const body: Record<string, unknown> = {};
        if (params.system) body.system = params.system;
        if (params.code) body.code = params.code;
        if (params.display) body.display = params.display;
        if (params.vocabulary_id) body.vocabulary_id = params.vocabulary_id;
        if (params.resource_type) body.resource_type = params.resource_type;
        if (params.include_recommendations) body.include_recommendations = true;
        if (params.include_quality) body.include_quality = true;
        if (params.on_unmapped) body.on_unmapped = params.on_unmapped;

        const response = await rc.post<FhirResolveResponse>('/fhir/resolve', body, 'fhir_resolve');

        const res = response.data?.resolution;
        const text = res ? formatResolution(res) : 'Resolution failed — no data returned';

        return {
          content: [
            { type: 'text' as const, text },
            { type: 'text' as const, text: JSON.stringify(response, null, 2) },
          ],
        };
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'fhir_resolve');
        return {
          content: [
            { type: 'text' as const, text },
            { type: 'text' as const, text: json },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'fhir_resolve_codeable_concept',
    'Resolve a FHIR CodeableConcept with multiple codings. Picks the best match per OHDSI vocabulary preference (SNOMED > RxNorm > LOINC > CVX > ICD-10). Falls back to the text field via semantic search if no coding resolves.',
    {
      coding: z
        .array(
          z.object({
            system: z.string().trim().min(1).describe('FHIR code system URI'),
            code: z.string().trim().min(1).describe('Code value'),
            display: z.string().optional().describe('Display text'),
            user_selected: z
              .boolean()
              .optional()
              .describe('FHIR Coding.userSelected — wins over vocabulary preference when set'),
          }),
        )
        .min(1)
        .max(20)
        .describe('Array of FHIR Coding entries from the CodeableConcept'),
      text: z
        .string()
        .optional()
        .describe('CodeableConcept.text — semantic fallback if no coding resolves'),
      resource_type: z.string().optional().describe('FHIR resource type'),
      include_recommendations: z.boolean().optional().default(false),
      include_quality: z.boolean().optional().default(false),
      on_unmapped: z
        .enum(['error', 'sentinel'])
        .optional()
        .describe(
          "Behavior when nothing resolves: 'error' (default, 404) or 'sentinel' (concept_id 0 record)",
        ),
    },
    async (params, extra) => {
      try {
        const rc = resolveClient(extra, client);
        const body: Record<string, unknown> = { coding: params.coding };
        if (params.text) body.text = params.text;
        if (params.resource_type) body.resource_type = params.resource_type;
        if (params.include_recommendations) body.include_recommendations = true;
        if (params.include_quality) body.include_quality = true;
        if (params.on_unmapped) body.on_unmapped = params.on_unmapped;

        const response = await rc.post<FhirCodeableConceptResponse>(
          '/fhir/resolve/codeable-concept',
          body,
          'fhir_resolve_codeable_concept',
        );

        const best = response.data?.best_match?.resolution;
        const altCount = response.data?.alternatives?.length ?? 0;
        const text = best
          ? `Best match: ${best.standard_concept.concept_name} (${best.source_concept.vocabulary_id})\n` +
            `Target table: ${best.target_table ?? 'unknown'} | Alternatives: ${altCount}`
          : 'No resolution found — all codings failed to resolve';

        return {
          content: [
            { type: 'text' as const, text },
            { type: 'text' as const, text: JSON.stringify(response, null, 2) },
          ],
        };
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'fhir_resolve_codeable_concept');
        return {
          content: [
            { type: 'text' as const, text },
            { type: 'text' as const, text: json },
          ],
          isError: true,
        };
      }
    },
  );
}
