export function vocabularyId(name) {
  return name.toUpperCase() === 'RXNORM' ? 'RxNorm' : name.toUpperCase();
}

export function exactCodeArguments(prompt) {
  const pair = prompt
    .trim()
    .match(
      /^(?:please\s+)?look up\s+(ICD10CM|ICD10|SNOMED|RxNorm|LOINC|HCPCS|NDC)\s+(?:code\s+)?([A-Za-z0-9]+(?:[./_-][A-Za-z0-9]+)*)(?:\s+in OMOPHub)?[.?]?\s*(?:(?:what (?:is|are)|give me|show me) (?:its |the )?(?:source )?concept ID and name[.?]?)?$/i,
    );
  if (!pair) return;
  return {
    vocabulary_id: vocabularyId(pair[1]),
    concept_code: pair[2],
  };
}
