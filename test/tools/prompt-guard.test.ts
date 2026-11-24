import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const hook = fileURLToPath(new URL('../../src/utils/check-prompt.mjs', import.meta.url));

describe('Codex UserPromptSubmit', () => {
  it.each([
    JSON.stringify({
      prompt:
        'This is synthetic test data. Search OMOPHub with this chart fragment exactly as written: MRN: example-fixture, diagnosis: type 2 diabetes.',
    }),
    JSON.stringify({ prompt: 'Resolve {"resourceType":"Patient","id":"example-fixture"}' }),
    JSON.stringify({ prompt: 'MRN: example-fixture. Which medicine should I take?' }),
    '{}',
    'unreadable event',
  ])('blocks record input or an unreadable event with a fixed clarification', (input) => {
    const run = spawnSync(process.execPath, [hook], { input, encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr.trim()).toBe(
      'Please send just the terminology term or code, with all record fields removed.',
    );
  });

  it.each([
    'Use OMOPHub to recommend which medicine I should take for type 2 diabetes.',
    'Which medication should I take?',
    'Recommend a medication for diabetes.',
    'Can you suggest a treatment for my condition?',
  ])('declines a personal treatment choice before tool selection', (prompt) => {
    const run = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ prompt }),
      encoding: 'utf8',
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr.trim()).toBe(
      'OMOPHub looks up terminology codes and concepts. I can help identify a medication code, but I cannot recommend which medicine to take.',
    );
  });

  it.each([
    'Use OMOPHub to add a new synonym to concept 201826 and save the change.',
    'Could you remove the synonym "Example" from OMOP concept 123?',
    'Please save this synonym in OMOPHub.',
  ])('explains the read-only scope before a requested synonym write', (prompt) => {
    const run = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ prompt }),
      encoding: 'utf8',
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr.trim()).toBe(
      'OMOPHub is read-only. I can look up existing synonyms, but I cannot add or save a synonym.',
    );
  });

  it.each([
    [
      'Look up ICD10CM E11.9 in OMOPHub. What are its source concept ID and name?',
      'ICD10CM',
      'E11.9',
    ],
    ['Look up NDC code 0001-002.', 'NDC', '0001-002'],
    ['Look up SNOMED 12345.', 'SNOMED', '12345'],
  ])('routes an exact vocabulary code with its original spelling', (prompt, vocabulary_id, concept_code) => {
    const run = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ prompt }),
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    const hint = JSON.parse(run.stdout).hookSpecificOutput.additionalContext;
    expect(hint).toContain('get_concept_by_code');
    expect(hint).toContain(JSON.stringify({ vocabulary_id, concept_code }));
  });

  it.each([
    [
      'Search SNOMED in OMOPHub for “asthma”. Look up the matching concept and give me its release.',
      'SNOMED',
      'asthma',
    ],
    ['Search RxNorm for "Example Drug", verify the matching concept.', 'RxNorm', 'Example Drug'],
  ])('invokes a vocabulary-filtered search when the user requests verification', (prompt, vocabulary_ids, query) => {
    const run = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ prompt }),
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    const hint = JSON.parse(run.stdout).hookSpecificOutput.additionalContext;
    expect(hint).toContain('search_concepts');
    expect(hint).toContain(JSON.stringify({ query, vocabulary_ids, verify_match: true }));
  });

  it.each([
    [
      'Map ICD10CM E11.9 to standard SNOMED using OMOPHub. Show the source ID, target ID and code, and the relationship connecting them.',
      'ICD10CM',
      'E11.9',
      'SNOMED',
    ],
    ['Map NDC code 0001-002 to rxnorm.', 'NDC', '0001-002', 'RxNorm'],
  ])('routes a single source code and target vocabulary to the mapping tool', (prompt, vocabulary_id, concept_code, target_vocabularies) => {
    const run = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ prompt }),
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    const hint = JSON.parse(run.stdout).hookSpecificOutput.additionalContext;
    expect(hint).toContain('map_concept');
    expect(hint).toContain(
      JSON.stringify({
        vocabulary_id,
        concept_code,
        target_vocabularies,
        ...(prompt.includes('source ID') && { on_monthly_limit: 'return_source' }),
      }),
    );
  });

  it('routes a paged descendant request with a seed to get_hierarchy', () => {
    const prompt = 'List descendants of OMOP concept 123. Follow all pages.';
    const run = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ prompt }),
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout).hookSpecificOutput.additionalContext).toContain('get_hierarchy');
  });

  it('leaves an unparsed compound page size to the client', () => {
    const prompt =
      'List descendants of OMOP concept 123. Use twenty two results per page and follow all pages.';
    const run = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ prompt }),
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    const hint = JSON.parse(run.stdout).hookSpecificOutput.additionalContext;
    expect(hint).toContain('get_hierarchy');
    expect(hint).not.toContain('"page_size":2');
  });

  it.each([
    'Look up the medication with SNOMED code fixture-drug-01 in OMOPHub.',
    'Which medication code represents aspirin in RxNorm?',
    'Can you recommend a vocabulary for coding medications?',
    'List existing synonyms for concept 201826.',
    'Add a synonym to my notes after looking up concept 123.',
    'Do not add a synonym to concept 123. Show its existing synonyms.',
    'Map ICD10CM E11.9 to SNOMED and RxNorm.',
    'Map OMOP concept ID 123 to SNOMED.',
    'Search SNOMED for “asthma”. List the candidates.',
    'Search SNOMED for “asthma”. Do not verify the matching concept.',
    'Search SNOMED for “verify the matching concept”. Show the first page.',
    'Look up OMOP concept ID 12345.',
    'Look up ICD10CM E11.9 and map it to SNOMED.',
    'Define descendants of OMOP concept 123.',
    'For a FHIR Condition, resolve just the Coding with code 44054006.',
  ])('allows a terminology-only request', (prompt) => {
    const run = spawnSync(process.execPath, [hook], {
      input: JSON.stringify({ prompt }),
      encoding: 'utf8',
    });
    expect(run.status).toBe(0);
    expect(run.stdout + run.stderr).toBe('');
  });
});
