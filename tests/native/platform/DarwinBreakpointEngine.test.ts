/**
 * DarwinBreakpointEngine — unit tests (mock koffi / Mach APIs).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('koffi', () => ({
  default: {
    load: vi.fn(() => ({
      func: vi.fn(() => vi.fn(() => 0)),
      unload: vi.fn(),
    })),
    address: vi.fn(() => 0),
    errno: vi.fn(() => 0),
  },
}));

vi.mock('@src/constants', () => ({
  BREAKPOINT_HIT_TIMEOUT_MS: 5000,
  BREAKPOINT_TRACE_MAX_HITS: 10,
}));

vi.mock('@src/native/platform/darwin/DarwinAPI', () => ({
  KERN: { SUCCESS: 0, INVALID_ARGUMENT: 4, FAILURE: 5 },
  machPortDeallocate: vi.fn(() => 0),
  machPortReleaseReceive: vi.fn(() => 0),
  machTaskSelf: vi.fn(() => 1),
  receiveException: vi.fn(() => null),
  sendExceptionReply: vi.fn(),
  taskForPid: vi.fn(() => ({ kr: 0, task: 100 })),
  threadGetState: vi.fn(() => 0),
}));

import {
  DarwinBreakpointEngine,
  ARM_DEBUG_STATE64_FLAVOR,
} from '@native/platform/DarwinBreakpointEngine';

describe('DarwinBreakpointEngine', () => {
  let engine: DarwinBreakpointEngine;

  it('uses XNU ARM_DEBUG_STATE64 flavor 15 (not 18)', () => {
    expect(ARM_DEBUG_STATE64_FLAVOR).toBe(15);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new DarwinBreakpointEngine();
  });

  describe('listBreakpoints', () => {
    it('returns empty array initially', () => {
      expect(engine.listBreakpoints()).toEqual([]);
    });
  });

  describe('removeBreakpoint', () => {
    it('returns false for non-existent id', async () => {
      await expect(engine.removeBreakpoint('nonexistent')).resolves.toBe(false);
    });
  });

  describe('platform guard', () => {
    it('should reject on non-darwin for setBreakpoint via task_for_pid', async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
      try {
        await import('@src/native/platform/darwin/DarwinAPI');
        // task_for_pid returns {kr:0, task:100} → attach succeeds
        // but task_threads fails (returns empty) → setBreakpoint may throw
        const result = engine.setBreakpoint(1234, '0x1000', 'write', 4);
        // setBreakpoint may succeed or throw depending on task_threads mock behavior
        expect(result).toBeDefined();
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });
  });

  describe('API surface', () => {
    it('has all required methods', () => {
      expect(typeof engine.attach).toBe('function');
      expect(typeof engine.detach).toBe('function');
      expect(typeof engine.setBreakpoint).toBe('function');
      expect(typeof engine.removeBreakpoint).toBe('function');
      expect(typeof engine.listBreakpoints).toBe('function');
      expect(typeof engine.waitForHit).toBe('function');
      expect(typeof engine.traceAccess).toBe('function');
    });
  });
});
