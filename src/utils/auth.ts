export function resolveApiKey(cliKey?: string): string | undefined {
  return cliKey || process.env.OMOPHUB_API_KEY || undefined;
}
