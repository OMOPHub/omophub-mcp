import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

const script = fileURLToPath(
  new URL('../../src/utils/claude-verified-search.mjs', import.meta.url),
);
const search = 'mcp__plugin_omophub_omophub__search_concepts';
const args = { query: 'example term', vocabulary_ids: 'LOINC', verify_match: true };
const prompt =
  '/omophub:omophub Search LOINC for “example term”. Look up the matching concept and give me its OMOP ID, LOINC code and vocabulary release.';
let profile: string;
beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'claude-search-'));
});
afterEach(() => rmSync(profile, { recursive: true, force: true }));
function hook(hook_event_name: string, fields: Record<string, unknown> = {}) {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name, session_id: 'test', ...fields }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: profile },
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout ? JSON.parse(result.stdout) : {};
}
const call = (input: Record<string, unknown>) =>
  hook('PreToolUse', { tool_name: search, tool_input: input });

it('requires the original query, vocabulary and verification, then reads the values returned by Claude Code', () => {
  const hint = hook('UserPromptSubmit', { prompt }).hookSpecificOutput.additionalContext;
  expect(hint).toContain(search);
  expect(hint).toContain(JSON.stringify(args));
  for (const change of [
    { query: 'other' },
    { vocabulary_ids: 'SNOMED' },
    { verify_match: false },
  ]) {
    expect(call({ ...args, ...change }).hookSpecificOutput.permissionDecision).toBe('deny');
  }
  expect(call(args)).toEqual({});
  const verified = {
    concept_id: 345,
    concept_code: '001-2',
    vocabulary_id: 'LOINC',
    vocab_release: 'v3.1',
  };
  const result = hook('PostToolUse', {
    tool_name: search,
    tool_response: JSON.stringify({ verified_concept: verified }),
  });
  expect(result.hookSpecificOutput.additionalContext).toContain('001-2');
  expect(call(args).hookSpecificOutput.permissionDecision).toBe('deny');
  expect(hook('Stop', { last_assistant_message: '345 and 001-2' }).decision).toBe('block');
  expect(hook('Stop', { last_assistant_message: '345, 001-2, v3.1.' })).toEqual({});
});

it('leaves ordinary searches alone and excludes record-shaped text from the routing hint', () => {
  for (const text of [
    prompt.split('. Look up')[0],
    prompt.replace('example term', 'MRN: synthetic'),
  ]) {
    expect(hook('UserPromptSubmit', { prompt: text })).toEqual({});
    expect(call({ query: 'different' })).toEqual({});
  }
});
