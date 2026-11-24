import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../src/utils/claude-record-input.mjs', import.meta.url));
function submit(prompt: string) {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt }),
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout && JSON.parse(result.stdout);
}

it.each([
  '/omophub:omophub Search for patient_id: synthetic.',
  'OMOPHub, which medication should I take? patient_id: synthetic.',
  'Use OMOPHub to analyze {"resourceType":"Patient","id":"synthetic"}.',
])('stops a record-shaped request with a fixed clarification', (prompt) => {
  expect(submit(prompt)).toEqual({
    continue: false,
    stopReason: 'Please send just the terminology term or code, with all record fields removed.',
  });
});

it.each([
  '/omophub:omophub Look up the term patient education.',
  'Which medication code represents aspirin in RxNorm in OMOPHub?',
  '/omophub:omophub List existing synonyms for concept 123.',
  '/omophub:omophub Add a synonym to my notes after looking up concept 123.',
  '/omophub:omophub Do not add a synonym to concept 123. Show its existing synonyms.',
  'Which medicine should I take?',
  'Explain the format of this example label: patient_id: synthetic.',
])('allows terminology input and requests outside OMOPHub', (prompt) => {
  expect(submit(prompt)).toBe('');
});

it.each([
  '/omophub:omophub Which medicine should I take?',
  'Use OMOPHub to suggest a treatment for my condition.',
])('explains terminology lookup and declines personal medication selection', (prompt) => {
  expect(submit(prompt)).toEqual({
    continue: false,
    stopReason:
      'OMOPHub looks up terminology codes and concepts. I can help identify a medication code, but I cannot recommend which medicine to take.',
  });
});

it.each([
  '/omophub:omophub Use OMOPHub to add a new synonym to concept 201826 and save the change.',
  '/omophub:omophub Could you remove the synonym "Example" from OMOP concept 123?',
  'Please save this synonym in OMOPHub.',
])('explains read-only access before a vocabulary synonym write', (prompt) => {
  expect(submit(prompt)).toEqual({
    continue: false,
    stopReason:
      'OMOPHub is read-only. I can look up existing synonyms, but I cannot add or save a synonym.',
  });
});
