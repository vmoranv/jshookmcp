import { NetworkRequestsResponse } from '@tests/server/domains/shared/common-test-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeCollectorMirror, ConsoleMonitorMirror, createCodeCollectorMock, createConsoleMonitorMock, parseJson } from '../shared/mock-factories';

vi.mock('@src/utils/DetailedDataManager', () => ({
  DetailedDataManager: {
    getInstance: () => ({
      smartHandle: (payload: unknown) => payload,
    }),
  },
}));

vi.mock('@src/server/domains/shared/modules', () => ({
  PerformanceMonitor: vi.fn(),
  ConsoleMonitor: vi.fn(),
  CodeCollector: vi.fn(),
}));

import { AdvancedHandlersBase } from '@server/domains/network/handlers.base';

class TestAdvancedHandlersBase extends AdvancedHandlersBase {
  public override parseBooleanArg(val: unknown, defaultVal: boolean): boolean {
    return super.parseBooleanArg(val, defaultVal);
  }
  public override parseNumberArg(val: unknown, options: unknown): number {
    return super.parseNumberArg(val, options);
  }
  public override sleep(ms: number): Promise<void> {
    return super.sleep(ms);
  }
  public override getPerformanceMonitor() {
    return super.getPerformanceMonitor();
  }
  public override ensureNetworkEnabled(opts: unknown) {
    return super.ensureNetworkEnabled(opts);
  }
}

describe('AdvancedHandlersBase', () => {
  let collector: CodeCollectorMirror;
  let consoleMonitor: ConsoleMonitorMirror;
  let handler: TestAdvancedHandlersBase;

  beforeEach(() => {
    vi.clearAllMocks();
    collector = createCodeCollectorMock();
    consoleMonitor = createConsoleMonitorMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    handler = new TestAdvancedHandlersBase(collector as any, consoleMonitor as any);
  });

  // ---------- parseBooleanArg ----------

  describe('parseBooleanArg', () => {
    it('returns the boolean value when given a boolean', () => {
      expect(handler.parseBooleanArg(true, false)).toBe(true);
      expect(handler.parseBooleanArg(false, true)).toBe(false);
    });

    it('returns true for number 1 and false for number 0', () => {
      expect(handler.parseBooleanArg(1, false)).toBe(true);
      expect(handler.parseBooleanArg(0, true)).toBe(false);
    });

    it('returns default for non-boolean numbers other than 0 and 1', () => {
      expect(handler.parseBooleanArg(2, false)).toBe(false);
      expect(handler.parseBooleanArg(-1, true)).toBe(true);
      expect(handler.parseBooleanArg(0.5, false)).toBe(false);
    });

    it('parses truthy string values case-insensitively', () => {
      expect(handler.parseBooleanArg('true', false)).toBe(true);
      expect(handler.parseBooleanArg('TRUE', false)).toBe(true);
      expect(handler.parseBooleanArg('1', false)).toBe(true);
      expect(handler.parseBooleanArg('yes', false)).toBe(true);
      expect(handler.parseBooleanArg('on', false)).toBe(true);
      expect(handler.parseBooleanArg('  Yes  ', false)).toBe(true);
    });

    it('parses falsy string values case-insensitively', () => {
      expect(handler.parseBooleanArg('false', true)).toBe(false);
      expect(handler.parseBooleanArg('FALSE', true)).toBe(false);
      expect(handler.parseBooleanArg('0', true)).toBe(false);
      expect(handler.parseBooleanArg('no', true)).toBe(false);
      expect(handler.parseBooleanArg('off', true)).toBe(false);
      expect(handler.parseBooleanArg('  Off  ', true)).toBe(false);
    });

    it('returns default for unrecognized strings', () => {
      expect(handler.parseBooleanArg('maybe', false)).toBe(false);
      expect(handler.parseBooleanArg('maybe', true)).toBe(true);
      expect(handler.parseBooleanArg('', false)).toBe(false);
    });

    it('returns default for null, undefined, objects', () => {
      expect(handler.parseBooleanArg(null, true)).toBe(true);
      expect(handler.parseBooleanArg(undefined, false)).toBe(false);
      expect(handler.parseBooleanArg({}, true)).toBe(true);
      expect(handler.parseBooleanArg([], false)).toBe(false);
    });
  });

  // ---------- parseNumberArg ----------

  describe('parseNumberArg', () => {
    it('returns the number when given a finite number', () => {
      expect(handler.parseNumberArg(42, { defaultValue: 0 })).toBe(42);
    });

    it('returns default for NaN and Infinity', () => {
      expect(handler.parseNumberArg(NaN, { defaultValue: 10 })).toBe(10);
      expect(handler.parseNumberArg(Infinity, { defaultValue: 10 })).toBe(10);
      expect(handler.parseNumberArg(-Infinity, { defaultValue: 10 })).toBe(10);
    });

    it('parses numeric strings', () => {
      expect(handler.parseNumberArg('42', { defaultValue: 0 })).toBe(42);
      expect(handler.parseNumberArg('  3.14  ', { defaultValue: 0 })).toBe(3.14);
    });

    it('returns default for non-numeric strings', () => {
      expect(handler.parseNumberArg('abc', { defaultValue: 5 })).toBe(5);
      expect(handler.parseNumberArg('', { defaultValue: 5 })).toBe(5);
    });

    it('returns default for non-number/non-string types', () => {
      expect(handler.parseNumberArg(null, { defaultValue: 7 })).toBe(7);
      expect(handler.parseNumberArg(undefined, { defaultValue: 7 })).toBe(7);
      expect(handler.parseNumberArg(true, { defaultValue: 7 })).toBe(7);
    });

    it('applies min constraint', () => {
      expect(handler.parseNumberArg(3, { defaultValue: 0, min: 5 })).toBe(5);
      expect(handler.parseNumberArg(10, { defaultValue: 0, min: 5 })).toBe(10);
    });

    it('applies max constraint', () => {
      expect(handler.parseNumberArg(100, { defaultValue: 0, max: 50 })).toBe(50);
      expect(handler.parseNumberArg(30, { defaultValue: 0, max: 50 })).toBe(30);
    });

    it('applies both min and max constraints', () => {
      expect(handler.parseNumberArg(1, { defaultValue: 0, min: 5, max: 50 })).toBe(5);
      expect(handler.parseNumberArg(100, { defaultValue: 0, min: 5, max: 50 })).toBe(50);
      expect(handler.parseNumberArg(25, { defaultValue: 0, min: 5, max: 50 })).toBe(25);
    });

    it('truncates to integer when integer option is set', () => {
      expect(handler.parseNumberArg(3.7, { defaultValue: 0, integer: true })).toBe(3);
      expect(handler.parseNumberArg(-2.9, { defaultValue: 0, integer: true })).toBe(-2);
    });

    it('applies integer truncation before min/max clamping', () => {
      expect(handler.parseNumberArg(4.9, { defaultValue: 0, integer: true, min: 5 })).toBe(
        5
      );
    });
  });

  // ---------- sleep ----------

  describe('sleep', () => {
    it('resolves after the specified delay', async () => {
      vi.useFakeTimers();
      const sleepPromise = handler.sleep(100);
      vi.advanceTimersByTime(100);
      await sleepPromise;
      vi.useRealTimers();
    });
  });

  // ---------- getPerformanceMonitor ----------

  describe('getPerformanceMonitor', () => {
    it('creates a PerformanceMonitor lazily on first call', () => {
      const monitor1 = handler.getPerformanceMonitor();
      expect(monitor1).toBeDefined();
    });

    it('returns the same instance on subsequent calls', () => {
      const monitor1 = handler.getPerformanceMonitor();
      const monitor2 = handler.getPerformanceMonitor();
      expect(monitor1).toBe(monitor2);
    });
  });

  // ---------- ensureNetworkEnabled ----------

  describe('ensureNetworkEnabled', () => {
    it('returns enabled=true if network is already enabled', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(true);
      const result = await handler.ensureNetworkEnabled({
        autoEnable: true,
        enableExceptions: true,
      });
      expect(result).toEqual({ enabled: true, autoEnabled: false });
      expect(consoleMonitor.enable).not.toHaveBeenCalled();
    });

    it('returns enabled=false when not enabled and autoEnable is false', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      const result = await handler.ensureNetworkEnabled({
        autoEnable: false,
        enableExceptions: true,
      });
      expect(result).toEqual({ enabled: false, autoEnabled: false });
    });

    it('auto-enables when not enabled and autoEnable is true', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValueOnce(false).mockReturnValueOnce(true);
      consoleMonitor.enable.mockResolvedValue(undefined);

      const result = await handler.ensureNetworkEnabled({
        autoEnable: true,
        enableExceptions: true,
      });
      expect(result).toEqual({ enabled: true, autoEnabled: true });
      expect(consoleMonitor.enable).toHaveBeenCalledWith({
        enableNetwork: true,
        enableExceptions: true,
      });
    });

    it('returns error when auto-enable throws', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      consoleMonitor.enable.mockRejectedValue(new Error('CDP session closed'));

      const result = await handler.ensureNetworkEnabled({
        autoEnable: true,
        enableExceptions: false,
      });
      expect(result).toEqual({
        enabled: false,
        autoEnabled: false,
        error: 'CDP session closed',
      });
    });

    it('stringifies non-Error throws in error field', async () => {
      consoleMonitor.isNetworkEnabled.mockReturnValue(false);
      consoleMonitor.enable.mockRejectedValue('string error');

      const result = await handler.ensureNetworkEnabled({
        autoEnable: true,
        enableExceptions: true,
      });
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.enabled).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.cdpSessionActive).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.listenerCount).toBe(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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

    it('parses string enableExceptions args', async () => {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.enabled).toBe(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.nextSteps).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.enabled).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.requestCount).toBe(5);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.responseCount).toBe(3);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.listenerCount).toBe(2);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.success).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.nextSteps.hint).toContain('10 requests captured');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(body.nextSteps.action).toContain('network_get_requests');
    });
  });
});
