import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe.each(['Codex', 'Claude Code'])('native %s hierarchy review', (host) => {
  const claude = host === 'Claude Code';
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'omophub-hierarchy-test-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  function hook(name: string, fields: Record<string, unknown>) {
    const scriptName = claude ? 'claude-hierarchy' : `check-${name}`;
    const script = fileURLToPath(new URL(`../../src/utils/${scriptName}.mjs`, import.meta.url));
    const event = { ...fields };
    if (claude) {
      const events: Record<string, string> = {
        prompt: 'UserPromptSubmit',
        'hierarchy-read': 'PreToolUse',
        'hierarchy-page': 'PostToolUse',
        'hierarchy-reply': 'Stop',
      };
      event.hook_event_name = events[name];
      if (event.prompt) event.prompt = `/omophub:omophub ${event.prompt}`;
      if (event.tool_response) {
        event.tool_response = JSON.stringify(
          (event.tool_response as { structuredContent: unknown }).structuredContent,
        );
      }
    }
    const result = spawnSync(process.execPath, [script], {
      input: JSON.stringify({
        session_id: 'session',
        ...(!claude && { turn_id: 'review' }),
        ...event,
      }),
      env: { ...process.env, [claude ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']: home },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout ? JSON.parse(result.stdout) : {};
  }
  const prompt =
    'List descendants of OMOP concept 42. Use two results per page, follow the available pages, and report truncation.';
  const tool = {
    tool_name: claude
      ? 'mcp__plugin_omophub_omophub__get_hierarchy'
      : 'mcp__omophub__get_hierarchy',
    tool_input: { concept_id: 42, direction: 'down' },
  };
  function page(number: number, ids: number[], truncated?: boolean, size = 2) {
    return hook('hierarchy-page', {
      ...tool,
      tool_response: {
        structuredContent: {
          concept_id: 42,
          direction: 'down',
          descendants: ids.map((concept_id) => ({ concept_id, concept_name: 'Tied name' })),
          pagination: {
            page: number,
            page_size: size,
            total_items: 3,
            total_pages: 2,
            has_next: number === 1,
          },
          has_more: number === 1,
          next_page: number === 1 ? 2 : undefined,
          truncated,
        },
      },
    }).hookSpecificOutput.additionalContext;
  }

  it.each([
    [false, false, 'false'],
    [true, false, 'true'],
    [undefined, false, 'unknown'],
  ] as const)('summarizes contiguous pages with a first-page cap of %s and last-page cap of %s', (first, last, flag) => {
    hook('prompt', { prompt });
    page(1, [42, 71, 72], first);
    const answer = `Descendant OMOP IDs: 71, 72, 73\nTruncated: ${flag}`;
    expect(page(2, [72, 73], last)).toContain(answer);
    expect(hook('hierarchy-read', tool).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(
      hook('hierarchy-reply', { last_assistant_message: 'Only the last row is 73.' }),
    ).toMatchObject({ decision: 'block', reason: expect.stringContaining(answer) });
    expect(hook('hierarchy-read', tool).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(hook('hierarchy-read', { ...tool, turn_id: 'another-turn' })).toEqual({});
    expect(hook('hierarchy-reply', { last_assistant_message: 'Done' }).decision).toBe('block');
    expect(
      hook('hierarchy-reply', { last_assistant_message: answer, stop_hook_active: true }),
    ).toEqual({});
    expect(hook('hierarchy-read', tool)).toEqual({});
  });
  it('corrects hook text wrapped around an otherwise complete result without another read', () => {
    hook('prompt', { prompt });
    page(1, [71, 72], false);
    page(2, [73], false);
    const answer = 'Descendant OMOP IDs: 71, 72, 73\nTruncated: false';
    const reply = `The tool call was blocked by the PreToolUse hook.\n${answer}`;
    expect(hook('hierarchy-reply', { last_assistant_message: reply })).toMatchObject({
      decision: 'block',
      reason: expect.stringContaining(answer),
    });
    expect(hook('hierarchy-read', tool).hookSpecificOutput).toMatchObject({
      permissionDecision: 'deny',
      permissionDecisionReason: answer,
    });
    expect(hook('hierarchy-reply', { last_assistant_message: answer })).toEqual({});
  });
  it('accepts a correct prose verdict with the listed IDs without requesting a rewrite', () => {
    hook('prompt', { prompt });
    page(1, [71, 72], false);
    page(2, [73], false);
    expect(
      hook('hierarchy-reply', {
        last_assistant_message:
          'Descendants of OMOP concept 42: 71, 72, 73. The result was not truncated.',
      }),
    ).toEqual({});
  });

  it('prevents a different page size from consuming quota and does not retry a failed expected read', () => {
    hook('prompt', { prompt });
    expect(
      hook('hierarchy-read', {
        ...tool,
        tool_input: { ...tool.tool_input, page: 1, page_size: 100 },
      }).hookSpecificOutput.permissionDecision,
    ).toBe('deny');
    expect(
      hook('hierarchy-read', {
        ...tool,
        tool_input: { ...tool.tool_input, page: 1, page_size: 2 },
      }),
    ).toEqual({});
    page(1, [71, 72], false);
    const reminder = hook('hierarchy-reply', { last_assistant_message: 'Done' });
    expect(reminder.reason).toContain('"page":2');
    expect(
      hook('hierarchy-read', {
        ...tool,
        tool_input: { ...tool.tool_input, page: 2, page_size: 2 },
      }),
    ).toEqual({});
    expect(hook('hierarchy-reply', { last_assistant_message: 'Quota exhausted' })).toEqual({});
  });

  it('withholds a complete summary when the previous page was missed or had a different page size', () => {
    hook('prompt', { prompt });
    page(1, [71, 72], false, 10);
    expect(page(2, [73], false)).not.toContain('All requested pages have been read');
    expect(hook('hierarchy-reply', { last_assistant_message: 'partial' })).toHaveProperty(
      'decision',
      'block',
    );
  });
});
