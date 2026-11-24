import { runClaudeReview } from './claude-review.mjs';
import { readTraversal } from './hierarchy-progress.mjs';
import {
  afterHierarchyRead,
  beforeHierarchyRead,
  hierarchyHint,
  reviewHierarchyReply,
} from './hierarchy-review.mjs';

await runClaudeReview({
  directory: 'omophub-hierarchy',
  tool: 'mcp__plugin_omophub_omophub__get_hierarchy',
  explicitRequest: /\bOMOPHub\b/i,
  hintFor: hierarchyHint,
  reviewResult(event, options) {
    switch (event.hook_event_name) {
      case 'PreToolUse':
        return beforeHierarchyRead(event, options);
      case 'PostToolUse':
        if (readTraversal(event, options.root)) return afterHierarchyRead(event, options);
        break;
      case 'Stop':
        return reviewHierarchyReply(event, options);
    }
  },
});
