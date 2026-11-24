import { clearState, readState, saveState } from './review-state.mjs';

const directory = 'omophub-hierarchy';
const save = (event, state, root) => saveState(event, directory, state, root);
export const readTraversal = (event, root) => readState(event, directory, root);
export const clearTraversal = (event, root) => clearState(event, directory, root);

export function beginTraversal(event, seed, size, root) {
  save(event, { turn: event.turn_id, seed, size, next: 1, ids: [], truncated: false }, root);
}
export function noteAttempt(event, state, root) {
  save(event, { ...state, attempted: true }, root);
}
export function remindNextPage(event, state, root) {
  save(event, { ...state, reminded: true }, root);
}
export function nextArguments(state) {
  return {
    concept_id: state.seed,
    direction: 'down',
    page: state.next,
    page_size: state.size,
    ...state.filters,
  };
}

export function sameFilters(args, filters) {
  return (
    Number(args.max_levels ?? 10) === Number(filters.max_levels ?? 10) &&
    (args.vocabulary_ids || '') === (filters.vocabulary_ids || '')
  );
}

export function incompleteAnswer(state) {
  const ids = state.ids.length ? ` Verified descendant OMOP IDs: ${state.ids.join(', ')}.` : '';
  const truncation =
    state.truncated === true ? 'A verified page was truncated.' : 'Overall truncation is unknown.';
  return `Incomplete coverage: page ${state.next} could not be verified.${ids} ${truncation}`;
}

export function markReplyCorrection(event, state, root) {
  save(event, { ...state, corrections: (state.corrections ?? 0) + 1 }, root);
}

export function addPage(event, result, root) {
  const state = readTraversal(event, root);
  const p = result.pagination;
  if (!state || state.seed !== result.concept_id || !p || state.next !== p.page) return;
  if (!Number.isSafeInteger(p.page_size) || p.page_size < 1) return;
  const args = event.tool_input ?? {};
  const shape = JSON.stringify([p.page_size, p.total_pages, p.total_items]);
  if (
    (state.size && p.page_size !== state.size) ||
    (state.shape && state.shape !== shape) ||
    (state.filters && !sameFilters(args, state.filters))
  )
    return;
  if (
    typeof p.has_next !== 'boolean' ||
    p.has_next !== result.has_more ||
    (p.has_next && result.next_page !== p.page + 1) ||
    (!p.has_next && p.page < p.total_pages)
  )
    return;
  const ids = result.descendants.map((node) => node.concept_id);
  if (!ids.every(Number.isSafeInteger)) return;
  state.ids = [...new Set([...state.ids, ...ids.filter((id) => id !== state.seed)])];
  state.shape = shape;
  state.size = p.page_size;
  state.filters = {
    max_levels: args.max_levels == null ? undefined : Number(args.max_levels),
    vocabulary_ids: args.vocabulary_ids || undefined,
  };
  state.attempted = false;
  state.reminded = false;
  state.next = p.has_next ? p.page + 1 : null;
  if (result.truncated === true) state.truncated = true;
  else if (result.truncated !== false && state.truncated !== true) state.truncated = null;
  save(event, state, root);
  return state;
}

export function traversalAnswer(state) {
  return `Descendant OMOP IDs: ${state.ids.join(', ') || 'none'}\nTruncated: ${state.truncated ?? 'unknown'}`;
}
