import { homedir } from 'node:os';
import { join } from 'node:path';
import { exactCodeArguments } from './exact-code.mjs';
import { clearState, readState, saveState } from './review-state.mjs';

const directory = 'omophub-exact-code';
const tool = 'mcp__plugin_omophub_omophub__get_concept_by_code';
const command = /^\/omophub:omophub\s+/i;
const root = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

function lookup(args) {
  return `Invoke ${tool} once with ${JSON.stringify(args)}. This call returns the source concept ID and full name. Answer directly from its returned rows without a second lookup. On error, report the error.`;
}

function review(event) {
  if (event.hook_event_name === 'UserPromptSubmit') {
    clearState(event, directory, root);
    const prompt = event.prompt?.trim() ?? '';
    if (!command.test(prompt) && !/\bin OMOPHub\b/i.test(prompt)) return;
    const args = exactCodeArguments(prompt.replace(command, ''));
    if (!args) return;
    saveState(event, directory, { turn: event.turn_id, args }, root);
    return {
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lookup(args) },
    };
  }
  const state = readState(event, directory, root);
  if (!state) return;
  if (event.hook_event_name === 'Stop') {
    if (!state.attempted && !event.stop_hook_active) {
      return {
        decision: 'block',
        reason: `The lookup has not run. Invoke the registered function now: ${JSON.stringify({ name: tool, parameters: state.args })}. Wait for the tool response.`,
      };
    }
    clearState(event, directory, root);
    return;
  }
  if (event.hook_event_name === 'PreToolUse') {
    const matches =
      event.tool_name === tool &&
      event.tool_input?.vocabulary_id === state.args.vocabulary_id &&
      event.tool_input?.concept_code === state.args.concept_code;
    if (matches && !state.attempted) {
      saveState(event, directory, { ...state, attempted: true }, root);
      return;
    }
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: state.attempted
          ? 'The exact-code lookup has already been attempted. Use its returned rows or report its error.'
          : lookup(state.args),
      },
    };
  }
  if (event.hook_event_name === 'PostToolUse' && event.tool_name === tool && state.attempted) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          'The lookup is complete. Answer now with the returned source concept ID and full name. If there are multiple matches, identify them. If the lookup failed or returned no rows, say so.',
      },
    };
  }
}

let input = '';
for await (const chunk of process.stdin.setEncoding('utf8')) input += chunk;
const event = JSON.parse(input);
// Claude supplies a session ID across hooks. Each new prompt clears the prior lookup.
event.turn_id ??= event.session_id;
const output = review(event);
if (output) process.stdout.write(JSON.stringify(output));
