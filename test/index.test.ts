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

vi.mock('../src/transports/http.js', () => ({
  startHttpTransport: vi.fn().mockResolvedValue(undefined),
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
import { main, parseArgs, resolveHealthPort, resolvePort, resolveTransport } from '../src/index.js';
import { createServer } from '../src/server.js';
import { startHttpTransport } from '../src/transports/http.js';
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

  it('parses --transport argument', () => {
    expect(parseArgs(['node', 'script', '--transport=http']).transport).toBe('http');
    expect(parseArgs(['node', 'script', '--transport=stdio']).transport).toBe('stdio');
  });

  it('ignores invalid transport values', () => {
    expect(parseArgs(['node', 'script', '--transport=invalid']).transport).toBeUndefined();
    expect(parseArgs(['node', 'script', '--transport=websocket']).transport).toBeUndefined();
  });

  it('parses --port argument', () => {
    const args = parseArgs(['node', 'script', '--port=4000']);
    expect(args.port).toBe(4000);
  });

  it('ignores invalid port values', () => {
    expect(parseArgs(['node', 'script', '--port=abc']).port).toBeUndefined();
    expect(parseArgs(['node', 'script', '--port=0']).port).toBeUndefined();
    expect(parseArgs(['node', 'script', '--port=99999']).port).toBeUndefined();
    expect(parseArgs(['node', 'script', '--port=-1']).port).toBeUndefined();
  });

  it('parses all arguments together', () => {
    const args = parseArgs([
      'node',
      'script',
      '--api-key=oh_key',
      '--base-url=https://api.test.com/v1',
      '--health-port=9090',
      '--transport=http',
      '--port=4000',
    ]);
    expect(args.apiKey).toBe('oh_key');
    expect(args.baseUrl).toBe('https://api.test.com/v1');
    expect(args.healthPort).toBe(9090);
    expect(args.transport).toBe('http');
    expect(args.port).toBe(4000);
  });

  it('ignores invalid health-port values', () => {
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
    expect(args.transport).toBeUndefined();
    expect(args.port).toBeUndefined();
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

describe('resolveTransport', () => {
  const originalEnv = process.env.MCP_TRANSPORT;

  beforeEach(() => {
    delete process.env.MCP_TRANSPORT;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MCP_TRANSPORT = originalEnv;
    } else {
      delete process.env.MCP_TRANSPORT;
    }
  });

  it('returns CLI transport when provided', () => {
    expect(resolveTransport('http')).toBe('http');
    expect(resolveTransport('stdio')).toBe('stdio');
  });

  it('CLI transport takes precedence over env var', () => {
    process.env.MCP_TRANSPORT = 'http';
    expect(resolveTransport('stdio')).toBe('stdio');
  });

  it('returns env var transport when CLI is not provided', () => {
    process.env.MCP_TRANSPORT = 'http';
    expect(resolveTransport()).toBe('http');
  });

  it('returns stdio when env var is invalid', () => {
    process.env.MCP_TRANSPORT = 'websocket';
    expect(resolveTransport()).toBe('stdio');
  });

  it('defaults to stdio', () => {
    expect(resolveTransport()).toBe('stdio');
  });
});

describe('resolvePort', () => {
  const originalEnv = process.env.MCP_PORT;

  beforeEach(() => {
    delete process.env.MCP_PORT;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.MCP_PORT = originalEnv;
    } else {
      delete process.env.MCP_PORT;
    }
  });

  it('returns CLI port when provided', () => {
    expect(resolvePort(4000)).toBe(4000);
  });

  it('CLI port takes precedence over env var', () => {
    process.env.MCP_PORT = '5000';
    expect(resolvePort(4000)).toBe(4000);
  });

  it('returns env var port when CLI is not provided', () => {
    process.env.MCP_PORT = '5000';
    expect(resolvePort()).toBe(5000);
  });

  it('returns default 3100 when env var is invalid', () => {
    process.env.MCP_PORT = 'abc';
    expect(resolvePort()).toBe(3100);
  });

  it('defaults to 3100', () => {
    expect(resolvePort()).toBe(3100);
  });
});

describe('main', () => {
  const originalApiKey = process.env.OMOPHUB_API_KEY;
  const originalHealthPort = process.env.HEALTH_PORT;
  const originalTransport = process.env.MCP_TRANSPORT;
  const originalPort = process.env.MCP_PORT;
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OMOPHUB_API_KEY;
    delete process.env.HEALTH_PORT;
    delete process.env.MCP_TRANSPORT;
    delete process.env.MCP_PORT;
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
    if (originalTransport !== undefined) {
      process.env.MCP_TRANSPORT = originalTransport;
    } else {
      delete process.env.MCP_TRANSPORT;
    }
    if (originalPort !== undefined) {
      process.env.MCP_PORT = originalPort;
    } else {
      delete process.env.MCP_PORT;
    }
  });

  it('starts server with stdio transport by default', async () => {
    process.env.OMOPHUB_API_KEY = 'oh_test_key';

    await main();

    expect(createServer).toHaveBeenCalledWith('oh_test_key', undefined);
    expect(logger.info).toHaveBeenCalledWith('Starting OMOPHub MCP server (stdio transport)');
    expect(startHttpTransport).not.toHaveBeenCalled();
  });

  it('starts server with http transport when specified', async () => {
    process.env.OMOPHUB_API_KEY = 'oh_test_key';
    process.argv = ['node', 'script', '--transport=http'];

    await main();

    expect(createServer).toHaveBeenCalledWith('oh_test_key', undefined);
    expect(logger.info).toHaveBeenCalledWith('Starting OMOPHub MCP server (http transport)');
    expect(startHttpTransport).toHaveBeenCalled();
  });

  it('passes custom port to http transport', async () => {
    process.env.OMOPHUB_API_KEY = 'oh_test_key';
    process.argv = ['node', 'script', '--transport=http', '--port=4000'];

    await main();

    expect(startHttpTransport).toHaveBeenCalledWith(expect.anything(), 4000);
  });

  it('uses default port 3100 for http transport', async () => {
    process.env.OMOPHUB_API_KEY = 'oh_test_key';
    process.argv = ['node', 'script', '--transport=http'];

    await main();

    expect(startHttpTransport).toHaveBeenCalledWith(expect.anything(), 3100);
  });

  it('exits with code 1 when API key is missing', async () => {
    const exitError = new Error('process.exit called');
    const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw exitError;
    });

    await expect(main()).rejects.toThrow(exitError);

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

  it('does not start standalone health server in http mode', async () => {
    process.env.OMOPHUB_API_KEY = 'oh_test_key';
    process.argv = ['node', 'script', '--transport=http', '--health-port=8080'];

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
