export const recordInputClarification =
  'Please send just the terminology term or code, with all record fields removed.';

// Shared by the local prompt hook and the tool server. FHIR terminology Coding
// objects and queries such as "patient education" can pass both checks.
const chartLabel =
  /\b(?:MRN|medical[ _]?record[ _]?number|patient[ _]?(?:name|id)|date[ _]?of[ _]?birth|birthDate|DOB)["']?\s*[:=#]/i;
// Coding and CodeableConcept are terminology datatypes. A resourceType field
// identifying any other FHIR type signals a whole resource, including future types.
const fhirRecord =
  /["']resourceType["']\s*:\s*["'](?!(?:Coding|CodeableConcept)["'])[a-z][a-z0-9]*["']/i;
const terminologyType = /^(?:Coding|CodeableConcept)$/i;

/** @param {unknown} value
 * @returns {boolean}
 */
export function containsRecordFields(value) {
  if (typeof value === 'string') return chartLabel.test(value) || fhirRecord.test(value);
  if (Array.isArray(value)) return value.some(containsRecordFields);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(
      ([key, field]) =>
        chartLabel.test(`${key}:`) ||
        (key.toLowerCase() === 'resourcetype' &&
          typeof field === 'string' &&
          !terminologyType.test(field)) ||
        containsRecordFields(field),
    );
  }
  return false;
}
