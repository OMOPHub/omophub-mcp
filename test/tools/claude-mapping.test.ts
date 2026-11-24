import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('routes an explicit mapping by its source code and refuses a target claim after a failed read', ({
  onTestFinished,
}) => {
  const profile = mkdtempSync(join(tmpdir(), 'claude-map-'));
  onTestFinished(() => rmSync(profile, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../../src/utils/claude-mapping.mjs', import.meta.url));
  function hook(hook_event_name: string, event: Record<string, unknown>) {
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      input: JSON.stringify({ hook_event_name, session_id: 'fixture', ...event }),
      env: { ...process.env, CLAUDE_CONFIG_DIR: profile },
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout && JSON.parse(result.stdout);
  }
  const prompt =
    'Map LOINC 001-2 to RxNorm using OMOPHub. Show the source ID, target ID and code, and relationship.';
  const name = 'mcp__plugin_omophub_omophub__map_concept';
  const args = { vocabulary_id: 'LOINC', concept_code: '001-2', target_vocabularies: 'RxNorm' };
  expect(hook('UserPromptSubmit', { prompt }).hookSpecificOutput.additionalContext).toContain(
    JSON.stringify({ ...args, on_monthly_limit: 'return_source' }),
  );
  const wrong = hook('PreToolUse', {
    tool_name: name.replace('map_concept', 'get_concept_by_code'),
    tool_input: args,
  });
  expect(wrong.hookSpecificOutput.permissionDecision).toBe('deny');
  expect(hook('PreToolUse', { tool_name: name, tool_input: args })).toBe('');
  hook('PostToolUse', { tool_name: name, tool_response: 'Mapping unavailable' });
  expect(hook('Stop', { last_assistant_message: 'Target ID: 42' }).decision).toBe('block');
  expect(
    hook('Stop', {
      last_assistant_message: 'OMOPHub was unavailable and could not verify the mapping.',
    }),
  ).toBe('');
});
