export interface PaginationMeta {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
  has_next: boolean;
  has_previous: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    pagination?: PaginationMeta;
    execution_time_ms?: number;
    version?: string;
  };
}

export interface Concept {
  concept_id: number;
  concept_name: string;
  domain_id: string;
  vocabulary_id: string;
  concept_class_id: string;
  standard_concept: string | null;
  concept_code: string;
  valid_start_date?: string;
  valid_end_date?: string;
  invalid_reason?: string | null;
  synonyms?: string[];
}

export interface SearchResult extends Concept {
  score?: number;
}

export interface Mapping {
  concept_id: number;
  concept_name: string;
  vocabulary_id: string;
  concept_code: string;
  domain_id: string;
  standard_concept: string | null;
  concept_class_id: string;
  relationship_id: string;
  relationship_name?: string;
}

export interface HierarchyNode extends Concept {
  level?: number;
  min_levels_of_separation?: number;
  max_levels_of_separation?: number;
}

export interface HierarchyResponse {
  concept: Concept;
  ancestors?: HierarchyNode[];
  descendants?: HierarchyNode[];
  total_ancestors?: number;
  total_descendants?: number;
}

/** Raw hierarchy shape from the API (flat concept fields, no nested `concept` object) */
export interface RawHierarchyResponse {
  concept_id: number;
  concept_name?: string;
  vocabulary_id?: string;
  ancestors?: HierarchyNode[];
  descendants?: HierarchyNode[];
  total_ancestors?: number;
  total_descendants?: number;
  hierarchy_summary?: {
    total_ancestors?: number;
    total_descendants?: number;
  };
}

export interface Vocabulary {
  vocabulary_id: string;
  vocabulary_name: string;
  vocabulary_reference?: string;
  vocabulary_version?: string;
  vocabulary_concept_id?: number;
  concept_count?: number;
  standard_concept_count?: number;
  domain_coverage?: Record<string, number>;
}

export interface MappingsResponse {
  source_concept: Concept;
  mappings: Mapping[];
  total_mappings: number;
}
