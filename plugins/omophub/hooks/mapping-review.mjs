import { vocabularyId } from './exact-code.mjs';
import { clearState, readState, saveState } from './review-state.mjs';

const directory = 'omophub-mapping';

// Route a single explicit source and target. Leave compound mappings to the skill.
export function mappingHint(event, { root, tool = 'map_concept' } = {}) {
  const request = event.prompt
    .trim()
    .match(
      /^(?:please\s+)?map\s+(ICD10CM|ICD10|SNOMED|RxNorm|LOINC|HCPCS|NDC)\s+(?:code\s+)?([A-Za-z0-9]+(?:[./_-][A-Za-z0-9]+)*)\s+to\s+(?:standard\s+)?(ICD10CM|ICD10|SNOMED|RxNorm|LOINC|HCPCS|NDC)(?:\s+using OMOPHub)?[.?]?(?:\s+(?:show|report|list|give me)\s+(?:the\s+)?(?:source|target|relationship)\b[^.?!]*[.!?]?)?$/i,
    );
  if (!request) return;
  const args = {
    vocabulary_id: vocabularyId(request[1]),
    concept_code: request[2],
    target_vocabularies: vocabularyId(request[3]),
  };
  if (
    ['source ID', 'target ID', 'code', 'relationship'].every((field) =>
      event.prompt.toLowerCase().includes(field.toLowerCase()),
    )
  ) {
    args.on_monthly_limit = 'return_source';
    saveState(event, directory, { turn: event.turn_id, args }, root);
  }
  return `Invoke the exposed ${tool} tool now with ${JSON.stringify(args)}. This one tool performs the source lookup and mapping read. Wait for its result. Report source_concept_id and each returned target’s concept_id, concept_code and relationship_id. If mapped is null, copy the returned message into the final answer. On an error, report that the mapping could not be verified and include any quota reset. A failed mapping supplies no target.`;
}

function mappingAnswer([sourceId, targetId, code, relationship], vocabulary) {
  return `The source ID is ${sourceId}, the target ID is ${targetId}, the ${vocabulary} code is ${code}, and the relationship is ${relationship}.`;
}

function escapePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function usesSourceCodeAsName(reply, code) {
  const literal = escapePattern(code);
  const name = '\\b(?:concept[_ ]name|source name|name)';
  const assignment = new RegExp(
    `${name}["']?\\s*(?::|=|\\bis\\b)\\s*["“']?${literal}(?![\\w/-]|\\.\\w)`,
    'i',
  );
  const description = new RegExp(
    `\\b${literal}["”']?\\s+is (?:the )?(?:source )?concept name\\b`,
    'i',
  );
  return assignment.test(reply) || description.test(reply);
}

export function reviewMapping(
  event,
  { root, tool = 'mcp__omophub__map_concept', allowDefaultQuotaPolicy = false } = {},
) {
  const state = readState(event, directory, root);
  if (!state) return;
  const call = `Invoke ${tool} with ${JSON.stringify(state.args)}. Wait for the tool result before answering.`;
  if (event.hook_event_name === 'PreToolUse') {
    const valid =
      event.tool_name === tool &&
      Object.entries(state.args).every(
        ([key, value]) =>
          event.tool_input?.[key] === value ||
          (allowDefaultQuotaPolicy &&
            key === 'on_monthly_limit' &&
            event.tool_input?.[key] === undefined),
      );
    if (state.attempted || !valid || event.tool_input?.concept_id !== undefined) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: state.attempted
            ? (state.quotaAnswer ??
              (state.values
                ? `Give the user this final answer verbatim: ${mappingAnswer(state.values, state.args.target_vocabularies)}`
                : 'Reply to the user with the message from the last map_concept error, including its reset timestamp.'))
            : call,
        },
      };
    }
    saveState(event, directory, { ...state, attempted: true }, root);
    return;
  }
  if (event.hook_event_name === 'PostToolUse') {
    if (event.tool_response?.isError) return;
    const result = event.tool_response?.structuredContent;
    if (
      event.tool_name === tool &&
      state.attempted &&
      result?.mapped === null &&
      result.mapping_error?.status === 429 &&
      result.mapping_error.error_code === 'MONTHLY_LIMIT_EXCEEDED' &&
      Number.isSafeInteger(result.source_concept_id) &&
      Array.isArray(result.mappings) &&
      result.mappings.length === 0 &&
      typeof result.message === 'string'
    ) {
      const quotaAnswer = result.message;
      saveState(event, directory, { ...state, quotaAnswer, corrections: 0 }, root);
      return {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: `Write this exact final answer to the user:\n${quotaAnswer}`,
        },
      };
    }
    const row = result?.mappings?.[0];
    if (
      event.tool_name !== tool ||
      !state.attempted ||
      !result?.mapped ||
      result.has_more !== false ||
      result.mappings?.length !== 1 ||
      row?.vocabulary_id !== state.args.target_vocabularies ||
      !Number.isSafeInteger(result.source_concept_id) ||
      !Number.isSafeInteger(row.concept_id) ||
      typeof row.concept_code !== 'string' ||
      !row.concept_code ||
      typeof row.relationship_id !== 'string' ||
      !row.relationship_id
    ) {
      clearState(event, directory, root);
      return;
    }
    const values = [
      result.source_concept_id,
      row.concept_id,
      row.concept_code,
      row.relationship_id,
    ];
    // Corrections used to route the call do not count against review of its result.
    saveState(event, directory, { ...state, values, corrections: 0 }, root);
    return {
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `Return only this verified mapping sentence:\n${mappingAnswer(values, row.vocabulary_id)}`,
      },
    };
  }
  if (event.hook_event_name === 'Stop') {
    const reply = (event.last_assistant_message ?? '').replace(/[*`]/g, '').toLowerCase();
    let correction;
    if (!state.attempted) {
      correction = call;
    } else if (state.quotaAnswer) {
      if (reply.trim() !== state.quotaAnswer.toLowerCase())
        correction = `Copy this verified quota message as the entire final reply:\n${state.quotaAnswer}`;
    } else if (state.values) {
      const labels = [
        '\\bsource(?: omop)?(?: concept)? id',
        '\\btarget(?: omop)?(?: concept)? id',
        `(?:\\b(?:${state.args.target_vocabularies}|target)(?: vocabulary| concept)? code|^\\s*[-•]?\\s*code)`,
        '\\brelationship(?: id)?',
      ];
      const complete = state.values.every((value, i) => {
        const literal = escapePattern(value);
        const expected = new RegExp(`^${literal}(?![\\w/-]|\\.\\w)`, 'i');
        const assignments = [
          ...reply.matchAll(new RegExp(`${labels[i]}\\s*(?::|=|\\bis\\b)\\s*["“']?`, 'gim')),
        ];
        return (
          assignments.length > 0 &&
          assignments.every((match) => expected.test(reply.slice(match.index + match[0].length)))
        );
      });
      if (!complete || usesSourceCodeAsName(reply, state.args.concept_code)) {
        correction = `Copy this verified mapping as the entire final reply:\n${mappingAnswer(state.values, state.args.target_vocabularies)}`;
      }
    } else {
      // Codex skips PostToolUse on MCP errors. The first text block already
      // contains the user-facing explanation, including any allowance reset.
      const unverified =
        /(?:could not|cannot|unable to) verify|(?:not|never) verified|unverified|could not be verified|(?:returned an error|mapping (?:call )?failed)\b/i.test(
          reply,
        );
      const quota = /quota|allowance|monthly|rate limit|429/i.test(reply);
      const explained = quota
        ? /reset|retry/i.test(reply)
        : /invalid|missing|not found|denied|unauthori[sz]ed|unavailable|timed? out/i.test(reply);
      if (!unverified || !explained || /(?:target (?:id|code)|relationship)\s*[:=]/i.test(reply))
        correction =
          'Copy the first human-readable text block from the map_concept error into your final answer. It explains why OMOPHub could not verify the mapping. Include the reported reset if present.';
    }
    if (correction && (state.corrections ?? 0) < 2) {
      saveState(event, directory, { ...state, corrections: (state.corrections ?? 0) + 1 }, root);
      return { decision: 'block', reason: correction };
    }
    clearState(event, directory, root);
  }
}
