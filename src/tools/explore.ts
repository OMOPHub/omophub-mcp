import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { OmopHubClient } from '../client/api.js';
import { resolveClient } from '../client/resolve.js';
import type { Concept, PaginationMeta, RawHierarchyResponse } from '../client/types.js';
import { formatErrorForMcp } from '../utils/errors.js';

interface RelationshipItem {
  relationship_id: string;
  relationship_name?: string;
  concept_2?: {
    concept_id: number;
    concept_name: string;
    vocabulary_id: string;
    concept_code: string;
    domain_id: string;
    standard_concept: string | null;
    concept_class_id: string;
  };
}

interface RelationshipsData {
  relationships: RelationshipItem[];
}

export function registerExploreTools(server: McpServer, client: OmopHubClient): void {
  server.tool(
    'explore_concept',
    'Get a comprehensive view of a medical concept in one call: detailed info, ancestors/descendants hierarchy, and cross-vocabulary mappings. Use this instead of calling get_concept + get_hierarchy + map_concept separately. Ideal for understanding what a concept is, where it sits in the classification tree, and how it maps to other coding systems.',
    {
      concept_id: z.number().describe('The OMOP concept_id to explore'),
      include_hierarchy: z
        .boolean()
        .default(true)
        .describe('Include ancestors and descendants. Default true.'),
      hierarchy_levels: z
        .number()
        .min(1)
        .max(5)
        .default(2)
        .describe('How many hierarchy levels to fetch (1-5, default 2)'),
      include_mappings: z
        .boolean()
        .default(true)
        .describe('Include cross-vocabulary mappings. Default true.'),
      target_vocabularies: z
        .string()
        .max(200)
        .optional()
        .describe(
          "Comma-separated vocabulary IDs to filter mappings. Examples: 'ICD10CM', 'SNOMED'.",
        ),
      // Was hardcoded at 100 with no caller control. 200 is the API's effective
      // ceiling for GET requests (paginationLimitsMiddleware clamps page_size to
      // CACHE_LIMITS.MAX_PAGE_SIZE), so asking for more would silently return 200.
      mappings_page_size: z
        .number()
        .min(1)
        .max(200)
        .default(100)
        .describe(
          'Maximum mappings to fetch (1-200, default 100). This is an overview tool — for a complete code list use map_concept and page through it.',
        ),
    },
    async (
      {
        concept_id,
        include_hierarchy,
        include_mappings,
        hierarchy_levels,
        target_vocabularies,
        mappings_page_size,
      },
      extra,
    ) => {
      try {
        const rc = resolveClient(extra, client);
        // Build parallel requests
        const requests: Promise<unknown>[] = [];

        // 1. Always fetch concept details
        const conceptReq = rc.request<Concept>(`/concepts/${concept_id}`, {}, 'explore_concept');
        requests.push(conceptReq);

        // 2. Optionally fetch hierarchy
        let hierarchyReq: Promise<unknown> | null = null;
        if (include_hierarchy !== false) {
          const levels = hierarchy_levels ?? 2;
          hierarchyReq = rc.request<RawHierarchyResponse>(
            `/concepts/${concept_id}/hierarchy`,
            { max_levels: levels },
            'explore_concept',
          );
          requests.push(hierarchyReq);
        }

        // 3. Optionally fetch mappings via the relationships endpoint.
        //
        // /relationships rather than /mappings is a deliberate choice, not a
        // workaround: /mappings covers only the 'Maps to' direction, while an
        // explore view wants 'Mapped from' too. (The schema-resolution bug that
        // originally motivated this has since been fixed, so either endpoint
        // works now — this one is simply the better fit.)
        //
        // Filter SERVER-side. This previously fetched the first 100 relationships
        // of every type and narrowed to mappings in JS afterwards, so a concept
        // whose first 100 relationships happened to be hierarchy links reported
        // "no mappings found" even when mappings existed.
        let mappingsReq: Promise<unknown> | null = null;
        if (include_mappings !== false) {
          const mappingParams: Record<string, string | number> = {
            relationship_ids: 'Maps to,Mapped from',
            page_size: mappings_page_size ?? 100,
          };
          if (target_vocabularies) mappingParams.vocabulary_ids = target_vocabularies;

          mappingsReq = rc.request<RelationshipsData>(
            `/concepts/${concept_id}/relationships`,
            mappingParams,
            'explore_concept',
          );
          requests.push(mappingsReq);
        }

        // Execute all in parallel
        const settled = await Promise.allSettled(requests);

        // Extract results
        const conceptResult = settled[0];
        const concept =
          conceptResult.status === 'fulfilled'
            ? (conceptResult.value as { data: Concept }).data
            : null;

        let hierarchy: RawHierarchyResponse | null = null;
        let relationshipsData: RelationshipsData | null = null;
        let mappingsPagination: PaginationMeta | null = null;
        let mappingsTruncated = false;

        let idx = 1;
        if (hierarchyReq) {
          const r = settled[idx++];
          if (r.status === 'fulfilled') {
            hierarchy = (r.value as { data: RawHierarchyResponse }).data;
          }
        }
        if (mappingsReq) {
          const r = settled[idx];
          if (r.status === 'fulfilled') {
            const res = r.value as {
              data: RelationshipsData;
              meta?: { pagination?: PaginationMeta };
            };
            relationshipsData = res.data;
            // Keep the pagination block. Discarding it is what let this tool
            // render a truncated page under a header that counted only the rows
            // it happened to receive.
            mappingsPagination = res.meta?.pagination ?? null;
          }
        }

        if (!concept) {
          // If the request was rejected, propagate the original error
          if (conceptResult.status === 'rejected') {
            const { text, json } = formatErrorForMcp(conceptResult.reason, 'explore_concept');
            return {
              content: [
                { type: 'text' as const, text },
                { type: 'text' as const, text: json },
              ],
              isError: true,
            };
          }
          return {
            content: [{ type: 'text' as const, text: `Concept ${concept_id} not found.` }],
            isError: true,
          };
        }

        // Build human-readable output
        const sections: string[] = [];

        // Concept info
        const std =
          concept.standard_concept === 'S'
            ? ' [Standard]'
            : concept.standard_concept === 'C'
              ? ' [Classification]'
              : '';
        sections.push(
          `## ${concept.concept_name}${std}\n` +
            `- **Concept ID:** ${concept.concept_id}\n` +
            `- **Vocabulary:** ${concept.vocabulary_id}\n` +
            `- **Domain:** ${concept.domain_id}\n` +
            `- **Class:** ${concept.concept_class_id}\n` +
            `- **Code:** ${concept.concept_code}`,
        );

        // Hierarchy
        if (hierarchy) {
          const ancestors = hierarchy.ancestors ?? [];
          const descendants = hierarchy.descendants ?? [];

          if (ancestors.length > 0 || descendants.length > 0) {
            const hierarchyLines: string[] = ['## Hierarchy'];

            if (ancestors.length > 0) {
              hierarchyLines.push(`\n### Ancestors (${ancestors.length})`);
              for (const a of ancestors.slice(0, 10)) {
                const level = a.min_levels_of_separation ?? a.level ?? '';
                hierarchyLines.push(
                  `  ${'  '.repeat(Number(level) || 0)}↑ ${a.concept_name} (${a.vocabulary_id}, ID: ${a.concept_id})`,
                );
              }
              if (ancestors.length > 10)
                hierarchyLines.push(`  ... and ${ancestors.length - 10} more`);
            }

            if (descendants.length > 0) {
              hierarchyLines.push(`\n### Descendants (${descendants.length})`);
              for (const d of descendants.slice(0, 10)) {
                const level = d.min_levels_of_separation ?? d.level ?? '';
                hierarchyLines.push(
                  `  ${'  '.repeat(Number(level) || 0)}↓ ${d.concept_name} (${d.vocabulary_id}, ID: ${d.concept_id})`,
                );
              }
              if (descendants.length > 10)
                hierarchyLines.push(`  ... and ${descendants.length - 10} more`);
            }

            sections.push(hierarchyLines.join('\n'));
          }
        }

        // Mappings — extracted from relationships with "Maps to" type
        if (relationshipsData) {
          const allRels = relationshipsData.relationships ?? [];

          // Belt-and-braces: the request already asked the server for only these
          // relationship types, so this should be a no-op. Kept because it is
          // cheap and the failure mode if the server ever ignores the filter is
          // mappings silently mixed with hierarchy links.
          const mappingRels = allRels.filter(
            (r) => r.relationship_id === 'Maps to' || r.relationship_id === 'Mapped from',
          );

          // Likewise redundant with the server-side vocabulary_ids filter above,
          // and likewise kept as a guard.
          const vocabFilter = target_vocabularies
            ? target_vocabularies
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean)
            : null;

          const filtered = vocabFilter
            ? mappingRels.filter((r) => vocabFilter.includes(r.concept_2?.vocabulary_id ?? ''))
            : mappingRels;

          // The header used to count only the rows this one page happened to
          // contain, so a concept with 309 mappings rendered as
          // "Cross-Vocabulary Mappings (200)" — a truncated set presented as a
          // complete one. total_items is the server's count for the SAME filtered
          // query (relationship_ids + vocabulary_ids), so it is the right
          // denominator.
          //
          // This tool deliberately does NOT page to exhaustion: it is an overview
          // that runs three requests in parallel, and a concept with thousands of
          // mappings would turn it into a long serial crawl returning far more
          // than an overview should. Instead it reports honestly that it is
          // partial and names the tool that can finish the job.
          const fetchedCount = filtered.length;
          const totalAvailable = mappingsPagination?.total_items ?? fetchedCount;
          mappingsTruncated = mappingsPagination?.has_next ?? totalAvailable > fetchedCount;

          if (fetchedCount > 0) {
            const countLabel = mappingsTruncated
              ? `${fetchedCount} of ${totalAvailable}`
              : String(fetchedCount);
            const mapLines = [`## Cross-Vocabulary Mappings (${countLabel})`];
            for (const r of filtered.slice(0, 15)) {
              const c2 = r.concept_2;
              if (c2) {
                mapLines.push(
                  `- **${c2.concept_name}** → ${c2.vocabulary_id} (${c2.concept_code}) via _${r.relationship_id}_`,
                );
              }
            }
            if (fetchedCount > 15) {
              mapLines.push(`... and ${fetchedCount - 15} more on this page`);
            }
            if (mappingsTruncated) {
              mapLines.push(
                `\n_Partial: this overview fetched ${fetchedCount} of ${totalAvailable} mappings. ` +
                  `Raise mappings_page_size (max 200), or use map_concept with page/page_size for the complete set._`,
              );
            }
            sections.push(mapLines.join('\n'));
          } else {
            const isStandard = concept.standard_concept === 'S';
            const hint = isStandard
              ? ' Standard concepts are typically the *target* of mappings, not the source. To find what maps to this concept, try searching for a non-standard source concept (e.g., an ICD-10 code) and use explore_concept on that.'
              : '';
            sections.push(`## Mappings\n\nNo cross-vocabulary mappings found.${hint}`);
          }
        }

        const text = sections.join('\n\n');
        // mappings_truncated / mappings_pagination are the machine-readable half
        // of the partial-result marker above. Without them a consumer reading only
        // the JSON block sees an array of relationships with no way to tell it is
        // one page of several.
        const jsonData = {
          concept,
          hierarchy,
          relationships: relationshipsData,
          mappings_truncated: mappingsTruncated,
          mappings_pagination: mappingsPagination,
        };

        return {
          content: [
            { type: 'text' as const, text },
            { type: 'text' as const, text: JSON.stringify(jsonData) },
          ],
        };
      } catch (error) {
        const { text, json } = formatErrorForMcp(error, 'explore_concept');
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
