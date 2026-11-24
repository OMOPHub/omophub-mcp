export const recordInputClarification =
  'Please send just the terminology term or code, with all record fields removed.';

// Shared by the local prompt hook and the tool server. FHIR terminology Coding
// objects and queries such as "patient education" can pass both checks.
const chartLabel =
  /\b(?:MRN|medical[ _]record[ _]number|patient[ _](?:name|id)|date[ _]of[ _]birth|birthDate|DOB)["']?\s*[:=#]/i;
const recordTypes =
  'Patient|Encounter|Observation|Condition|Bundle|DiagnosticReport|MedicationRequest';
const fhirType = new RegExp(`^(?:${recordTypes})$`, 'i');
const fhirRecord = new RegExp(
  String.raw`["']resourceType["']\s*:\s*["'](?:${recordTypes})["']`,
  'i',
);

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
        (key === 'resourceType' && typeof field === 'string' && fhirType.test(field)) ||
        containsRecordFields(field),
    );
  }
  return false;
}
