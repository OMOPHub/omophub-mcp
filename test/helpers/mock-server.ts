import { vi } from 'vitest';

// biome-ignore lint/suspicious/noExplicitAny: generic handler type for test mocks
type HandlerFn = (...args: any[]) => any;

export function createMockServer() {
  const tools = new Map<string, HandlerFn>();
  const resources = new Map<string, HandlerFn>();
  const prompts = new Map<string, HandlerFn>();

  return {
    tool: vi.fn((name: string, _desc: string, _schema: unknown, handler: HandlerFn) => {
      tools.set(name, handler);
    }),
    resource: vi.fn((name: string, _uriOrTemplate: unknown, handler: HandlerFn) => {
      resources.set(name, handler);
    }),
    prompt: vi.fn((name: string, _desc: string, _schema: unknown, handler: HandlerFn) => {
      prompts.set(name, handler);
    }),
    connect: vi.fn(),
    tools,
    resources,
    prompts,
  };
}

export function createMockClient() {
  return {
    request: vi.fn(),
    post: vi.fn(),
  };
}
