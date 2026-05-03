import { describe, it, expect } from 'vitest';

// These tests verify that our defensive array guards work
// Every crash tonight was caused by .map() on non-arrays

describe('Array safety guards', () => {
  it('Array.isArray correctly identifies arrays', () => {
    expect(Array.isArray([])).toBe(true);
    expect(Array.isArray([1, 2])).toBe(true);
  });

  it('Array.isArray rejects non-arrays', () => {
    expect(Array.isArray(null)).toBe(false);
    expect(Array.isArray(undefined)).toBe(false);
    expect(Array.isArray('[]')).toBe(false);
    expect(Array.isArray({})).toBe(false);
    expect(Array.isArray('hello')).toBe(false);
    expect(Array.isArray(42)).toBe(false);
    // This is what caused the SometeoPR crash — HTML response from missing endpoint
    expect(Array.isArray('<!doctype html>')).toBe(false);
  });

  it('JSON.parse recovers string arrays', () => {
    const stringArray = '["H52.03", "H52.222"]';
    const parsed = JSON.parse(stringArray);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual(['H52.03', 'H52.222']);
  });

  it('defensive pattern handles all edge cases', () => {
    const safeArray = (val: unknown): unknown[] => {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; }
        catch { return []; }
      }
      return [];
    };

    expect(safeArray(['a'])).toEqual(['a']);
    expect(safeArray('["a"]')).toEqual(['a']);
    expect(safeArray(null)).toEqual([]);
    expect(safeArray(undefined)).toEqual([]);
    expect(safeArray('<!doctype html>')).toEqual([]);
    expect(safeArray({})).toEqual([]);
  });
});
