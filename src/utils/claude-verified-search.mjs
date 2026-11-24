import { reviewVerifiedSearch, verifiedSearchHint } from './check-verified-search.mjs';
import { runClaudeReview } from './claude-review.mjs';

await runClaudeReview({
  directory: 'omophub-verified-search',
  tool: 'mcp__plugin_omophub_omophub__search_concepts',
  explicitRequest: /\bin OMOPHub\b/i,
  hintFor: verifiedSearchHint,
  reviewResult: reviewVerifiedSearch,
});
