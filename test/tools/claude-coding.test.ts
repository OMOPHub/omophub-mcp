import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('routes a single Coding with its literal code and reviews the values returned by Claude Code', ({
  onTestFinished,
}) => {
  const root = mkdtempSync(join(tmpdir(), 'claude-coding-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../../src/utils/claude-coding.mjs', import.meta.url));
  function hook(hook_event_name: string, fields: Record<string, unknown>) {
    const run = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: root },
      input: JSON.stringify({ session_id: 'fixture', hook_event_name, ...fields }),
    });
    expect(run.status, run.stderr).toBe(0);
    return run.stdout && JSON.parse(run.stdout);
  }
  const tool = 'mcp__plugin_omophub_omophub__fhir_resolve';
  const args = { system: 'urn:example:codes', code: '00.17', resource_type: 'Observation' };
  const prompt =
    '/omophub:omophub For a FHIR Observation, resolve just the Coding with system urn:example:codes and code 00.17. Which standard OMOP concept and CDM table does OMOPHub return?';
  const hint = hook('UserPromptSubmit', { prompt }).hookSpecificOutput.additionalContext;
  expect(hint).toContain(tool);
  expect(hint).toContain(JSON.stringify(args));
  const pre = (tool_name: string, tool_input: Record<string, unknown>) =>
    hook('PreToolUse', { tool_name, tool_input });
  expect(
    pre(tool, { ...args, code: 'urn:example:codes|00.17' }).hookSpecificOutput.permissionDecision,
  ).toBe('deny');
  expect(pre(tool, args)).toBe('');
  const verified = {
    standard_concept: { concept_id: 73, standard_concept: 'S' },
    target_table: 'measurement',
  };
  const result = hook('PostToolUse', {
    tool_name: tool,
    tool_response: JSON.stringify({ success: true, data: { resolution: verified } }),
  });
  const answer = 'The standard OMOP concept is 73 and the CDM table is measurement.';
  expect(result.hookSpecificOutput.additionalContext).toContain(answer);
  expect(pre(tool, args).hookSpecificOutput.permissionDecision).toBe('deny');
  expect(hook('Stop', { last_assistant_message: `${answer} The concept ID is S.` }).decision).toBe(
    'block',
  );
  expect(hook('Stop', { last_assistant_message: answer })).toBe('');
});
