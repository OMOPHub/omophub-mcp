import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LRUCache } from '../../src/utils/cache.js';

describe('LRUCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves values', () => {
    const cache = new LRUCache<string>(10, 60);
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('returns undefined for missing keys', () => {
    const cache = new LRUCache<string>(10, 60);
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('expires entries after TTL', () => {
    const cache = new LRUCache<string>(10, 1); // 1 minute TTL
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');

    // Advance past TTL
    vi.advanceTimersByTime(61 * 1000);
    expect(cache.get('key1')).toBeUndefined();
  });

  it('evicts least recently used when at capacity', () => {
    const cache = new LRUCache<string>(3, 60);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');

    // Access 'a' to make it recently used
    cache.get('a');

    // Add new item, should evict 'b' (least recently used)
    cache.set('d', '4');

    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('3');
    expect(cache.get('d')).toBe('4');
  });

  it('reports correct size', () => {
    const cache = new LRUCache<string>(10, 60);
    expect(cache.size).toBe(0);
    cache.set('a', '1');
    cache.set('b', '2');
    expect(cache.size).toBe(2);
  });

  it('clears all entries', () => {
    const cache = new LRUCache<string>(10, 60);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('has() checks existence with TTL', () => {
    const cache = new LRUCache<string>(10, 1);
    cache.set('key', 'val');
    expect(cache.has('key')).toBe(true);

    vi.advanceTimersByTime(61 * 1000);
    expect(cache.has('key')).toBe(false);
  });

  it('overwrites existing keys', () => {
    const cache = new LRUCache<string>(10, 60);
    cache.set('key', 'old');
    cache.set('key', 'new');
    expect(cache.get('key')).toBe('new');
    expect(cache.size).toBe(1);
  });
});
