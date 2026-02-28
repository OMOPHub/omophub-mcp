import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveApiKey } from '../../src/utils/auth.js';

describe('resolveApiKey', () => {
  const originalEnv = process.env.OMOPHUB_API_KEY;

  beforeEach(() => {
    delete process.env.OMOPHUB_API_KEY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OMOPHUB_API_KEY = originalEnv;
    } else {
      delete process.env.OMOPHUB_API_KEY;
    }
  });

  it('returns env var when OMOPHUB_API_KEY is set', () => {
    process.env.OMOPHUB_API_KEY = 'oh_env_key';
    expect(resolveApiKey()).toBe('oh_env_key');
  });

  it('returns CLI key when env var is not set', () => {
    expect(resolveApiKey('oh_cli_key')).toBe('oh_cli_key');
  });

  it('CLI key takes precedence over env var', () => {
    process.env.OMOPHUB_API_KEY = 'oh_env_key';
    expect(resolveApiKey('oh_cli_key')).toBe('oh_cli_key');
  });

  it('throws with helpful message when both are missing', () => {
    expect(() => resolveApiKey()).toThrow('OMOPHub API key required');
    expect(() => resolveApiKey()).toThrow('OMOPHUB_API_KEY');
    expect(() => resolveApiKey()).toThrow('omophub.com/dashboard/api-keys');
  });
});
