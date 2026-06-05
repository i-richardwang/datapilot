import { describe, expect, it } from 'bun:test';
import { parseKeys, pickKey } from './key-pool.ts';

describe('parseKeys (env-layer comma splitting)', () => {
  it('returns an empty list for undefined / non-string / blank values', () => {
    expect(parseKeys(undefined)).toEqual([]);
    expect(parseKeys('')).toEqual([]);
    expect(parseKeys('   ')).toEqual([]);
    expect(parseKeys(',')).toEqual([]);
    expect(parseKeys(' , , ')).toEqual([]);
  });

  it('returns a single-element list for one key (pre-fork behavior)', () => {
    expect(parseKeys('key_a')).toEqual(['key_a']);
    expect(parseKeys('  key_a  ')).toEqual(['key_a']);
  });

  it('splits comma-separated keys and trims each', () => {
    expect(parseKeys('key_a,key_b,key_c')).toEqual(['key_a', 'key_b', 'key_c']);
    expect(parseKeys('key_a, key_b , key_c')).toEqual(['key_a', 'key_b', 'key_c']);
  });

  it('drops blank segments and dedupes', () => {
    expect(parseKeys('key_a,,key_b,')).toEqual(['key_a', 'key_b']);
    expect(parseKeys('key_a,key_a,key_b')).toEqual(['key_a', 'key_b']);
  });
});

describe('pickKey (request-layer random selection)', () => {
  it('throws when no usable key is present', () => {
    expect(() => pickKey([])).toThrow();
    expect(() => pickKey('')).toThrow();
    expect(() => pickKey('   ')).toThrow();
    expect(() => pickKey([' ', ''])).toThrow();
  });

  it('returns the only key for a single string or single-element array', () => {
    expect(pickKey('key_a')).toBe('key_a');
    expect(pickKey('  key_a  ')).toBe('key_a');
    expect(pickKey(['key_a'])).toBe('key_a');
  });

  it('always returns a member of the configured pool', () => {
    const pool = ['key_a', 'key_b', 'key_c'];
    for (let i = 0; i < 200; i++) {
      expect(pool).toContain(pickKey(pool));
    }
  });

  it('spreads across the pool over many calls (not pinned to one key)', () => {
    const pool = ['key_a', 'key_b', 'key_c'];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(pickKey(pool));
    }
    // With 200 draws over 3 keys, hitting fewer than 2 distinct keys is
    // astronomically unlikely (~ (1/3)^199), so this is effectively deterministic.
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('dedupes a pool with repeats before selecting', () => {
    expect(pickKey(['key_a', 'key_a', 'key_a'])).toBe('key_a');
  });
});
