import { verifiedSearchHint } from './check-verified-search.mjs';
import { singleCodingHint } from './coding-review.mjs';
import { exactCodeArguments } from './exact-code.mjs';
import { clearTraversal } from './hierarchy-progress.mjs';
import { hierarchyHint } from './hierarchy-review.mjs';
import { mappingHint } from './mapping-review.mjs';
import { recordInputClarification } from './record-fields.mjs';
import { clearState } from './review-state.mjs';
import { terminologyScopeFeedback } from './terminology-scope.mjs';

// Only specialize a direct lookup of a named vocabulary and one literal code.
function exactCodeHint(prompt) {
  const args = exactCodeArguments(prompt);
  if (!args) return;
  return `Call the exposed get_concept_by_code tool now with ${JSON.stringify(args)}. A source vocabulary code is a string. Wait for the result. For a single matching row, answer with its concept_id and full concept_name from concepts. This lookup needs one call. If the lookup fails, report the error.`;
}

try {
  let input = '';
  for await (const chunk of process.stdin.setEncoding('utf8')) input += chunk;
  const event = JSON.parse(input);
  clearTraversal(event);
  clearState(event, 'omophub-coding');
  clearState(event, 'omophub-mapping');
  clearState(event, 'omophub-verified-search');
  const feedback = terminologyScopeFeedback(event.prompt);
  if (feedback) {
    process.stderr.write(`${feedback}\n`);
    process.exitCode = 2;
  } else {
    const hint =
      hierarchyHint(event) ??
      exactCodeHint(event.prompt) ??
      mappingHint(event) ??
      verifiedSearchHint(event) ??
      singleCodingHint(event);
    if (hint)
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: hint },
        }),
      );
  }
} catch {
  process.stderr.write(`${recordInputClarification}\n`);
  process.exitCode = 2;
}
