import { describe, expect, it } from 'vitest';
import {
  argString,
  argNumber,
  argBool,
  argEnum,
  argStringRequired,
  argNumberRequired,
  argStringArray,
  argObject,
} from '@server/domains/shared/parse-args';

describe('parse-args', () => {
  describe('argString', () => {
    it('returns the string when present and correct type', () => {
      expect(argString({ key: 'val' }, 'key')).toBe('val');
    });
    it('returns fallback or undefined when missing or wrong type', () => {
      expect(argString({}, 'key')).toBeUndefined();
      expect(argString({ key: 123 }, 'key')).toBeUndefined();
      expect(argString({}, 'key', 'fallback')).toBe('fallback');
      expect(argString({ key: null }, 'key', 'fallback')).toBe('fallback');
    });
  });

  describe('argNumber', () => {
    it('returns the number when present and correct type', () => {
      expect(argNumber({ key: 42 }, 'key')).toBe(42);
    });
    it('returns fallback or undefined when missing or wrong type', () => {
      expect(argNumber({}, 'key')).toBeUndefined();
      expect(argNumber({ key: '123' }, 'key')).toBeUndefined();
      expect(argNumber({}, 'key', 99)).toBe(99);
      expect(argNumber({ key: true }, 'key', 99)).toBe(99);
    });
  });

  describe('argBool', () => {
    it('returns the boolean when present and correct type', () => {
      expect(argBool({ key: true }, 'key')).toBe(true);
      expect(argBool({ key: false }, 'key')).toBe(false);
    });
    it('returns fallback or undefined when missing or wrong type', () => {
      expect(argBool({}, 'key')).toBeUndefined();
      expect(argBool({ key: 'true' }, 'key')).toBeUndefined();
      expect(argBool({}, 'key', true)).toBe(true);
      expect(argBool({ key: 1 }, 'key', false)).toBe(false);
    });
  });

  describe('argEnum', () => {
    const ALLOWED = new Set(['a', 'b'] as const);
    it('returns valid enum value', () => {
      expect(argEnum({ key: 'a' }, 'key', ALLOWED)).toBe('a');
    });
    it('returns fallback if absent', () => {
      expect(argEnum({}, 'key', ALLOWED)).toBeUndefined();
      expect(argEnum({}, 'key', ALLOWED, 'a')).toBe('a');
    });
    it('returns fallback if wrong type', () => {
      expect(argEnum({ key: 123 }, 'key', ALLOWED)).toBeUndefined();
      expect(argEnum({ key: 123 }, 'key', ALLOWED, 'a')).toBe('a');
    });
    it('throws if present but invalid', () => {
      expect(() => argEnum({ key: 'c' }, 'key', ALLOWED)).toThrowError(/Invalid key: "c"/);
    });
  });

  describe('REQUIRED variants', () => {
    it('argStringRequired returns string or throws', () => {
      expect(argStringRequired({ key: 'val' }, 'key')).toBe('val');
      expect(() => argStringRequired({}, 'key')).toThrowError(
        /Missing required string argument: "key"/,
      );
      expect(() => argStringRequired({ key: 123 }, 'key')).toThrowError(
        /Missing required string argument: "key"/,
      );
    });

    it('argNumberRequired returns number or throws', () => {
      expect(argNumberRequired({ key: 42 }, 'key')).toBe(42);
      expect(() => argNumberRequired({}, 'key')).toThrowError(
        /Missing required number argument: "key"/,
      );
      expect(() => argNumberRequired({ key: '42' }, 'key')).toThrowError(
        /Missing required number argument: "key"/,
      );
    });
  });

  describe('Complex types', () => {
    it('argStringArray extracts string arrays, dropping non-strings', () => {
      expect(argStringArray({ key: ['a', 'b'] }, 'key')).toEqual(['a', 'b']);
      expect(argStringArray({ key: ['a', 1, 'b'] }, 'key')).toEqual(['a', 'b']);
      expect(argStringArray({ key: 'not array' }, 'key')).toEqual([]);
      expect(argStringArray({}, 'key')).toEqual([]);
    });

    it('argObject extracts plain objects', () => {
      expect(argObject({ key: { a: 1 } }, 'key')).toEqual({ a: 1 });
      expect(argObject({ key: 'string' }, 'key')).toBeUndefined();
      expect(argObject({ key: [] }, 'key')).toBeUndefined();
      expect(argObject({ key: null }, 'key')).toBeUndefined();
      expect(argObject({}, 'key')).toBeUndefined();
    });
  });
});
