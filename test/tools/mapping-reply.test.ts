import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('native single-target mapping review', () => {
  const args = {
    vocabulary_id: 'ICD10CM',
    concept_code: 'X1.2',
    target_vocabularies: 'SNOMED',
    on_monthly_limit: 'return_source',
  };
  const mapping = {
    concept_id: 45,
    concept_code: '007-2',
    vocabulary_id: 'SNOMED',
    relationship_id: 'Maps to',
  };
  let home: string;
  function hook(script: string, input: Record<string, unknown>) {
    const path = fileURLToPath(new URL(`../../src/utils/${script}.mjs`, import.meta.url));
    const run = spawnSync(process.execPath, [path], {
      encoding: 'utf8',
      env: { ...process.env, CODEX_HOME: home },
      input: JSON.stringify({ session_id: 's', turn_id: 't', ...input }),
    });
    expect(run.status, run.stderr).toBe(0);
    return run.stdout && JSON.parse(run.stdout);
  }
  const review = (hook_event_name: string, fields: Record<string, unknown> = {}) =>
    hook('check-mapping-result', {
      hook_event_name,
      tool_name: 'mcp__omophub__map_concept',
      tool_input: args,
      ...fields,
    });
  const finish = (reply: string) => review('Stop', { last_assistant_message: reply });
  const result = (mappings: unknown[], has_more = false) =>
    review('PostToolUse', {
      tool_response: {
        structuredContent: {
          source_concept_id: 12,
          mapped: mappings.length > 0,
          has_more,
          mappings,
        },
      },
    });
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'omophub-mapping-'));
    hook('check-prompt', {
      prompt:
        'Map ICD10CM X1.2 to SNOMED. Show the source ID, target ID and code, and relationship.',
    });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('grounds the source, target and code in the one returned row without repeating the read', () => {
    expect(finish('I will map it.').decision).toBe('block');
    expect(
      review('PreToolUse', { tool_input: { ...args, concept_code: 'X' } }).hookSpecificOutput
        .permissionDecision,
    ).toBe('deny');
    expect(review('PreToolUse')).toBe('');
    expect(result([mapping]).hookSpecificOutput.additionalContext).toContain(
      'SNOMED code is 007-2',
    );
    expect(review('PreToolUse').hookSpecificOutput.permissionDecision).toBe('deny');
    expect(
      finish('Source ID: 45, target ID: 12, SNOMED code: X1.2, relationship: Maps to.').decision,
    ).toBe('block');
    expect(
      finish(
        'Source ID is 12, target ID is 45, SNOMED code is 007-2 and the relationship is Maps to.',
      ),
    ).toBe('');
  });
  it('can still correct swapped IDs after an earlier stop routed the mapping call', () => {
    expect(finish('I will map it.').decision).toBe('block');
    expect(review('PreToolUse')).toBe('');
    result([mapping]);
    const swapped =
      'The source ID is X1.2, the target ID is 12, the SNOMED code is 007-2, and the relationship is Maps to.';
    expect(finish(swapped).decision).toBe('block');
    expect(review('PreToolUse').hookSpecificOutput.permissionDecision).toBe('deny');
    const correction = finish(swapped);
    expect(correction.decision).toBe('block');
    const answer =
      'The source ID is 12, the target ID is 45, the SNOMED code is 007-2, and the relationship is Maps to.';
    expect(correction.reason).toContain(answer);
    expect(finish(answer)).toBe('');
  });
  it('rejects a conflicting code even when a later sentence quotes the correct mapping', () => {
    review('PreToolUse');
    result([mapping]);
    const reply =
      'Source ID: 12\nTarget ID: 45\nCode: 45\nRelationship: Maps to\nThe target vocabulary code is 007-2.';
    expect(finish(reply).decision).toBe('block');
    expect(finish(reply.replace('Code: 45', 'Code: 007-2'))).toBe('');
  });
  it.each([
    '"concept_name": "X1.2"',
    'The source concept name is X1.2.',
  ])('corrects a source code presented as a concept name alongside the verified mapping: %s', (nameClaim) => {
    review('PreToolUse');
    result([mapping]);
    const answer =
      'The source ID is 12, the target ID is 45, the SNOMED code is 007-2, and the relationship is Maps to.';
    expect(finish(`${nameClaim}\n${answer}`)).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining(answer),
    });
    expect(review('PreToolUse').hookSpecificOutput.permissionDecision).toBe('deny');
    expect(finish(`For source code X1.2: ${answer}`)).toBe('');
  });
  it('corrects an extended code and keeps the relationship attached to the target', () => {
    review('PreToolUse');
    result([mapping]);
    expect(
      finish('Source ID: 12. Target ID: 45. SNOMED code: 007-20. Relationship: Maps to.').decision,
    ).toBe('block');
  });
  it.each([
    [[], false],
    [[mapping, mapping], false],
    [[mapping], true],
  ] as const)('leaves empty, multi-target and paginated results to the normal workflow', (rows, more) => {
    review('PreToolUse');
    expect(result([...rows], more)).toBe('');
    expect(review('PreToolUse')).toBe('');
    expect(finish('')).toBe('');
  });
  it('keeps a mapping failure explanation that already reports exhaustion and reset', () => {
    review('PreToolUse');
    expect(
      finish(
        'The tool call for mapping ICD10CM X1.2 to SNOMED returned an error due to monthly exhaustion. The allowance resets on December 1.',
      ),
    ).toBe('');
  });
  it('uses the reset from the partial source report throughout reply corrections', () => {
    const reset = '2027-03-01T01:23:45Z';
    const message = `OMOPHub could not verify the mapping. Monthly API call limit reached. The allowance resets at ${reset}.`;
    review('PreToolUse');
    const output = review('PostToolUse', {
      tool_response: {
        structuredContent: {
          source_concept_id: 12,
          mapped: null,
          mappings: [],
          mapping_error: { status: 429, error_code: 'MONTHLY_LIMIT_EXCEEDED', resets_at: reset },
          message,
        },
      },
    });
    expect(output.hookSpecificOutput.additionalContext).toContain(message);
    expect(finish('No mapping exists.').reason).toContain(reset);
    expect(review('PreToolUse').hookSpecificOutput.permissionDecisionReason).toBe(message);
    expect(finish(message)).toBe('');
  });

  it('uses the original tool error when Codex skips the post-tool event', () => {
    review('PreToolUse');
    expect(finish('No mapping exists.').reason).toContain('could not verify the mapping');
    expect(review('PreToolUse').hookSpecificOutput.permissionDecision).toBe('deny');
    expect(
      finish('OMOPHub could not verify the mapping. The monthly allowance resets on December 1.'),
    ).toBe('');
  });
});
