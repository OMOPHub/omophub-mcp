import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginVerifiedSearch,
  reviewVerifiedSearch,
} from '../../src/utils/check-verified-search.mjs';

describe('native verified search', () => {
  const event = { session_id: 'session', turn_id: 'turn' };
  const args = { query: 'other term', vocabulary_ids: 'LOINC', verify_match: true };
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'omophub-verified-search-'));
    vi.stubEnv('CODEX_HOME', directory);
    beginVerifiedSearch(event, args);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });
  const run = (hook_event_name: string, fields: Record<string, unknown> = {}) =>
    reviewVerifiedSearch({
      ...event,
      hook_event_name,
      tool_name: 'mcp__omophub__search_concepts',
      ...fields,
    });
  it('checks verification, the filter, and the complete returned identifiers', () => {
    for (const changes of [
      { verify_match: false },
      { vocabulary_ids: 'SNOMED' },
      { query: 'wrong term' },
    ]) {
      expect(
        run('PreToolUse', { tool_input: { ...args, ...changes } })?.hookSpecificOutput
          ?.permissionDecision,
      ).toBe('deny');
    }
    expect(run('PreToolUse', { tool_input: args })).toBeUndefined();
    const verified_concept = {
      concept_id: 777,
      concept_code: '007-2',
      vocab_release: 'v2.0',
      vocabulary_id: 'LOINC',
    };
    expect(
      run('PostToolUse', { tool_response: { structuredContent: { verified_concept } } })
        ?.hookSpecificOutput?.additionalContext,
    ).toContain('007-2');
    expect(run('Stop', { last_assistant_message: '777, 007-2, v2.01' })?.decision).toBe('block');
    expect(run('PreToolUse', { tool_input: args })?.hookSpecificOutput?.permissionDecision).toBe(
      'deny',
    );
    expect(run('Stop', { last_assistant_message: '777, 007-2, v2.0.' })).toBeUndefined();
  });
  it('allows candidate selection when the response has no verified match', () => {
    run('PreToolUse', { tool_input: args });
    run('PostToolUse', { tool_response: { structuredContent: { results: [] } } });
    expect(
      run('PreToolUse', {
        tool_name: 'mcp__omophub__get_concept',
        tool_input: { concept_id: 123 },
      }),
    ).toBeUndefined();
    expect(run('Stop')).toBeUndefined();
  });
});
