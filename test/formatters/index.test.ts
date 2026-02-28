import { describe, expect, it } from 'vitest';
import {
  formatConcept,
  formatConceptList,
  formatError,
  formatHierarchy,
  formatMappings,
  formatVocabularyList,
} from '../../src/formatters/index.js';
import { formatErrorForMcp, OmopHubApiError } from '../../src/utils/errors.js';
import conceptResponse from '../fixtures/concept-response.json';
import hierarchyFixture from '../fixtures/hierarchy-response.json';

// Formatter expects normalized shape with nested `concept` object
const hierarchyResponse = {
  ...hierarchyFixture,
  data: {
    concept: {
      concept_id: hierarchyFixture.data.concept_id,
      concept_name: hierarchyFixture.data.concept_name,
      vocabulary_id: hierarchyFixture.data.vocabulary_id,
      domain_id: '',
      concept_class_id: '',
      standard_concept: null,
      concept_code: '',
    },
    ancestors: hierarchyFixture.data.ancestors,
    descendants: hierarchyFixture.data.descendants,
    total_ancestors: hierarchyFixture.data.total_ancestors,
    total_descendants: hierarchyFixture.data.total_descendants,
  },
};
import mappingsResponse from '../fixtures/mappings-response.json';
import searchResponse from '../fixtures/search-response.json';
import vocabulariesFixture from '../fixtures/vocabularies-response.json';

// Formatter expects unwrapped data (Vocabulary[]), not the API's { vocabularies: [...] } wrapper
const vocabulariesResponse = {
  ...vocabulariesFixture,
  data: vocabulariesFixture.data.vocabularies,
};

describe('formatters', () => {
  describe('formatConceptList', () => {
    it('formats search results as text and JSON', () => {
      const { text, json } = formatConceptList(searchResponse as never, 'type 2 diabetes');
      expect(text).toContain('type 2 diabetes');
      expect(text).toContain('Type 2 diabetes mellitus');
      expect(text).toContain('201826');

      const parsed = JSON.parse(json);
      expect(parsed.results).toHaveLength(3);
      expect(parsed.total).toBe(42);
      expect(parsed.query).toBe('type 2 diabetes');
    });

    it('includes pagination metadata in text and JSON', () => {
      const { text, json } = formatConceptList(searchResponse as never, 'type 2 diabetes');
      expect(text).toContain('showing page 1 of 5');
      expect(text).toContain('→ Use page=2 to see more results.');

      const parsed = JSON.parse(json);
      expect(parsed.page).toBe(1);
      expect(parsed.total_pages).toBe(5);
    });

    it('omits pagination hint when no next page', () => {
      const noNext = {
        success: true,
        data: [searchResponse.data[0]],
        meta: {
          pagination: {
            total_items: 1,
            page: 1,
            page_size: 10,
            total_pages: 1,
            has_next: false,
            has_previous: false,
          },
        },
      };
      const { text } = formatConceptList(noNext as never, 'test');
      expect(text).not.toContain('→ Use page=');
    });

    it('handles empty results', () => {
      const empty = {
        success: true,
        data: [],
        meta: {
          pagination: {
            total_items: 0,
            page: 1,
            page_size: 10,
            total_pages: 0,
            has_next: false,
            has_previous: false,
          },
        },
      };
      const { text, json } = formatConceptList(empty as never, 'nonexistent');
      expect(text).toContain('No concepts found');
      const parsed = JSON.parse(json);
      expect(parsed.results).toHaveLength(0);
    });
  });

  describe('formatConcept', () => {
    it('formats single concept with table layout', () => {
      const { text, json } = formatConcept(conceptResponse.data as never);
      expect(text).toContain('Type 2 diabetes mellitus');
      expect(text).toContain('201826');
      expect(text).toContain('SNOMED');
      expect(text).toContain('Standard');

      const parsed = JSON.parse(json);
      expect(parsed.concept_id).toBe(201826);
    });
  });

  describe('formatMappings', () => {
    it('formats mappings with source concept info', () => {
      const { text, json } = formatMappings(mappingsResponse as never, 201826);
      expect(text).toContain('Type 2 diabetes mellitus');
      expect(text).toContain('ICD10CM');
      expect(text).toContain('E11.9');

      const parsed = JSON.parse(json);
      expect(parsed.mapped).toBe(true);
      expect(parsed.mappings).toHaveLength(2);
    });

    it('handles empty mappings with mapped=false', () => {
      const empty = {
        success: true,
        data: {
          source_concept: { concept_id: 999, concept_name: 'Test' },
          mappings: [],
          total_mappings: 0,
        },
      };
      const { text, json } = formatMappings(empty as never, 999);
      expect(text).toContain('No mappings found');

      const parsed = JSON.parse(json);
      expect(parsed.mapped).toBe(false);
    });
  });

  describe('formatHierarchy', () => {
    it('formats hierarchy with ancestors and descendants', () => {
      const { text, json } = formatHierarchy(hierarchyResponse as never, 'both');
      expect(text).toContain('Type 2 diabetes mellitus');
      expect(text).toContain('Ancestors');
      expect(text).toContain('Descendants');
      expect(text).toContain('Diabetes mellitus');

      const parsed = JSON.parse(json);
      expect(parsed.ancestors).toHaveLength(2);
      expect(parsed.descendants).toHaveLength(2);
    });

    it('only shows ancestors for direction=up', () => {
      const { json } = formatHierarchy(hierarchyResponse as never, 'up');
      const parsed = JSON.parse(json);
      expect(parsed.ancestors).toBeDefined();
      expect(parsed.descendants).toBeUndefined();
    });
  });

  describe('formatVocabularyList', () => {
    it('formats vocabulary list with counts', () => {
      const { text, json } = formatVocabularyList(vocabulariesResponse as never);
      expect(text).toContain('SNOMED');
      expect(text).toContain('ICD10CM');
      expect(text).toContain('RxNorm');

      const parsed = JSON.parse(json);
      expect(parsed.vocabularies).toHaveLength(4);
    });

    it('filters by search term', () => {
      const { text, json } = formatVocabularyList(vocabulariesResponse as never, 'snomed');
      expect(text).toContain('SNOMED');

      const parsed = JSON.parse(json);
      expect(parsed.vocabularies).toHaveLength(1);
    });

    it('returns empty for no matches', () => {
      const { text } = formatVocabularyList(vocabulariesResponse as never, 'nonexistent');
      expect(text).toContain('No vocabularies found');
    });
  });

  describe('formatError', () => {
    it('returns text and JSON error format', () => {
      const { text, json } = formatError('Something went wrong');
      expect(text).toBe('Something went wrong');

      const parsed = JSON.parse(json);
      expect(parsed.error).toBe(true);
      expect(parsed.message).toBe('Something went wrong');
    });
  });

  describe('formatErrorForMcp', () => {
    it('returns AUTH_FAILED for 401', () => {
      const error = new OmopHubApiError(401, 'Unauthorized', '/test');
      const { text, json } = formatErrorForMcp(error, 'test_tool');
      expect(text).toContain('Authentication failed');
      const parsed = JSON.parse(json);
      expect(parsed.error_code).toBe('AUTH_FAILED');
    });

    it('returns ACCESS_DENIED with upgrade_url for 403', () => {
      const error = new OmopHubApiError(403, 'Forbidden', '/test');
      const { text, json } = formatErrorForMcp(error, 'test_tool');
      expect(text).toContain('Access denied');
      const parsed = JSON.parse(json);
      expect(parsed.error_code).toBe('ACCESS_DENIED');
      expect(parsed.upgrade_url).toBeDefined();
    });

    it('returns NOT_FOUND with actionable text and concept_id for 404', () => {
      const error = new OmopHubApiError(404, 'Not found', '/concepts/999');
      const { text, json } = formatErrorForMcp(error, 'test_tool');
      expect(text).toContain('Not found');
      expect(text).toContain('search_concepts');
      expect(text).toContain('get_concept_by_code');
      const parsed = JSON.parse(json);
      expect(parsed.error_code).toBe('NOT_FOUND');
      expect(parsed.path).toBe('/concepts/999');
      expect(parsed.concept_id).toBe(999);
    });

    it('returns NOT_FOUND without concept_id for non-concept paths', () => {
      const error = new OmopHubApiError(404, 'Not found', '/vocabularies/FAKE');
      const { text, json } = formatErrorForMcp(error, 'test_tool');
      expect(text).toContain('search_concepts');
      const parsed = JSON.parse(json);
      expect(parsed.error_code).toBe('NOT_FOUND');
      expect(parsed.path).toBe('/vocabularies/FAKE');
      expect(parsed.concept_id).toBeUndefined();
    });

    it('returns RATE_LIMIT_EXCEEDED with retry_after for 429', () => {
      const error = new OmopHubApiError(429, 'Rate limited', '/test');
      const { text, json } = formatErrorForMcp(error, 'test_tool');
      expect(text).toContain('Rate limit exceeded');
      const parsed = JSON.parse(json);
      expect(parsed.error_code).toBe('RATE_LIMIT_EXCEEDED');
      expect(parsed.retry_after_seconds).toBe(3600);
      expect(parsed.upgrade_url).toBeDefined();
    });

    it('returns SERVER_ERROR for 500/502/503', () => {
      for (const status of [500, 502, 503]) {
        const error = new OmopHubApiError(status, 'Server error', '/test');
        const { json } = formatErrorForMcp(error, 'test_tool');
        const parsed = JSON.parse(json);
        expect(parsed.error_code).toBe('SERVER_ERROR');
      }
    });

    it('returns CONNECTION_ERROR for network failures', () => {
      const error = new Error('fetch failed');
      const { text, json } = formatErrorForMcp(error, 'test_tool');
      expect(text).toContain('Cannot connect');
      const parsed = JSON.parse(json);
      expect(parsed.error_code).toBe('CONNECTION_ERROR');
    });

    it('returns UNKNOWN_ERROR for unexpected errors', () => {
      const { json } = formatErrorForMcp('something', 'test_tool');
      const parsed = JSON.parse(json);
      expect(parsed.error_code).toBe('UNKNOWN_ERROR');
    });

    it('returns UNKNOWN_ERROR with status for unhandled HTTP codes', () => {
      const error = new OmopHubApiError(418, "I'm a teapot", '/test');
      const { json } = formatErrorForMcp(error, 'test_tool');
      const parsed = JSON.parse(json);
      expect(parsed.error_code).toBe('UNKNOWN_ERROR');
      expect(parsed.status).toBe(418);
    });
  });
});
