import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../src/utils/claude-exact-code.mjs', import.meta.url));
const tool = 'mcp__plugin_omophub_omophub__get_concept_by_code';
let profile: string;
beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'claude-code-lookup-'));
});
afterEach(() => rmSync(profile, { recursive: true, force: true }));

function hook(hook_event_name: string, fields: Record<string, unknown> = {}) {
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name, session_id: 'review', ...fields }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: profile },
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout ? JSON.parse(result.stdout) : {};
}
const args = { vocabulary_id: 'LOINC', concept_code: '0012-3' };
const call = (name: string, input: Record<string, unknown>) =>
  hook('PreToolUse', { tool_name: name, tool_input: input });

it('permits one lookup with the literal vocabulary and code within the selected Claude skill', () => {
  expect(
    hook('UserPromptSubmit', { prompt: '/omophub:omophub Look up LOINC 0012-3.' })
      .hookSpecificOutput.additionalContext,
  ).toContain(JSON.stringify(args));
  expect(call(tool, { ...args, concept_code: '12-3' }).hookSpecificOutput.permissionDecision).toBe(
    'deny',
  );
  expect(call(tool, args)).toEqual({});
  expect(hook('PostToolUse', { tool_name: tool }).hookSpecificOutput.additionalContext).toContain(
    'full name',
  );
  expect(call(tool, args).hookSpecificOutput.permissionDecision).toBe('deny');
  expect(
    call('mcp__plugin_omophub_omophub__get_concept', { concept_id: 123 }).hookSpecificOutput
      .permissionDecision,
  ).toBe('deny');
  expect(hook('Stop')).toEqual({});
  expect(call(tool, args)).toEqual({});
});

it('reminds Claude to call the tool on a premature reply and clears state on a new request', () => {
  hook('UserPromptSubmit', { prompt: 'Look up LOINC 0012-3 in OMOPHub.' });
  expect(hook('Stop').decision).toBe('block');
  expect(
    hook('UserPromptSubmit', { prompt: '/omophub:omophub Map LOINC 0012-3 to SNOMED.' }),
  ).toEqual({});
  expect(hook('Stop')).toEqual({});
  expect(hook('UserPromptSubmit', { prompt: 'Look up LOINC 0012-3.' })).toEqual({});
});
