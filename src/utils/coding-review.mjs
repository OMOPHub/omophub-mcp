import { clearState, readState, saveState } from './review-state.mjs';

const directory = 'omophub-coding';
const unverifiedAnswer = 'OMOPHub could not verify a concept or CDM table for this Coding.';
// A standalone Coding has one system and one literal code. Leave compound
// requests and CodeableConcept arrays to the shared skill.
export function singleCodingHint(event, { root, tool = 'fhir_resolve' } = {}) {
  const prompt = event.prompt;
  if (!/\bCoding\b/i.test(prompt) || /\b(?:CodeableConcept|codings)\b/i.test(prompt)) return;
  const pairs = [
    ...prompt.matchAll(
      /\bsystem\s+(https?:\/\/[^\s,`"'<>]+|urn:[^\s,`"'<>]+)\s+and\s+code\s+([^\s,`"'<>]+?)(?=[.!?]?(?:\s|$))/gi,
    ),
  ];
  if (pairs.length !== 1) return;
  const [, system, code] = pairs[0];
  const args = { system, code };
  const resource = prompt.match(/\bFHIR\s+([A-Z][a-z][A-Za-z]*)\b/);
  if (resource && !['Coding', 'CodeableConcept'].includes(resource[1]))
    args.resource_type = resource[1];
  if (
    /\bstandard (?:OMOP )?concept\b/i.test(prompt) &&
    /\b(?:CDM|destination|target) table\b/i.test(prompt)
  ) {
    // Restrict tool selection only for an explicit single operation. Compound
    // requests can use other tools even when their first step resolves a Coding.
    const beforeSystem = prompt.slice(0, pairs[0].index).trim();
    const afterCode = prompt.slice(pairs[0].index + pairs[0][0].length).trim();
    const resolutionOnly =
      /^(?:for (?:an? )?FHIR [A-Za-z]+,\s*)?(?:please )?resolve (?:just|only) (?:the |this )?Coding(?: with)?$/i.test(
        beforeSystem,
      ) &&
      /^[.?!,]?\s*(?:which|what|give|show|report|return)\s+(?:(?:the|its|me|is|are|standard|OMOP|concept|ID|and|CDM|target|destination|table|does|OMOPHub|return)\b[\s,]*)+[.?!]?$/i.test(
        afterCode,
      );
    saveState(event, directory, { turn: event.turn_id, args, resolutionOnly }, root);
  }
  return `Use the exposed ${tool} tool now. Call it once with the supplied Coding fields ${JSON.stringify(args)}. Keep the URI and the literal code in separate string fields. Include other options only when requested. On success, read the numeric OMOP ID from data.resolution.standard_concept.concept_id and the CDM table from data.resolution.target_table. On an input error, tell the user the Coding input was rejected and ask for corrected fields. Only report a limit when the tool returns a rate or quota error.`;
}

function resolutionOutcome(response) {
  if (response?.isError) {
    // Error responses carry their JSON in the text channel of the MCP protocol.
    for (const block of response.content ?? []) {
      if (block.type !== 'text') continue;
      if (block.text.startsWith('MCP error -32602:')) {
        return {
          invalid: true,
          answer: 'OMOPHub rejected the Coding arguments. Please check the supplied fields.',
        };
      }
      if (!block.text.startsWith('{')) continue;
      try {
        const error = JSON.parse(block.text);
        if (error.error_code === 'INVALID_INPUT' && error.status === 400) {
          return {
            invalid: true,
            answer:
              'OMOPHub rejected the Coding input (HTTP 400). Please check the code, system URI and resource type.',
          };
        }
      } catch {
        /* Plain text is also a valid MCP content block. */
      }
    }
    return;
  }
  const data = response?.structuredContent;
  const result = data?.data?.resolution;
  const id = result?.standard_concept?.concept_id;
  const table = result?.target_table;
  if (
    data?.success === true &&
    Number.isSafeInteger(id) &&
    id > 0 &&
    typeof table === 'string' &&
    /^[a-z][a-z0-9_]*$/.test(table)
  ) {
    return {
      id,
      table,
      answer: `The standard OMOP concept is ${id} and the CDM table is ${table}.`,
    };
  }
}

export function reviewCoding(event, { root, tool = 'mcp__omophub__fhir_resolve' } = {}) {
  const state = readState(event, directory, root);
  if (!state) return;
  const call = `Call fhir_resolve with the supplied fields ${JSON.stringify(state.args)}. Keep the system and code separate.`;
  const outcome = state.outcome;
  // Codex can omit PostToolUse on failure. Without a verified response the
  // resolution-only reply must not turn the request's code or URI into a result.
  const failureAnswer =
    state.resolutionOnly && state.attempted && !state.receivedSuccess
      ? (outcome?.answer ?? unverifiedAnswer)
      : undefined;
  const answer = outcome?.answer ?? failureAnswer;
  switch (event.hook_event_name) {
    case 'PreToolUse': {
      if (!state.resolutionOnly && ![tool, `${tool}_codeable_concept`].includes(event.tool_name))
        return;
      const valid =
        event.tool_name === tool &&
        Object.entries(state.args).every(([field, value]) => event.tool_input?.[field] === value);
      if (!valid || state.attempted) {
        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: answer
              ? `Give the user this final answer verbatim: ${answer}`
              : state.attempted
                ? 'This single Coding lookup has already been attempted. Report its returned result or error.'
                : call,
          },
        };
      }
      saveState(event, directory, { ...state, attempted: true }, root);
      break;
    }
    case 'PostToolUse': {
      if (event.tool_name !== tool || !state.attempted) return;
      const verified = resolutionOutcome(event.tool_response);
      if (!verified) {
        if (
          !event.tool_response?.isError &&
          event.tool_response?.structuredContent?.success === true
        ) {
          saveState(event, directory, { ...state, receivedSuccess: true }, root);
        }
        return;
      }
      saveState(
        event,
        directory,
        {
          ...state,
          outcome: verified,
          receivedSuccess: !verified.invalid,
          corrections: 0,
        },
        root,
      );
      return {
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext:
            state.resolutionOnly && verified.id
              ? `Return only this verified concept and table:\n${verified.answer}`
              : `Write this sentence in the final answer:\n${verified.answer}`,
        },
      };
    }
    case 'Stop': {
      const reply = event.last_assistant_message ?? '';
      if (failureAnswer) {
        if (reply.trim() !== failureAnswer) {
          return {
            decision: 'block',
            reason: `Return only this sentence verbatim:\n${failureAnswer}`,
          };
        }
        clearState(event, directory, root);
        return;
      }
      // This request asks only for the numeric ID and table. Keep a draft
      // containing the standalone status flag out of the general retry fallback.
      if (
        state.resolutionOnly &&
        outcome?.id &&
        reply.trim() !== outcome.answer &&
        /(?<!\w['’])\bS\b/i.test(reply)
      ) {
        return {
          decision: 'block',
          reason: `Return only this verified concept and table:\n${outcome.answer}`,
        };
      }
      const complete = outcome?.invalid
        ? /invalid|reject|bad request|HTTP 400|validation|malformed|unsupported character/i.test(
            reply,
          ) && !/quota|monthly limit|record fields|reconnect/i.test(reply)
        : outcome &&
          new RegExp(`\\b${outcome.id}\\b`).test(reply) &&
          new RegExp(`\\b${outcome.table}\\b`).test(reply) &&
          !(state.resolutionOnly && /\b(?:release|version)\b/i.test(reply));
      // Codex skips PostToolUse when MCP sets isError. In that case the
      // assistant can see the tool error but this hook cannot classify it.
      if (!outcome && state.attempted && !state.reviewedError) {
        saveState(event, directory, { ...state, reviewedError: true }, root);
        return {
          decision: 'block',
          reason:
            'Read the last fhir_resolve response already in context. Quote its specific result or error in your final answer. For INVALID_INPUT (HTTP 400), state that the Coding input was invalid and which field needs correction if supplied. A 429 has its own tool message. Do not make another call.',
        };
      }
      if (!complete && (outcome || !state.attempted) && (state.corrections ?? 0) < 3) {
        saveState(event, directory, { ...state, corrections: (state.corrections ?? 0) + 1 }, root);
        return {
          decision: 'block',
          reason: outcome
            ? `Copy this sentence verbatim into your final answer:\n${outcome.answer}`
            : call,
        };
      }
      clearState(event, directory, root);
      break;
    }
  }
}
