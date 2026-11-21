import type {
  CodeCollectorMirror,
  ConsoleMonitorMirror,
} from '@tests/server/domains/shared/mock-factories';
import {
  createCodeCollectorMock,
  createConsoleMonitorMock,
  parseJson,
} from '@tests/server/domains/shared/mock-factories';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (payload: any) => payload,
    }),
  },
}));

vi.mock('@modules/monitor/PerformanceMonitor', () => ({ PerformanceMonitor: vi.fn() }));

import type { NetworkRequestsResponse } from '@tests/shared/common-test-types';
import { CoreHandlers } from '@server/domains/network/handlers/core-handlers';
import { ensureNetworkEnabled } from '@server/domains/network/handlers/core-handlers.helpers';
import {
  createPerformanceMonitorFactory,
  parseBooleanArg,
  parseNumberArg,
} from '@server/domains/network/handlers/shared';

describe('CoreHandlers (composition, ex-runtime-base)', () => {
  let collector: CodeCollectorMirror;
  let consoleMonitor: ConsoleMonitorMirror;
  let handler: CoreHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = createCodeCollectorMock();
    consoleMonitor = createConsoleMonitorMock();
    handler = new CoreHandlers({
      collector: collector as any,
      consoleMonitor: consoleMonitor as any,
    });
  });

  // ---------- parseBooleanArg (handlers/shared.ts) ----------

  describe('parseBooleanArg', () => {
    it('returns the boolean value when given a boolean', () => {
      expect(parseBooleanArg(true, false)).toBe(true);
      expect(parseBooleanArg(false, true)).toBe(false);
    });

    it('coerces 1/0, returns default for other numbers', () => {
      expect(parseBooleanArg(1, false)).toBe(true);
      expect(parseBooleanArg(0, true)).toBe(false);
      expect(parseBooleanArg(2, false)).toBe(false);
      expect(parseBooleanArg(-1, true)).toBe(true);
      expect(parseBooleanArg(0.5, false)).toBe(false);
    });

    it('coerces recognized boolean-ish strings', () => {
      expect(parseBooleanArg('true', false)).toBe(true);
      expect(parseBooleanArg('TRUE', false)).toBe(true);
      expect(parseBooleanArg('1', false)).toBe(true);
      expect(parseBooleanArg('yes', false)).toBe(true);
      expect(parseBooleanArg('on', false)).toBe(true);
      expect(parseBooleanArg('  Yes  ', false)).toBe(true);
      expect(parseBooleanArg('false', true)).toBe(false);
      expect(parseBooleanArg('FALSE', true)).toBe(false);
      expect(parseBooleanArg('0', true)).toBe(false);
      expect(parseBooleanArg('no', true)).toBe(false);
      expect(parseBooleanArg('off', true)).toBe(false);
      expect(parseBooleanArg('  Off  ', true)).toBe(false);
    });

    it('returns default for unrecognized strings, null, undefined, objects', () => {
      expect(parseBooleanArg('maybe', false)).toBe(false);
      expect(parseBooleanArg('maybe', true)).toBe(true);
      expect(parseBooleanArg('', false)).toBe(false);
      expect(parseBooleanArg(null, true)).toBe(true);
      expect(parseBooleanArg(undefined, false)).toBe(false);
      expect(parseBooleanArg({}, true)).toBe(true);
      expect(parseBooleanArg([], false)).toBe(false);
    });
  });

  // ---------- parseNumberArg (handlers/shared.ts) ----------

  describe('parseNumberArg', () => {
    it('returns the number when given a finite number', () => {
      expect(parseNumberArg(42, { defaultValue: 0 })).toBe(42);
    });

    it('returns default for NaN and Infinity', () => {
      expect(parseNumberArg(Number.NaN, { defaultValue: 10 })).toBe(10);
      expect(parseNumberArg(Number.POSITIVE_INFINITY, { defaultValue: 10 })).toBe(10);
      expect(parseNumberArg(Number.NEGATIVE_INFINITY, { defaultValue: 10 })).toBe(10);
    });

    it('coerces numeric strings (shared.ts semantics)', () => {
      expect(parseNumberArg('42', { defaultValue: 0 })).toBe(42);
      expect(parseNumberArg('  3.14  ', { defaultValue: 5 })).toBe(3.14);
    });

    it('returns default for non-numeric strings', () => {
      expect(parseNumberArg('abc', { defaultValue: 5 })).toBe(5);
      expect(parseNumberArg('', { defaultValue: 5 })).toBe(5);
    });

    it('returns default for non-number/non-string types', () => {
      expect(parseNumberArg(null, { defaultValue: 7 })).toBe(7);
      expect(parseNumberArg(undefined, { defaultValue: 7 })).toBe(7);
      expect(parseNumberArg(true, { defaultValue: 7 })).toBe(7);
    });

    it('applies min constraint', () => {
      expect(parseNumberArg(3, { defaultValue: 0, min: 5 })).toBe(5);
      expect(parseNumberArg(10, { defaultValue: 0, min: 5 })).toBe(10);
    });

    it('applies max constraint', () => {
      expect(parseNumberArg(100, { defaultValue: 0, max: 50 })).toBe(50);
      expect(parseNumberArg(30, { defaultValue: 0, max: 50 })).toBe(30);
    });

    it('applies both min and max constraints', () => {
      expect(parseNumberArg(1, { defaultValue: 0, min: 5, max: 50 })).toBe(5);
      expect(parseNumberArg(100, { defaultValue: 0, min: 5, max: 50 })).toBe(50);
      expect(parseNumberArg(25, { defaultValue: 0, min: 5, max: 50 })).toBe(25);
    });

    it('truncates to integer when integer option is set', () => {
      expect(parseNumberArg(3.7, { defaultValue: 0, integer: true })).toBe(3);
      expect(parseNumberArg(-2.9, { defaultValue: 0, integer: true })).toBe(-2);
    });

    it('applies integer truncation before min/max clamping', () => {
      expect(parseNumberArg(4.9, { defaultValue: 0, integer: true, min: 5 })).toBe(5);
    });
  });

  // ---------- createPerformanceMonitorFactory ----------

  describe('createPerformanceMonitorFactory', () => {
    it('creates the monitor lazily and returns the same instance afterwards', () => {
      const factory = vi.fn(() => ({ id: 'monitor' }) as any);
      const getMonitor = createPerformanceMonitorFactory(factory);
      const monitor1 = getMonitor();
      const monitor2 = getMonitor();
      expect(monitor1).toBe(monitor2);
      expect(factory).toHaveBeenCalledOnce();
    });
  });

  // ---------- ensureNetworkEnabled (core-handlers.helpers) ----------

  describe('ensureNetworkEnabled', () => {
    it('returns enabled=true if network is already enabled', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      const result = await ensureNetworkEnabled(
        { consoleMonitor: consoleMonitor as any },
        {
          autoEnable: true,
          enableExceptions: true,
        },
      );
      expect(result).toEqual({ enabled: true, autoEnabled: false });
      expect(consoleMonitor.enable).not.toHaveBeenCalled();
    });

    it('returns enabled=false when not enabled and autoEnable is false', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      const result = await ensureNetworkEnabled(
        { consoleMonitor: consoleMonitor as any },
        {
          autoEnable: false,
          enableExceptions: true,
        },
      );
      expect(result).toEqual({ enabled: false, autoEnabled: false });
    });

    it('auto-enables when not enabled and autoEnable is true', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValueOnce(false).mockReturnValueOnce(true);
      consoleMonitor.enable.mockResolvedValue(undefined);

      const result = await ensureNetworkEnabled(
        { consoleMonitor: consoleMonitor as any },
        {
          autoEnable: true,
          enableExceptions: true,
        },
      );
      expect(result).toEqual({ enabled: true, autoEnabled: true });
      expect(consoleMonitor.enable).toHaveBeenCalledWith({
        enableNetwork: true,
        enableExceptions: true,
      });
    });

    it('returns error when auto-enable throws', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      consoleMonitor.enable.mockRejectedValue(new Error('CDP session closed'));

      const result = await ensureNetworkEnabled(
        { consoleMonitor: consoleMonitor as any },
        {
          autoEnable: true,
          enableExceptions: false,
        },
      );
      expect(result).toEqual({
        enabled: false,
        autoEnabled: false,
        error: 'CDP session closed',
      });
    });

    it('stringifies non-Error throws in error field', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      consoleMonitor.enable.mockRejectedValue('string error');

      const result = await ensureNetworkEnabled(
        { consoleMonitor: consoleMonitor as any },
        {
          autoEnable: true,
          enableExceptions: true,
        },
      );
      expect(result.error).toBe('string error');
    });
  });

  // ---------- handleNetworkEnable ----------

  describe('handleNetworkEnable', () => {
    it('enables network monitoring and returns success', async () => {
      consoleMonitor.getNetworkStatus.mockReturnValue({
        enabled: true,
        cdpSessionActive: true,
        listenerCount: 2,
      });

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkEnable({}));
      expect(body.success).toBe(true);
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.enabled).toBe(true);
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.cdpSessionActive).toBe(true);
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.listenerCount).toBe(2);
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.usage).toBeDefined();
      expect(consoleMonitor.enable).toHaveBeenCalledWith({
        enableNetwork: true,
        enableExceptions: true,
      });
    });

    it('passes enableExceptions=false when arg is provided', async () => {
      consoleMonitor.getNetworkStatus.mockReturnValue({
        enabled: true,
        cdpSessionActive: true,
        listenerCount: 1,
      });

      await handler.handleNetworkEnable({ enableExceptions: false });
      expect(consoleMonitor.enable).toHaveBeenCalledWith({
        enableNetwork: true,
        enableExceptions: false,
      });
    });

    it('coerces boolean-ish string enableExceptions args (shared.ts semantics)', async () => {
      consoleMonitor.getNetworkStatus.mockReturnValue({
        enabled: true,
        cdpSessionActive: true,
        listenerCount: 1,
      });

      await handler.handleNetworkEnable({ enableExceptions: '0' });
      expect(consoleMonitor.enable).toHaveBeenCalledWith({
        enableNetwork: true,
        enableExceptions: false,
      });
    });
  });

  // ---------- handleNetworkDisable ----------

  describe('handleNetworkDisable', () => {
    it('disables monitoring and returns success', async () => {
      consoleMonitor.disable.mockResolvedValue(undefined);
      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkDisable({}));
      expect(body.success).toBe(true);
      expect(body.message).toContain('disabled');
      expect(consoleMonitor.disable).toHaveBeenCalled();
    });
  });

  // ---------- handleNetworkGetStatus ----------

  describe('handleNetworkGetStatus', () => {
    it('returns disabled status with next steps when monitoring is off', async () => {
      consoleMonitor.getNetworkStatus.mockReturnValue({
        enabled: false,
        requestCount: 0,
        responseCount: 0,
        listenerCount: 0,
        cdpSessionActive: false,
      });

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkGetStatus({}));
      expect(body.success).toBe(false);
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.enabled).toBe(false);
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.nextSteps).toBeDefined();
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.example).toBeDefined();
    });

    it('returns enabled status with request count when monitoring is on', async () => {
      consoleMonitor.getNetworkStatus.mockReturnValue({
        enabled: true,
        requestCount: 5,
        responseCount: 3,
        listenerCount: 2,
        cdpSessionActive: true,
      });

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkGetStatus({}));
      expect(body.success).toBe(true);
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.enabled).toBe(true);
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.requestCount).toBe(5);
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.responseCount).toBe(3);
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.listenerCount).toBe(2);
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.cdpSessionActive).toBe(true);
    });

    it('provides navigation hint when no requests captured yet', async () => {
      consoleMonitor.getNetworkStatus.mockReturnValue({
        enabled: true,
        requestCount: 0,
        responseCount: 0,
        listenerCount: 1,
        cdpSessionActive: true,
      });

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkGetStatus({}));
      expect(body.success).toBe(true);
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.nextSteps.hint).toContain('No requests captured');
    });

    it('provides retrieval hint when requests are captured', async () => {
      consoleMonitor.getNetworkStatus.mockReturnValue({
        enabled: true,
        requestCount: 10,
        responseCount: 8,
        listenerCount: 1,
        cdpSessionActive: true,
      });

      const body = parseJson<NetworkRequestsResponse>(await handler.handleNetworkGetStatus({}));
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.nextSteps.hint).toContain('10 requests captured');
      // @ts-expect-error — auto-suppressed [TS2339]
      expect(body.nextSteps.action).toContain('network_get_requests');
    });
  });
});
