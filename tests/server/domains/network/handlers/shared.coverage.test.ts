import { describe, it, expect, vi } from 'vitest';
import {
  createPerformanceMonitorFactory,
  emitEvent,
  parseBooleanArg,
  parseNumberArg,
} from '@server/domains/network/handlers/shared';

describe('network handlers shared', () => {
  describe('parseBooleanArg', () => {
    it('returns boolean value directly', async () => {
      expect(parseBooleanArg(true, false)).toBe(true);
      expect(parseBooleanArg(false, true)).toBe(false);
    });

    it('parses number 1 as true', async () => {
      expect(parseBooleanArg(1, false)).toBe(true);
    });

    it('parses number 0 as false', async () => {
      expect(parseBooleanArg(0, true)).toBe(false);
    });

    it('returns default for other numbers', async () => {
      expect(parseBooleanArg(2, true)).toBe(true);
      expect(parseBooleanArg(2, false)).toBe(false);
    });

    it('parses truthy string variants', async () => {
      for (const v of ['true', '1', 'yes', 'on', 'True', 'YES', 'ON']) {
        expect(parseBooleanArg(v, false)).toBe(true);
      }
    });

    it('parses falsy string variants', async () => {
      for (const v of ['false', '0', 'no', 'off', 'False', 'NO', 'OFF']) {
        expect(parseBooleanArg(v, true)).toBe(false);
      }
    });

    it('returns default for other strings', async () => {
      expect(parseBooleanArg('maybe', true)).toBe(true);
      expect(parseBooleanArg('maybe', false)).toBe(false);
    });

    it('returns default for null/undefined/object', async () => {
      expect(parseBooleanArg(null, true)).toBe(true);
      expect(parseBooleanArg(undefined, false)).toBe(false);
      expect(parseBooleanArg({}, false)).toBe(false);
    });
  });

  describe('parseNumberArg', () => {
    it('returns valid number directly', async () => {
      expect(parseNumberArg(42, { defaultValue: 0 })).toBe(42);
    });

    it('parses valid string to number', async () => {
      expect(parseNumberArg('  3.14  ', { defaultValue: 0 })).toBeCloseTo(3.14);
    });

    it('returns default for empty string', async () => {
      expect(parseNumberArg('', { defaultValue: 99 })).toBe(99);
    });

    it('returns default for non-numeric string', async () => {
      expect(parseNumberArg('abc', { defaultValue: 10 })).toBe(10);
    });

    it('returns default for NaN input', async () => {
      expect(parseNumberArg(NaN, { defaultValue: 5 })).toBe(5);
    });

    it('returns default for Infinity input', async () => {
      expect(parseNumberArg(Infinity, { defaultValue: 5 })).toBe(5);
    });

    it('truncates to integer when integer:true', async () => {
      expect(parseNumberArg(3.7, { defaultValue: 0, integer: true })).toBe(3);
    });

    it('clamps to min', async () => {
      expect(parseNumberArg(-5, { defaultValue: 0, min: 0 })).toBe(0);
    });

    it('clamps to max', async () => {
      expect(parseNumberArg(200, { defaultValue: 0, max: 100 })).toBe(100);
    });

    it('handles undefined input', async () => {
      expect(parseNumberArg(undefined, { defaultValue: 42 })).toBe(42);
    });

    it('handles null input', async () => {
      expect(parseNumberArg(null, { defaultValue: 7 })).toBe(7);
    });
  });

  describe('emitEvent', () => {
    it('calls emit on eventBus when provided', async () => {
      const emit = vi.fn();
      const eventBus = { emit } as never;
      emitEvent(eventBus, 'network:intercept_started', { test: true });
      expect(emit).toHaveBeenCalled();
    });

    it('does nothing when eventBus is undefined', async () => {
      expect(() => emitEvent(undefined, 'network:intercept_started', {})).not.toThrow();
    });
  });

  describe('createPerformanceMonitorFactory', () => {
    it('returns lazy singleton', async () => {
      let callCount = 0;
      const factory = createPerformanceMonitorFactory(() => {
        callCount += 1;
        return {} as never;
      });
      factory();
      factory();
      expect(callCount).toBe(1);
    });
  });
});
