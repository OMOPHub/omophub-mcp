import { runClaudeReview } from './claude-review.mjs';
import { reviewCoding, singleCodingHint } from './coding-review.mjs';

await runClaudeReview({
  directory: 'omophub-coding',
  tool: 'mcp__plugin_omophub_omophub__fhir_resolve',
  explicitRequest: /\bOMOPHub\b/i,
  hintFor: singleCodingHint,
  reviewResult: reviewCoding,
});
