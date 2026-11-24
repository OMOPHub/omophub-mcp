import { z } from 'zod';

// The catalog is finite and queries never write to an external system.
export const readAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export const conceptOutput = z.looseObject({ concept_id: z.number(), concept_name: z.string() });
export const mappingOutput = z.looseObject({ relationship_id: z.string().optional() });
export const terminologyRecord = z.record(z.string(), z.unknown());

// Some MCP clients send JSON booleans as lowercase strings.
export const booleanArgument = z
  .boolean()
  .or(z.enum(['true', 'false']).transform((value) => value === 'true'));

// Some clients serialize tool arguments as decimal strings. Validate the
// normalized value with the same schema as a JSON number.
export function numericArgument(schema: z.ZodNumber) {
  return schema.or(
    z
      .string()
      .regex(/^[0-9]{1,16}$/)
      .transform(Number)
      .pipe(schema.safe()),
  );
}

// Older clients consume the JSON text channel. Use the same payload for both representations.
export function formattedResult(text: string, json: string, isError = false) {
  const structuredContent: Record<string, unknown> = JSON.parse(json);
  return {
    content: [
      { type: 'text' as const, text },
      { type: 'text' as const, text: json },
    ],
    // Clients validate every structured payload against the success schema.
    ...(isError ? {} : { structuredContent }),
    ...(isError && { isError: true }),
  };
}

export function inputError(code: string, message: string) {
  return formattedResult(message, JSON.stringify({ error_code: code }), true);
}

export { containsRecordFields } from '../utils/record-fields.mjs';

export function recordInputError() {
  return inputError('PHI_NOT_ACCEPTED', 'Provide only a terminology code or a de-identified term.');
}
