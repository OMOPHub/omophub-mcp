import { describe, expect, it } from 'vitest';
import { registerPrompts } from '../../src/prompts/index.js';
import { createMockServer } from '../helpers/mock-server.js';

describe('registerPrompts', () => {
  it('registers phenotype-concept-set and code-lookup prompts', () => {
    const server = createMockServer();
    registerPrompts(server as never);

    expect(server.prompt).toHaveBeenCalledTimes(2);
    expect(server.prompts.has('phenotype-concept-set')).toBe(true);
    expect(server.prompts.has('code-lookup')).toBe(true);
  });

  describe('phenotype-concept-set prompt', () => {
    it('returns message with condition name', () => {
      const server = createMockServer();
      registerPrompts(server as never);
      const handler = server.prompts.get('phenotype-concept-set')!;

      const result = handler({ condition: 'Type 2 diabetes mellitus' });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content.text).toContain('Type 2 diabetes mellitus');
      expect(result.messages[0].content.text).toContain('search_concepts');
      expect(result.messages[0].content.text).toContain('get_hierarchy');
      expect(result.messages[0].content.text).toContain('map_concept');
    });

    it('includes vocabulary filter when vocabularies param provided', () => {
      const server = createMockServer();
      registerPrompts(server as never);
      const handler = server.prompts.get('phenotype-concept-set')!;

      const result = handler({
        condition: 'Hypertension',
        vocabularies: 'SNOMED,ICD10CM',
      });

      expect(result.messages[0].content.text).toContain('SNOMED,ICD10CM');
    });

    it('does not include vocabulary filter when vocabularies param absent', () => {
      const server = createMockServer();
      registerPrompts(server as never);
      const handler = server.prompts.get('phenotype-concept-set')!;

      const result = handler({ condition: 'Hypertension' });

      expect(result.messages[0].content.text).not.toContain('Focus on these vocabularies');
    });
  });

  describe('code-lookup prompt', () => {
    it('returns message with code and vocabulary', () => {
      const server = createMockServer();
      registerPrompts(server as never);
      const handler = server.prompts.get('code-lookup')!;

      const result = handler({ code: 'E11.9', vocabulary: 'ICD10CM' });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content.text).toContain('E11.9');
      expect(result.messages[0].content.text).toContain('ICD10CM');
      expect(result.messages[0].content.text).toContain('get_concept_by_code');
      expect(result.messages[0].content.text).toContain('map_concept');
      expect(result.messages[0].content.text).toContain('get_hierarchy');
    });
  });
});
