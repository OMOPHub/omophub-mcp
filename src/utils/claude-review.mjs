import { homedir } from 'node:os';
import { join } from 'node:path';
import { containsRecordFields } from './record-fields.mjs';
import { clearState } from './review-state.mjs';

const root = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const command = /^\/omophub:omophub\s+/i;

function review(event, { directory, tool, explicitRequest, hintFor, reviewResult }) {
  const options = { root, tool };
  event.turn_id ??= event.session_id;
  if (event.hook_event_name === 'UserPromptSubmit') {
    clearState(event, directory, root);
    const prompt = event.prompt?.trim() ?? '';
    if ((!command.test(prompt) && !explicitRequest.test(prompt)) || containsRecordFields(prompt))
      return;
    const hint = hintFor({ ...event, prompt: prompt.replace(command, '') }, options);
    if (hint)
      return {
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: hint },
      };
    return;
  }
  // Claude Code serializes the tool's structured output as JSON in PostToolUse.
  if (event.hook_event_name === 'PostToolUse' && typeof event.tool_response === 'string') {
    try {
      event.tool_response = { structuredContent: JSON.parse(event.tool_response) };
    } catch {
      // Plain-text failures have no verified concept.
      event.tool_response = { isError: true };
    }
  }
  return reviewResult(event, options);
}

export async function runClaudeReview(config) {
  let input = '';
  for await (const chunk of process.stdin.setEncoding('utf8')) input += chunk;
  const output = review(JSON.parse(input), config);
  if (output) process.stdout.write(JSON.stringify(output));
}
