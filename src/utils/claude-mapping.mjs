import { runClaudeReview } from './claude-review.mjs';
import { mappingHint, reviewMapping } from './mapping-review.mjs';
import { readState, saveState } from './review-state.mjs';

const directory = 'omophub-mapping';

function reviewResult(event, options) {
  if (event.hook_event_name !== 'PostToolUseFailure')
    return reviewMapping(event, { ...options, allowDefaultQuotaPolicy: true });

  const state = readState(event, directory, options.root);
  if (!state?.attempted || event.tool_name !== options.tool || typeof event.error !== 'string')
    return;
  // Claude delivers an MCP error as display text followed by its JSON details.
  const [message, details] = event.error.split('\n');
  try {
    if (JSON.parse(details).error_code !== 'MONTHLY_LIMIT_EXCEEDED') return;
  } catch {
    return;
  }
  saveState(event, directory, { ...state, quotaAnswer: message, corrections: 0 }, options.root);
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUseFailure',
      additionalContext: `Respond in plain text with only the following message from OMOPHub:\n${message}`,
    },
  };
}

await runClaudeReview({
  directory,
  tool: 'mcp__plugin_omophub_omophub__map_concept',
  explicitRequest: /\busing OMOPHub\b/i,
  hintFor: mappingHint,
  reviewResult,
});
