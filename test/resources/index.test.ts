import { beforeEach, describe, expect, it } from 'vitest';
import { registerResources } from '../../src/resources/index.js';
import { vocabularyCache } from '../../src/utils/cache.js';
import vocabulariesResponse from '../fixtures/vocabularies-response.json';
import { createMockClient, createMockServer } from '../helpers/mock-server.js';

// The unwrapped format that the resource handler stores in cache after unwrapping
const unwrappedResponse = {
  ...vocabulariesResponse,
  data: vocabulariesResponse.data.vocabularies,
};

describe('registerResources', () => {
  beforeEach(() => {
    vocabularyCache.clear();
  });

  it('registers vocabulary-list and vocabulary-details resources', () => {
    const server = createMockServer();
    const client = createMockClient();
    registerResources(server as never, client as never);

    expect(server.resource).toHaveBeenCalledTimes(2);
    expect(server.resources.has('vocabulary-list')).toBe(true);
    expect(server.resources.has('vocabulary-details')).toBe(true);
  });

  describe('vocabulary-list resource', () => {
    it('fetches from API on cache miss and caches result', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(vocabulariesResponse);

      registerResources(server as never, client as never);
      const handler = server.resources.get('vocabulary-list')!;

      const uri = new URL('omophub://vocabularies');
      const result = await handler(uri);

      expect(client.request).toHaveBeenCalledWith(
        '/vocabularies',
        { include_stats: true, page_size: 100, page: 1 },
        'resource:vocabulary-list',
      );
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('omophub://vocabularies');
      expect(result.contents[0].mimeType).toBe('text/plain');
      expect(result.contents[0].text).toContain('OMOP Vocabulary Catalog');
      expect(result.contents[0].text).toContain('SNOMED');
      expect(vocabularyCache.has('vocabularies:all')).toBe(true);
    });

    it('returns cached data without API call on cache hit', async () => {
      const server = createMockServer();
      const client = createMockClient();
      vocabularyCache.set('vocabularies:all', unwrappedResponse);

      registerResources(server as never, client as never);
      const handler = server.resources.get('vocabulary-list')!;

      const uri = new URL('omophub://vocabularies');
      const result = await handler(uri);

      expect(client.request).not.toHaveBeenCalled();
      expect(result.contents[0].text).toContain('SNOMED');
      expect(result.contents[0].text).toContain('894,567 concepts');
    });

    it('formats vocabulary list with concept counts', async () => {
      const server = createMockServer();
      const client = createMockClient();
      vocabularyCache.set('vocabularies:all', unwrappedResponse);

      registerResources(server as never, client as never);
      const handler = server.resources.get('vocabulary-list')!;

      const uri = new URL('omophub://vocabularies');
      const result = await handler(uri);

      const text = result.contents[0].text as string;
      expect(text).toContain('ICD10CM');
      expect(text).toContain('RxNorm');
      expect(text).toContain('LOINC');
    });
  });

  describe('vocabulary-details resource', () => {
    it('returns vocabulary details for found vocabulary', async () => {
      const server = createMockServer();
      const client = createMockClient();
      client.request.mockResolvedValueOnce(vocabulariesResponse);

      registerResources(server as never, client as never);
      const handler = server.resources.get('vocabulary-details')!;

      const uri = new URL('omophub://vocabularies/SNOMED');
      const result = await handler(uri, { vocabulary_id: 'SNOMED' });

      expect(result.contents).toHaveLength(1);
      const text = result.contents[0].text as string;
      expect(text).toContain('Vocabulary: SNOMED');
      expect(text).toContain('Systematic Nomenclature');
      expect(text).toContain('Version: 20240301');
      expect(text).toContain('Total Concepts: 894,567');
      expect(text).toContain('Standard Concepts: 345,678');
    });

    it('returns "not found" for unknown vocabulary', async () => {
      const server = createMockServer();
      const client = createMockClient();
      vocabularyCache.set('vocabularies:all', unwrappedResponse);

      registerResources(server as never, client as never);
      const handler = server.resources.get('vocabulary-details')!;

      const uri = new URL('omophub://vocabularies/UNKNOWN');
      const result = await handler(uri, { vocabulary_id: 'UNKNOWN' });

      expect(result.contents[0].text).toContain('Vocabulary "UNKNOWN" not found');
    });

    it('matches vocabulary case-insensitively', async () => {
      const server = createMockServer();
      const client = createMockClient();
      vocabularyCache.set('vocabularies:all', unwrappedResponse);

      registerResources(server as never, client as never);
      const handler = server.resources.get('vocabulary-details')!;

      const uri = new URL('omophub://vocabularies/snomed');
      const result = await handler(uri, { vocabulary_id: 'snomed' });

      const text = result.contents[0].text as string;
      expect(text).toContain('Vocabulary: SNOMED');
    });

    it('reuses cached vocabulary data', async () => {
      const server = createMockServer();
      const client = createMockClient();
      vocabularyCache.set('vocabularies:all', unwrappedResponse);

      registerResources(server as never, client as never);
      const handler = server.resources.get('vocabulary-details')!;

      const uri = new URL('omophub://vocabularies/RxNorm');
      await handler(uri, { vocabulary_id: 'RxNorm' });

      expect(client.request).not.toHaveBeenCalled();
    });

    it('includes optional fields only when present', async () => {
      const responseWithoutOptionals = {
        ...vocabulariesResponse,
        data: [
          {
            vocabulary_id: 'TEST',
            vocabulary_name: 'Test Vocabulary',
          },
        ],
      };

      const server = createMockServer();
      const client = createMockClient();
      vocabularyCache.set('vocabularies:all', responseWithoutOptionals);

      registerResources(server as never, client as never);
      const handler = server.resources.get('vocabulary-details')!;

      const uri = new URL('omophub://vocabularies/TEST');
      const result = await handler(uri, { vocabulary_id: 'TEST' });

      const text = result.contents[0].text as string;
      expect(text).toContain('Vocabulary: TEST');
      expect(text).toContain('Name: Test Vocabulary');
      expect(text).not.toContain('Version:');
      expect(text).not.toContain('Reference:');
      expect(text).not.toContain('Total Concepts:');
    });
  });
});
