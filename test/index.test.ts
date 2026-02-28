import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies before importing
vi.mock('../src/server.js', () => ({
  createServer: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('../src/health.js', () => ({
  startHealthServer: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { startHealthServer } from '../src/health.js';
import { main, parseArgs, resolveHealthPort } from '../src/index.js';
import { createServer } from '../src/server.js';
import { logger } from '../src/utils/logger.js';

describe('parseArgs', () => {
  it('parses --api-key argument', () => {
    const args = parseArgs(['node', 'script', '--api-key=oh_test123']);
    expect(args.apiKey).toBe('oh_test123');
  });

  it('parses --base-url argument', () => {
    const args = parseArgs(['node', 'script', '--base-url=https://custom.api.com/v1']);
    expect(args.baseUrl).toBe('https://custom.api.com/v1');
  });

  it('parses --health-port argument', () => {
    const args = parseArgs(['node', 'script', '--health-port=8080']);
    expect(args.healthPort).toBe(8080);
  });

  it('parses all arguments together', () => {
    const args = parseArgs([
      'node',
      'script',
      '--api-key=oh_key',
      '--base-url=https://api.test.com/v1',
      '--health-port=9090',
    ]);
    expect(args.apiKey).toBe('oh_key');
    expect(args.baseUrl).toBe('https://api.test.com/v1');
    expect(args.healthPort).toBe(9090);
  });

  it('ignores invalid port values', () => {
    expect(parseArgs(['node', 'script', '--health-port=abc']).healthPort).toBeUndefined();
    expect(parseArgs(['node', 'script', '--health-port=0']).healthPort).toBeUndefined();
    expect(parseArgs(['node', 'script', '--health-port=99999']).healthPort).toBeUndefined();
    expect(parseArgs(['node', 'script', '--health-port=-1']).healthPort).toBeUndefined();
  });

  it('returns empty object with no relevant args', () => {
    const args = parseArgs(['node', 'script']);
    expect(args.apiKey).toBeUndefined();
    expect(args.baseUrl).toBeUndefined();
    expect(args.healthPort).toBeUndefined();
  });

  it('ignores unrecognized arguments', () => {
    const args = parseArgs(['node', 'script', '--unknown=value', '--foo']);
    expect(args.apiKey).toBeUndefined();
    expect(args.baseUrl).toBeUndefined();
    expect(args.healthPort).toBeUndefined();
  });
});

describe('resolveHealthPort', () => {
  const originalEnv = process.env.HEALTH_PORT;

  beforeEach(() => {
    delete process.env.HEALTH_PORT;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.HEALTH_PORT = originalEnv;
    } else {
      delete process.env.HEALTH_PORT;
    }
  });

  it('returns CLI port when provided', () => {
    expect(resolveHealthPort(8080)).toBe(8080);
  });

  it('CLI port takes precedence over env var', () => {
    process.env.HEALTH_PORT = '9090';
    expect(resolveHealthPort(8080)).toBe(8080);
  });

  it('returns env var port when CLI port is not provided', () => {
    process.env.HEALTH_PORT = '9090';
    expect(resolveHealthPort()).toBe(9090);
  });

  it('returns undefined when env var is invalid', () => {
    process.env.HEALTH_PORT = 'abc';
    expect(resolveHealthPort()).toBeUndefined();
  });

  it('returns undefined when env var is out of range', () => {
    process.env.HEALTH_PORT = '99999';
    expect(resolveHealthPort()).toBeUndefined();
  });

  it('returns undefined when nothing is provided', () => {
    expect(resolveHealthPort()).toBeUndefined();
  });
});

describe('main', () => {
  const originalApiKey = process.env.OMOPHUB_API_KEY;
  const originalHealthPort = process.env.HEALTH_PORT;
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OMOPHUB_API_KEY;
    delete process.env.HEALTH_PORT;
    process.argv = ['node', 'script'];
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (originalApiKey !== undefined) {
      process.env.OMOPHUB_API_KEY = originalApiKey;
    } else {
      delete process.env.OMOPHUB_API_KEY;
    }
    if (originalHealthPort !== undefined) {
      process.env.HEALTH_PORT = originalHealthPort;
    } else {
      delete process.env.HEALTH_PORT;
    }
  });

  it('starts server when API key is available', async () => {
    process.env.OMOPHUB_API_KEY = 'oh_test_key';

    await main();

    expect(createServer).toHaveBeenCalledWith('oh_test_key', undefined);
    expect(logger.info).toHaveBeenCalledWith('Starting OMOPHub MCP server (stdio transport)');
  });

  it('exits with code 1 when API key is missing', async () => {
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await main();

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalled();

    mockExit.mockRestore();
  });

  it('starts health server when health port is provided via CLI', async () => {
    process.env.OMOPHUB_API_KEY = 'oh_test_key';
    process.argv = ['node', 'script', '--health-port=8080'];

    await main();

    expect(startHealthServer).toHaveBeenCalledWith(8080);
  });

  it('does not start health server when no port specified', async () => {
    process.env.OMOPHUB_API_KEY = 'oh_test_key';

    await main();

    expect(startHealthServer).not.toHaveBeenCalled();
  });

  it('passes base URL from CLI args', async () => {
    process.env.OMOPHUB_API_KEY = 'oh_test_key';
    process.argv = ['node', 'script', '--base-url=https://custom.api.com/v1'];

    await main();

    expect(createServer).toHaveBeenCalledWith('oh_test_key', 'https://custom.api.com/v1');
  });
});
