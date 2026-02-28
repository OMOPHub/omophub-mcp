import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerPrompts(server: McpServer): void {
  server.prompt(
    'phenotype-concept-set',
    'Build a concept set for a clinical phenotype definition. Guides the AI through searching for concepts, exploring hierarchies, and assembling a complete concept set.',
    {
      condition: z
        .string()
        .describe(
          'The clinical condition or phenotype to define (e.g., "Type 2 diabetes mellitus")',
        ),
      vocabularies: z
        .string()
        .optional()
        .describe(
          'Comma-separated vocabulary IDs to focus on (e.g., "SNOMED,ICD10CM"). Default: all',
        ),
    },
    ({ condition, vocabularies }) => {
      const vocabFilter = vocabularies ? ` Focus on these vocabularies: ${vocabularies}.` : '';

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Help me build a concept set for the clinical phenotype: "${condition}".${vocabFilter}

Please follow these steps:
1. Use search_concepts to find the primary concept(s) for "${condition}"
2. For the best-matching standard concept, use get_hierarchy with direction="down" to find all descendants
3. Use map_concept to find cross-vocabulary mappings (especially SNOMED ↔ ICD-10-CM)
4. Compile a final concept set table with: concept_id, concept_name, vocabulary_id, concept_code, and whether it's a primary concept or descendant

Present the final concept set in a clear table format that can be used in a cohort definition.`,
            },
          },
        ],
      };
    },
  );

  server.prompt(
    'code-lookup',
    'Look up and validate a medical code. Resolves a vocabulary-specific code to its OMOP concept and shows mappings.',
    {
      code: z.string().describe('The medical code to look up (e.g., "E11.9", "44054006", "4850")'),
      vocabulary: z.string().describe('The vocabulary system (e.g., "ICD10CM", "SNOMED", "LOINC")'),
    },
    ({ code, vocabulary }) => {
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Look up and validate the medical code "${code}" from vocabulary "${vocabulary}".

Please:
1. Use get_concept_by_code to resolve this code
2. If found, use map_concept to show what it maps to in other vocabularies
3. Use get_hierarchy with direction="up" to show where it sits in the hierarchy
4. Summarize: Is this a standard concept? What are the key mappings? Any important notes about this code?`,
            },
          },
        ],
      };
    },
  );
}
