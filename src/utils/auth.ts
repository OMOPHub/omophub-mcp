export function resolveApiKey(cliKey?: string): string {
  const key = cliKey || process.env.OMOPHUB_API_KEY;

  if (!key) {
    throw new Error(
      'OMOPHub API key required. Set OMOPHUB_API_KEY environment variable or pass --api-key=KEY.\n' +
        'Get your free API key at: https://omophub.com/dashboard/api-keys',
    );
  }

  return key;
}
