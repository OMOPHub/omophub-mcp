import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('single FHIR Coding review', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'omophub-coding-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  function run(name: string, fields: Record<string, unknown>) {
    const script = fileURLToPath(new URL(`../../src/utils/check-${name}.mjs`, import.meta.url));
    const { status, stdout, stderr } = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, CODEX_HOME: home },
      input: JSON.stringify({ session_id: 'review', turn_id: 'one', ...fields }),
    });
    expect(status, stderr).toBe(0);
    return stdout ? JSON.parse(stdout) : {};
  }
  const args = { system: 'http://example.org/terms', code: '00.42', resource_type: 'Observation' };
  const prompt =
    'For a FHIR Observation, resolve the Coding with system http://example.org/terms and code 00.42. Give the standard OMOP concept and CDM table.';
  const single = 'mcp__omophub__fhir_resolve';
  const call = (tool: string, input: Record<string, unknown>) =>
    run('coding', { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
  const stop = (reply: string) =>
    run('coding', { hook_event_name: 'Stop', last_assistant_message: reply });

  it('preserves the literal fields and checks both values from the verified result', () => {
    expect(run('prompt', { prompt }).hookSpecificOutput.additionalContext).toContain(
      JSON.stringify(args),
    );
    for (const [tool, input] of [
      [single, { ...args, code: `${args.system}|${args.code}` }],
      [single, { ...args, resource_type: 'Condition' }],
      [`${single}_codeable_concept`, { coding: [args] }],
    ] as const) {
      expect(call(tool, input).hookSpecificOutput.permissionDecision).toBe('deny');
    }
    expect(call(single, args)).toEqual({});
    run('coding', {
      hook_event_name: 'PostToolUse',
      tool_name: single,
      tool_response: {
        structuredContent: {
          success: true,
          data: {
            resolution: { standard_concept: { concept_id: 12345 }, target_table: 'measurement' },
          },
        },
      },
    });
    expect(stop('The table is measurement.').reason).toContain('12345');
    expect(call(single, args).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(stop('OMOP concept 12345 in the measurement table.')).toEqual({});
  });

  it.each([
    ['resolve just the Coding', '', true],
    ['resolve just the Coding', ' Also search SNOMED for the same code.', false],
    ['resolve the Coding', '', false],
  ])('checks the registered search hook for a duplicate read after %s%s', (request, extra, deny) => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../plugins/codex/hooks/hooks.json', import.meta.url), 'utf8'),
    );
    const search = 'mcp__omophub__search_concepts';
    expect(
      manifest.hooks.PreToolUse.some(
        (entry: { matcher: string; hooks: { command: string }[] }) =>
          new RegExp(entry.matcher).test(search) &&
          entry.hooks.some((hook) => hook.command.includes('check-coding.mjs')),
      ),
    ).toBe(true);
    run('prompt', { prompt: prompt.replace('resolve the Coding', request) + extra });
    call(single, args);
    const result = run('coding', {
      hook_event_name: 'PostToolUse',
      tool_name: single,
      tool_response: {
        structuredContent: {
          success: true,
          data: {
            resolution: { standard_concept: { concept_id: 12345 }, target_table: 'measurement' },
          },
        },
      },
    });
    expect(result.hookSpecificOutput.additionalContext).toContain(
      'The standard OMOP concept is 12345 and the CDM table is measurement.',
    );
    if (deny)
      expect(stop('OMOP concept 12345 in measurement. Release 1980.').decision).toBe('block');
    const detail = call('mcp__omophub__get_concept', { concept_id: 12345 });
    if (deny) expect(detail.hookSpecificOutput.permissionDecision).toBe('deny');
    else expect(detail).toEqual({});
    const output = call(search, { query: args.code, verify_match: true });
    if (deny) {
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(output.hookSpecificOutput.permissionDecisionReason).toContain('measurement');
    } else expect(output).toEqual({});
  });

  it('corrects a resolution-only reply that also presents the standard flag as an ID', () => {
    run('prompt', { prompt: prompt.replace('resolve the Coding', 'resolve just the Coding') });
    expect(call(single, args)).toEqual({});
    const answer = 'The standard OMOP concept is 12345 and the CDM table is measurement.';
    run('coding', {
      hook_event_name: 'PostToolUse',
      tool_name: single,
      tool_response: {
        structuredContent: {
          success: true,
          data: {
            resolution: {
              standard_concept: { concept_id: 12345, standard_concept: 'S' },
              target_table: 'measurement',
            },
          },
        },
      },
    });
    const draft = `${answer} It is a Clinical Finding with a standard concept ID of "S".`;
    for (let attempt = 0; attempt < 4; attempt++) {
      expect(stop(draft)).toMatchObject({
        decision: 'block',
        reason: expect.stringContaining(answer),
      });
    }
    expect(call(single, args).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(stop(answer)).toEqual({});
  });

  it.each([
    [undefined, 'OMOPHub could not verify a concept or CDM table for this Coding.'],
    [
      { isError: true, content: [{ type: 'text', text: 'MCP error -32602: Invalid arguments' }] },
      'OMOPHub rejected the Coding arguments. Please check the supplied fields.',
    ],
    [
      {
        isError: true,
        content: [{ type: 'text', text: '{"error_code":"INVALID_INPUT","status":400}' }],
      },
      'OMOPHub rejected the Coding input (HTTP 400). Please check the code, system URI and resource type.',
    ],
  ] as const)('requires an error-only reply after an unsuccessful resolution (%j)', (response, answer) => {
    run('prompt', { prompt: prompt.replace('resolve the Coding', 'resolve just the Coding') });
    call(single, args);
    if (response)
      run('coding', { hook_event_name: 'PostToolUse', tool_name: single, tool_response: response });
    for (let attempt = 0; attempt < 4; attempt++) {
      expect(stop(`${answer} The concept is 12345 in measurement.`)).toMatchObject({
        decision: 'block',
        reason: expect.stringContaining(answer),
      });
    }
    expect(call(single, args).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(stop(answer)).toEqual({});
  });

  it('uses the actual tool error when the host omits its post-call event', () => {
    run('prompt', { prompt });
    call(single, args);
    expect(stop('Monthly quota reached').reason).toContain('last fhir_resolve response');
    expect(call(single, args).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(stop('HTTP 400. The code contains unsupported characters.')).toEqual({});
  });

  it('leaves a CodeableConcept array outside the single-Coding workflow', () => {
    expect(
      run('prompt', {
        prompt: prompt.replace('the Coding', 'the CodeableConcept with a coding array'),
      }),
    ).toEqual({});
    expect(call(`${single}_codeable_concept`, { coding: [args] })).toEqual({});
  });
});
