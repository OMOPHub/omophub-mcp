import { runClaudeReview } from './claude-review.mjs';
import { exactCodeArguments } from './exact-code.mjs';
import { clearState, readState, saveState } from './review-state.mjs';

const directory = 'omophub-exact-code';
const tool = 'mcp__plugin_omophub_omophub__get_concept_by_code';

function lookup(args) {
  return `Invoke ${tool} once with ${JSON.stringify(args)}. Answer from the returned source concept IDs and full names.`;
}

function answerFromResult(response, args) {
  // The host may forward an MCP envelope or serialize its structured result.
  const result = response?.structuredContent ?? response;
  const rows = (result?.structuredContent ?? result)?.concepts;
  const code = `${args.vocabulary_id} ${args.concept_code}`;
  if (response?.isError || result?.isError || !Array.isArray(rows)) return;
  if (!rows.length) return `OMOPHub returned no matching concept for ${code}.`;
  if (
    !rows.every(
      (row) =>
        Number.isSafeInteger(row?.concept_id) &&
        typeof row.concept_name === 'string' &&
        row.concept_name.trim() &&
        row.vocabulary_id === args.vocabulary_id &&
        row.concept_code === args.concept_code,
    )
  )
    return;
  return rows.map((row) => `Source concept ${row.concept_id}: ${row.concept_name}`).join('\n');
}

function review(event, { root }) {
  const state = readState(event, directory, root);
  if (!state) return;
  const failure = `The OMOPHub lookup did not verify a source concept for ${state.args.vocabulary_id} ${state.args.concept_code}.`;
  if (event.hook_event_name === 'Stop') {
    if (!state.attempted && !event.stop_hook_active)
      return { decision: 'block', reason: lookup(state.args) };
    const answer = state.answer ?? failure;
    if (event.last_assistant_message?.trim() !== answer)
      return { decision: 'block', reason: `Return exactly this result in plain text:\n${answer}` };
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
  if (event.tool_name !== tool || !state.attempted) return;
  if (event.hook_event_name === 'PostToolUse' || event.hook_event_name === 'PostToolUseFailure') {
    const answer =
      (event.hook_event_name === 'PostToolUse' &&
        answerFromResult(event.tool_response, state.args)) ||
      failure;
    saveState(event, directory, { ...state, answer }, root);
    return {
      hookSpecificOutput: {
        hookEventName: event.hook_event_name,
        additionalContext: `Return exactly this result in plain text:\n${answer}`,
      },
    };
  }
}

await runClaudeReview({
  directory,
  tool,
  explicitRequest: /\bin OMOPHub\b/i,
  hintFor(event, { root }) {
    const args = exactCodeArguments(event.prompt);
    if (!args) return;
    saveState(event, directory, { turn: event.turn_id, args }, root);
    return lookup(args);
  },
  reviewResult: review,
});
