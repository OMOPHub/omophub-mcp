import {
  addPage,
  beginTraversal,
  clearTraversal,
  markReplyCorrection,
  nextArguments,
  noteAttempt,
  readTraversal,
  remindNextPage,
  traversalAnswer,
} from './hierarchy-progress.mjs';

export function hierarchyHint(event, { root, tool } = {}) {
  const seed =
    typeof event.prompt === 'string' &&
    event.prompt.match(/\b(?:OMOP(?:\s+(?:concept|ID))?|concept)(?:\s+ID)?[\s:#]+(\d+)\b/i);
  if (
    /\bdescendants?\b/i.test(event.prompt) &&
    /\b(?:follow|across|all|every)\s+(?:(?:the|available|remaining)\s+)*pages?\b/i.test(
      event.prompt,
    ) &&
    seed &&
    Number.isSafeInteger(Number(seed[1]))
  ) {
    const sizeText = event.prompt
      .match(
        /(?:^|[.,;:]\s*|\b(?:use|using|with|at|of|in|by)\s+)(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:results?|rows?|concepts?|descendants?)\s+)?per page\b/i,
      )?.[1]
      .toLowerCase();
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    const size = Number(sizeText) || words.indexOf(sizeText) + 1;
    const args = { concept_id: Number(seed[1]), direction: 'down', page: 1 };
    if (size > 0 && size <= 200) args.page_size = size;
    beginTraversal(event, args.concept_id, args.page_size, root);
    if (!tool)
      return `Call the OMOPHub get_hierarchy tool with ${JSON.stringify(args)}, preserving any requested filters and depth. Use the requested page size. When the user asks to follow pages, invoke get_hierarchy again with next_page while has_more is true. In the final answer write “Descendant OMOP IDs” followed by every distinct descendants[].concept_id from the requested pages, then “Truncated” followed by the returned flag. Equal names can have different IDs. If a page fails or the flag is missing, report incomplete coverage.`;
    return `Call the exposed ${tool} tool now with ${JSON.stringify(args)}, preserving any requested filters and depth. Read the next_page while has_more is true. In the final reply, list the distinct descendant OMOP IDs from all requested pages and report the returned truncation flag. If a page fails or the flag is missing, report incomplete coverage.`;
  }
}

export function beforeHierarchyRead(event, { root, tool = 'mcp__omophub__get_hierarchy' } = {}) {
  const state = readTraversal(event, root);
  const args = event.tool_input;
  if (state && event.tool_name === tool && Number(args?.concept_id) === state.seed) {
    let reason;
    if (state.next === null && args.direction === 'down') {
      reason = traversalAnswer(state);
    } else if (state.next !== null) {
      const wrongSize =
        state.size && Number(args.page_size ?? args.max_results ?? 200) !== state.size;
      if (wrongSize || Number(args.page ?? 1) !== state.next || args.direction !== 'down') {
        reason = `The request specifies a paged descendant listing. Call ${tool} with ${JSON.stringify(nextArguments(state))}, preserving the requested depth and vocabulary filters.`;
      } else noteAttempt(event, state, root);
    }
    if (reason)
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      };
  }
}

export function afterHierarchyRead(event, { root, tool = 'mcp__omophub__get_hierarchy' } = {}) {
  const result = event.tool_response?.structuredContent;
  if (
    event.tool_name === tool &&
    !event.tool_response?.isError &&
    result?.direction === 'down' &&
    Array.isArray(result.descendants) &&
    result.pagination
  ) {
    const ids = [...new Set(result.descendants.map((node) => node.concept_id))].filter(
      (id) => Number.isSafeInteger(id) && id !== result.concept_id,
    );
    const cap = typeof result.truncated === 'boolean' ? result.truncated : 'unknown';
    const more = result.has_more === true && Number.isSafeInteger(result.next_page);
    const progress = addPage(event, result, root);
    const context =
      progress?.next === null
        ? `All requested pages have been read. Return only these two lines:\n${traversalAnswer(progress)}`
        : [
            `Verified descendant OMOP IDs on page ${result.pagination.page}: ${ids.join(', ') || 'none'}.`,
            `Tool truncation flag: ${cap}.`,
            progress?.next && root
              ? `Call ${tool} now with ${JSON.stringify(nextArguments(progress))}. Wait for its result before answering.`
              : more
                ? `If following pages, call get_hierarchy with page ${result.next_page} using the same seed, direction, filters and page size.`
                : 'Answer with the explicit numeric descendant IDs from each requested page, once per ID. Then report the truncation flag. Exclude the seed.',
          ].join(' ');
    return {
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context },
    };
  }
}

export function reviewHierarchyReply(event, { root, tool = 'get_hierarchy' } = {}) {
  const state = readTraversal(event, root);
  if (state && state.next === null) {
    const reply = event.last_assistant_message ?? '';
    // The seed can appear in an introductory heading, but not as a listed descendant.
    const list = reply.replace(new RegExp(`\\b(?:OMOP\\s+)?concept\\s+${state.seed}\\b`, 'gi'), '');
    const counts = new Map();
    for (const id of list.match(/\b\d+\b/g) ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    const unique =
      counts.size === state.ids.length && state.ids.every((id) => counts.get(String(id)) === 1);
    const flags = new Set(
      [...reply.matchAll(/\btruncated["']?\s*[:=]\s*(true|false|unknown)\b/gi)].map((match) =>
        match[1].toLowerCase(),
      ),
    );
    const prose = reply
      .toLowerCase()
      .replace(/\b(?:not (?:been )?truncated|untruncated|no truncation)\b/g, () => {
        flags.add('false');
        return '';
      });
    if (/\b(?:was|is|has been) (?:truncated|capped)\b/.test(prose)) flags.add('true');
    const flagReported = flags.size === 1 && flags.has(String(state.truncated ?? 'unknown'));
    const mentionsHook =
      /\b(?:hooks?|PreToolUse|PostToolUse|permissionDecision(?:Reason)?)\b|mcp__(?:plugin_omophub_)?omophub__/i.test(
        reply,
      );
    if (unique && flagReported && !mentionsHook) clearTraversal(event, root);
    else if ((state.corrections ?? 0) < 3) {
      markReplyCorrection(event, state, root);
      return {
        decision: 'block',
        reason: `Use only these two lines as your final reply:\n${traversalAnswer(state)}`,
      };
    } else clearTraversal(event, root);
  } else if (state && !state.attempted && !state.reminded) {
    remindNextPage(event, state, root);
    return {
      decision: 'block',
      reason: `The requested descendant pages have not all been read. Invoke ${tool} with ${JSON.stringify(nextArguments(state))}, preserving the requested filters. Wait for the result before answering.`,
    };
  } else if (state) clearTraversal(event, root);
}
