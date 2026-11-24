import { createHash } from 'node:crypto';
import { vocabularyId } from './exact-code.mjs';
import { clearState, readState, saveState } from './review-state.mjs';

const directory = 'omophub-verified-search';
const codexSearch = 'mcp__omophub__search_concepts';
const digest = (query) => createHash('sha256').update(query).digest('hex');

export function beginVerifiedSearch(event, args, root) {
  saveState(
    event,
    directory,
    {
      turn: event.turn_id,
      vocabulary: args.vocabulary_ids,
      queryHash: digest(args.query),
    },
    root,
  );
}

// Keep ordinary candidate searches on their single-read path. Quoting
// delimits the search term from the user's instructions about verification.
export function verifiedSearchHint(event, { root, tool = 'search_concepts' } = {}) {
  const prompt = event.prompt;
  const request = prompt
    .trim()
    .match(
      /^(?:please\s+)?search\s+(ICD10CM|ICD10|SNOMED|RxNorm|LOINC|HCPCS|NDC)(?:\s+in OMOPHub)?\s+for\s+(?:"([^"\n]+)"|“([^”\n]+)”)[.,;]?\s+([\s\S]+)$/i,
    );
  if (
    !request ||
    !/^(?:please\s+)?(?:look up|verify) (?:the )?matching concept\b/i.test(request[4])
  )
    return;
  const args = {
    query: request[2] ?? request[3],
    vocabulary_ids: vocabularyId(request[1]),
    verify_match: true,
  };
  if (
    /\bOMOP ID\b/i.test(request[4]) &&
    /\bcode\b/i.test(request[4]) &&
    /\bvocabulary release\b/i.test(request[4])
  )
    beginVerifiedSearch(event, args, root);
  return `Invoke the exposed ${tool} tool now with ${JSON.stringify(args)}. A unique match includes the completed detail lookup. In the final reply, copy the OMOP concept_id, the vocabulary concept_code, and the complete vocab_release string from verified_concept. Preserve the release prefix and every digit. If the result has no verified_concept, use the actual candidates or report the error.`;
}

function containsIdentifier(reply, value) {
  const literal = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w.-])${literal}(?![\\w-]|\\.\\w)`).test(reply);
}

function inspect(event, state, search, root) {
  const lookup = `Invoke search_concepts with the original quoted term as query, vocabulary_ids "${state.vocabulary}", and verify_match set to the JSON boolean true. Omit unrequested parameters.`;
  const match = state.match;
  const answer =
    match &&
    `OMOP ID: ${match.id}\n${state.vocabulary} code: ${match.code}\nVocabulary release: ${match.release}`;
  switch (event.hook_event_name) {
    case 'PreToolUse': {
      const args = event.tool_input;
      if (
        state.attempted ||
        event.tool_name !== search ||
        (args?.verify_match !== true && args?.verify_match !== 'true') ||
        args.vocabulary_ids !== state.vocabulary ||
        typeof args.query !== 'string' ||
        digest(args.query) !== state.queryHash ||
        (args.standard_concept !== undefined && !['S', 'C'].includes(args.standard_concept))
      ) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              answer ?? (state.attempted ? 'Report the previous search result or error.' : lookup),
          },
        };
      }
      saveState(event, directory, { ...state, attempted: true }, root);
      break;
    }
    case 'PostToolUse': {
      const verified = event.tool_response?.structuredContent?.verified_concept;
      if (!state.attempted || event.tool_name !== search) return;
      // A result without a verified release needs the normal candidate or error workflow.
      if (
        event.tool_response?.isError ||
        verified?.vocabulary_id !== state.vocabulary ||
        !Number.isSafeInteger(verified.concept_id) ||
        typeof verified.concept_code !== 'string' ||
        !verified.concept_code ||
        typeof verified.vocab_release !== 'string' ||
        !verified.vocab_release
      ) {
        clearState(event, directory, root);
        return;
      }
      const result = {
        id: verified.concept_id,
        code: verified.concept_code,
        release: verified.vocab_release,
      };
      saveState(event, directory, { ...state, match: result }, root);
      return {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `Copy the verified values into the final reply.\nOMOP ID: ${result.id}\n${state.vocabulary} code: ${result.code}\nVocabulary release: ${result.release}`,
        },
      };
    }
    case 'Stop': {
      const reply = event.last_assistant_message ?? '';
      const complete =
        match &&
        [match.id, match.code, match.release].every((value) => containsIdentifier(reply, value));
      if (!complete && (!state.attempted || match) && (state.corrections ?? 0) < 3) {
        saveState(event, directory, { ...state, corrections: (state.corrections ?? 0) + 1 }, root);
        return {
          decision: 'block',
          reason: answer
            ? `The search and detail reads are complete. Report these verified values verbatim:\n${answer}`
            : lookup,
        };
      }
      clearState(event, directory, root);
    }
  }
}

export function reviewVerifiedSearch(event, { root, tool = codexSearch } = {}) {
  const state = readState(event, directory, root);
  return state && inspect(event, state, tool, root);
}
