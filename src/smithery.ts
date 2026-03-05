import { z } from 'zod';
import { createServer } from './server.js';

// Config schema — Smithery uses this to generate config UI and mock config for scanning
export const configSchema = z.object({
  omophubApiKey: z.string().describe('Your OMOPHub API key. Get one at https://omophub.com/dashboard/api-keys'),
});

// Default export — Smithery runtime calls this with { config } to create the server
export default function createMcpServer({ config }: { config: z.infer<typeof configSchema> }) {
  const mcpServer = createServer(config.omophubApiKey);
  return mcpServer.server; // Return underlying Server, not McpServer wrapper
}

// Sandbox server — Smithery calls this during scanning to discover tools/resources
// without requiring real credentials
export function createSandboxServer() {
  const mcpServer = createServer('sandbox-scanning-key');
  return mcpServer.server;
}
