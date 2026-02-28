import type {
  ApiResponse,
  Concept,
  HierarchyNode,
  HierarchyResponse,
  Mapping,
  MappingsResponse,
  SearchResult,
  Vocabulary,
} from '../client/types.js';

function conceptLine(c: Concept | SearchResult, index?: number): string {
  const prefix = index !== undefined ? `${index + 1}. ` : '';
  const std =
    c.standard_concept === 'S'
      ? ' [Standard]'
      : c.standard_concept === 'C'
        ? ' [Classification]'
        : '';
  return `${prefix}**${c.concept_name}** (ID: ${c.concept_id})\n   ${c.vocabulary_id} | ${c.domain_id} | Code: ${c.concept_code}${std}`;
}

export function formatConceptList(
  response: ApiResponse<SearchResult[]>,
  query: string,
): { text: string; json: string } {
  const results = response.data;
  const pagination = response.meta?.pagination;
  const total = pagination?.total_items ?? results.length;
  const page = pagination?.page ?? 1;
  const totalPages = pagination?.total_pages ?? 1;

  if (results.length === 0) {
    return {
      text: `No concepts found for "${query}". Try broader search terms or different vocabulary filters.`,
      json: JSON.stringify({ results: [], total, page, total_pages: totalPages, query }),
    };
  }

  const lines = results.map((r, i) => conceptLine(r, i));
  const header = `Found ${total} concept${total !== 1 ? 's' : ''} for "${query}" (showing page ${page} of ${totalPages}):`;

  let text = `${header}\n\n${lines.join('\n\n')}`;

  if (pagination?.has_next) {
    text += `\n\n→ Use page=${page + 1} to see more results.`;
  }

  return {
    text,
    json: JSON.stringify({
      results: results.map((r) => ({
        concept_id: r.concept_id,
        concept_name: r.concept_name,
        vocabulary_id: r.vocabulary_id,
        domain_id: r.domain_id,
        concept_code: r.concept_code,
        concept_class_id: r.concept_class_id,
        standard_concept: r.standard_concept,
      })),
      total,
      page,
      total_pages: totalPages,
      query,
    }),
  };
}

export function formatConcept(concept: Concept): { text: string; json: string } {
  const std =
    concept.standard_concept === 'S'
      ? 'Standard'
      : concept.standard_concept === 'C'
        ? 'Classification'
        : 'Non-standard';

  const lines = [
    `**${concept.concept_name}**`,
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Concept ID | ${concept.concept_id} |`,
    `| Vocabulary | ${concept.vocabulary_id} |`,
    `| Domain | ${concept.domain_id} |`,
    `| Concept Class | ${concept.concept_class_id} |`,
    `| Concept Code | ${concept.concept_code} |`,
    `| Standard Status | ${std} |`,
  ];

  if (concept.valid_start_date) lines.push(`| Valid From | ${concept.valid_start_date} |`);
  if (concept.valid_end_date) lines.push(`| Valid To | ${concept.valid_end_date} |`);
  if (concept.invalid_reason) lines.push(`| Invalid Reason | ${concept.invalid_reason} |`);
  if (concept.synonyms && concept.synonyms.length > 0) {
    lines.push(`| Synonyms | ${concept.synonyms.join(', ')} |`);
  }

  return {
    text: lines.join('\n'),
    json: JSON.stringify(concept),
  };
}

export function formatMappings(
  response: ApiResponse<MappingsResponse>,
  conceptId: number,
): { text: string; json: string } {
  const data = response.data;
  const mappings = data.mappings;

  if (!mappings || mappings.length === 0) {
    return {
      text: `No mappings found for concept ${conceptId} (${data.source_concept?.concept_name || 'unknown'}).`,
      json: JSON.stringify({
        source_concept_id: conceptId,
        source_concept_name: data.source_concept?.concept_name,
        mapped: false,
        mappings: [],
      }),
    };
  }

  const source = data.source_concept;
  const header = `Mappings for **${source?.concept_name || `Concept ${conceptId}`}** (${source?.vocabulary_id || 'unknown'} → targets):`;

  const lines = mappings.map(
    (m: Mapping, i: number) =>
      `${i + 1}. **${m.concept_name}** (ID: ${m.concept_id})\n   ${m.vocabulary_id} | Code: ${m.concept_code} | Relationship: ${m.relationship_id}`,
  );

  return {
    text: `${header}\n\n${lines.join('\n\n')}`,
    json: JSON.stringify({
      source_concept_id: conceptId,
      source_concept_name: source?.concept_name,
      mapped: true,
      total_mappings: data.total_mappings ?? mappings.length,
      mappings: mappings.map((m: Mapping) => ({
        concept_id: m.concept_id,
        concept_name: m.concept_name,
        vocabulary_id: m.vocabulary_id,
        concept_code: m.concept_code,
        relationship_id: m.relationship_id,
        standard_concept: m.standard_concept,
      })),
    }),
  };
}

export function formatHierarchy(
  response: ApiResponse<HierarchyResponse>,
  direction: 'up' | 'down' | 'both',
): { text: string; json: string } {
  const data = response.data;
  const concept = data.concept;

  const sections: string[] = [
    `Hierarchy for **${concept.concept_name}** (ID: ${concept.concept_id}, ${concept.vocabulary_id}):`,
  ];

  const formatNodes = (nodes: HierarchyNode[], label: string): string => {
    if (!nodes || nodes.length === 0) return `\n**${label}:** None`;
    const lines = nodes.map(
      (n, i) =>
        `${i + 1}. ${'  '.repeat(Math.max(0, n.level ?? 0))}${n.concept_name} (ID: ${n.concept_id}, ${n.vocabulary_id})`,
    );
    return `\n**${label}** (${nodes.length}):\n${lines.join('\n')}`;
  };

  if (direction === 'up' || direction === 'both') {
    sections.push(formatNodes(data.ancestors || [], 'Ancestors (broader terms)'));
  }
  if (direction === 'down' || direction === 'both') {
    sections.push(formatNodes(data.descendants || [], 'Descendants (narrower terms)'));
  }

  const jsonData: Record<string, unknown> = {
    concept_id: concept.concept_id,
    concept_name: concept.concept_name,
    vocabulary_id: concept.vocabulary_id,
    direction,
  };

  if (direction === 'up' || direction === 'both') {
    jsonData.ancestors = (data.ancestors || []).map((n) => ({
      concept_id: n.concept_id,
      concept_name: n.concept_name,
      vocabulary_id: n.vocabulary_id,
      level: n.level,
    }));
    jsonData.total_ancestors = data.total_ancestors ?? (data.ancestors || []).length;
  }
  if (direction === 'down' || direction === 'both') {
    jsonData.descendants = (data.descendants || []).map((n) => ({
      concept_id: n.concept_id,
      concept_name: n.concept_name,
      vocabulary_id: n.vocabulary_id,
      level: n.level,
    }));
    jsonData.total_descendants = data.total_descendants ?? (data.descendants || []).length;
  }

  return {
    text: sections.join('\n'),
    json: JSON.stringify(jsonData),
  };
}

export function formatVocabularyList(
  response: ApiResponse<Vocabulary[]>,
  search?: string,
): { text: string; json: string } {
  let vocabs = response.data;

  if (search) {
    const term = search.toLowerCase();
    vocabs = vocabs.filter(
      (v) =>
        v.vocabulary_id.toLowerCase().includes(term) ||
        v.vocabulary_name.toLowerCase().includes(term),
    );
  }

  if (vocabs.length === 0) {
    return {
      text: search ? `No vocabularies found matching "${search}".` : 'No vocabularies available.',
      json: JSON.stringify({ vocabularies: [], total: 0 }),
    };
  }

  const lines = vocabs.map(
    (v, i) =>
      `${i + 1}. **${v.vocabulary_id}** — ${v.vocabulary_name}${v.concept_count != null ? ` (${v.concept_count.toLocaleString()} concepts)` : ''}${v.vocabulary_version ? ` [v${v.vocabulary_version}]` : ''}`,
  );

  const header = search
    ? `Found ${vocabs.length} vocabularies matching "${search}":`
    : `Available vocabularies (${vocabs.length}):`;

  return {
    text: `${header}\n\n${lines.join('\n')}`,
    json: JSON.stringify({
      vocabularies: vocabs.map((v) => ({
        vocabulary_id: v.vocabulary_id,
        vocabulary_name: v.vocabulary_name,
        vocabulary_version: v.vocabulary_version,
        concept_count: v.concept_count,
      })),
      total: vocabs.length,
    }),
  };
}

export function formatError(error: string): { text: string; json: string } {
  return {
    text: error,
    json: JSON.stringify({ error: true, message: error }),
  };
}
