import { containsRecordFields, recordInputClarification } from './record-fields.mjs';

const treatmentScope =
  'OMOPHub looks up terminology codes and concepts. I can help identify a medication code, but I cannot recommend which medicine to take.';

// Match requests to choose a treatment. Drug names and vocabulary lookups
// on their own are ordinary terminology input.
const personalChoice =
  /\b(?:which|what)\s+(?:medicine|medication|drug|treatment)s?\s+(?:(?:should|can)\s+I|I\s+(?:should|can))\s+(?:take|use|start|choose)\b/i;
const recommendTreatment =
  /\b(?:recommend|suggest|prescribe)\s+(?:me\s+)?(?:(?:an?|the|some)\s+)?(?:medicine|medication|drug|treatment)s?\b(?=\s*(?:[.?!]|$|for\b|to\s+(?:take|treat)\b))/i;

// Scope the write guard to a vocabulary destination. Adding a synonym to
// someone's notes, or asking to list existing synonyms, is a different request.
const synonymWrite =
  /(?:^|[.!?]\s+)(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:use OMOPHub to\s+)?(?:add|create|save|update|edit|remove|delete)\s+(?:(?:a|an|the|this|that|new|existing)\s+)*synonyms?\s+(?:["“][^"”\n]+["”]\s+)?(?:to|for|on|from|in)\s+(?:(?:the|OMOP)\s+)*(?:concept(?:\s+ID)?\s*[:#]?\s*\d+\b|OMOPHub\b)/i;
const readOnlyScope =
  'OMOPHub is read-only. I can look up existing synonyms, but I cannot add or save a synonym.';

export function terminologyScopeFeedback(prompt) {
  if (typeof prompt !== 'string' || containsRecordFields(prompt)) return recordInputClarification;
  if (personalChoice.test(prompt) || recommendTreatment.test(prompt)) return treatmentScope;
  if (synonymWrite.test(prompt.trim())) return readOnlyScope;
}
