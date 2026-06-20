import { describe, it, expect } from 'vitest';
import {
  validateHexAddress,
  validateBytesArray,
  requireStringArg,
  requirePositiveNumberArg,
  requirePositiveIntArg,
  parseJsonArg,
} from '../../../../../src/server/domains/memory/handlers/validation';

describe('memory domain validation helpers', () => {
  describe('validateHexAddress', () => {
    it('accepts 0x-prefixed hex', () => {
      expect(validateHexAddress('0x7FF612340000', 'address')).toBe('0x7FF612340000');
    });
    it('accepts bare hex', () => {
      expect(validateHexAddress('7FF6', 'address')).toBe('7FF6');
    });
    it('accepts mixed-case hex', () => {
      expect(validateHexAddress('0xDeAdBeEf', 'address')).toBe('0xDeAdBeEf');
    });
    it('throws on non-string', () => {
      expect(() => validateHexAddress(123, 'address')).toThrow(/address must be a hex address/);
      expect(() => validateHexAddress(123, 'address')).toThrow('123');
    });
    it('throws on empty string', () => {
      expect(() => validateHexAddress('', 'address')).toThrow(/address must be a hex address/);
    });
    it('throws on non-hex chars', () => {
      expect(() => validateHexAddress('0xZZZZ', 'address')).toThrow(
        /address must be a hex address/,
      );
      expect(() => validateHexAddress('not-an-address', 'targetAddress')).toThrow(
        /targetAddress must be a hex address/,
      );
    });
    it('includes the offending value in the message', () => {
      try {
        validateHexAddress('xyz', 'address');
        throw new Error('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('xyz');
      }
    });
  });

  describe('validateBytesArray', () => {
    it('accepts a valid byte array', () => {
      expect(validateBytesArray([0x90, 0x90, 0xff], 'bytes')).toEqual([0x90, 0x90, 0xff]);
    });
    it('accepts boundary values 0 and 255', () => {
      expect(validateBytesArray([0, 255], 'bytes')).toEqual([0, 255]);
    });
    it('throws on non-array', () => {
      expect(() => validateBytesArray('nope', 'bytes')).toThrow(
        /bytes must be a non-empty array of bytes/,
      );
    });
    it('throws on empty array', () => {
      expect(() => validateBytesArray([], 'bytes')).toThrow(
        /bytes must be a non-empty array of bytes/,
      );
    });
    it('throws on out-of-range element with index', () => {
      expect(() => validateBytesArray([10, 256], 'bytes')).toThrow(/at index 1/);
      expect(() => validateBytesArray([10, -1], 'bytes')).toThrow(/at index 1/);
    });
    it('throws on non-integer element with index', () => {
      expect(() => validateBytesArray([10, 1.5], 'bytes')).toThrow(/at index 1/);
      expect(() => validateBytesArray([10, 'a'], 'bytes')).toThrow(/at index 1/);
    });
  });

  describe('requireStringArg', () => {
    it('accepts non-empty string', () => {
      expect(requireStringArg('abc', 'sessionId', 'memory_scan_session')).toBe('abc');
    });
    it('throws with tool + field context on missing', () => {
      expect(() => requireStringArg(undefined, 'sessionId', 'memory_scan_session')).toThrow(
        /memory_scan_session: missing or invalid required argument "sessionId"/,
      );
    });
    it('throws on empty string', () => {
      expect(() => requireStringArg('', 'sessionId', 'memory_scan_session')).toThrow(
        /memory_scan_session: missing or invalid required argument "sessionId"/,
      );
    });
    it('throws on non-string', () => {
      expect(() => requireStringArg(42, 'sessionId', 'memory_scan_session')).toThrow(
        /memory_scan_session: missing or invalid required argument "sessionId"/,
      );
    });
  });

  describe('requirePositiveNumberArg', () => {
    it('accepts positive numbers', () => {
      expect(requirePositiveNumberArg(2.5, 'speed', 'memory_speedhack')).toBe(2.5);
    });
    it('throws on zero', () => {
      expect(() => requirePositiveNumberArg(0, 'speed', 'memory_speedhack')).toThrow(
        /memory_speedhack: missing or invalid required argument "speed"/,
      );
    });
    it('throws on negative', () => {
      expect(() => requirePositiveNumberArg(-1, 'speed', 'memory_speedhack')).toThrow(
        /expected positive number/,
      );
    });
    it('throws on NaN', () => {
      expect(() => requirePositiveNumberArg(NaN, 'speed', 'memory_speedhack')).toThrow(
        /expected positive number/,
      );
    });
    it('throws on non-number', () => {
      expect(() => requirePositiveNumberArg('fast', 'speed', 'memory_speedhack')).toThrow(
        /memory_speedhack: missing or invalid required argument "speed"/,
      );
    });
  });

  describe('requirePositiveIntArg', () => {
    it('accepts positive integers', () => {
      expect(requirePositiveIntArg(4, 'count', 'memory_patch_nop')).toBe(4);
    });
    it('throws on non-integer', () => {
      expect(() => requirePositiveIntArg(2.5, 'count', 'memory_patch_nop')).toThrow(
        /expected positive integer/,
      );
    });
    it('throws on zero', () => {
      expect(() => requirePositiveIntArg(0, 'count', 'memory_patch_nop')).toThrow(
        /expected positive integer/,
      );
    });
  });

  describe('parseJsonArg', () => {
    it('parses valid JSON', () => {
      expect(parseJsonArg('[1,2,3]', 'chains', 'memory_pointer_chain')).toEqual([1, 2, 3]);
    });
    it('throws on non-string', () => {
      expect(() => parseJsonArg(undefined, 'chains', 'memory_pointer_chain')).toThrow(
        /memory_pointer_chain: missing or invalid required argument "chains"/,
      );
    });
    it('throws on empty string', () => {
      expect(() => parseJsonArg('', 'chains', 'memory_pointer_chain')).toThrow(
        /memory_pointer_chain: missing or invalid required argument "chains"/,
      );
    });
    it('wraps parse errors with context', () => {
      expect(() => parseJsonArg('{not json', 'chains', 'memory_pointer_chain')).toThrow(
        /memory_pointer_chain: argument "chains" must be valid JSON/,
      );
    });
  });
});
