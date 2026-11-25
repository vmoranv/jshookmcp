import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  applySelfDefense,
  buildWatchdogScript,
  stopSelfDefense,
  getSuspiciousHandleCount,
} from '@src/native/syscall/SelfDefense';

describe('SelfDefense', () => {
  afterEach(() => {
    stopSelfDefense();
    vi.unstubAllEnvs();
  });

  describe('applySelfDefense', () => {
    it('returns a valid report with default config (no env flags)', () => {
      const report = applySelfDefense();

      expect(report).toHaveProperty('handleMonitorActive');
      expect(report).toHaveProperty('windowHidden');
      expect(report).toHaveProperty('terminationProtected');
      expect(report).toHaveProperty('priorityProtected');
      expect(report).toHaveProperty('handleHardeningApplied');
      expect(report).toHaveProperty('aclProtectionApplied');
      expect(report).toHaveProperty('watchdogActive');
      expect(report).toHaveProperty('suspiciousHandleCount');
      expect(report).toHaveProperty('limitations');

      // With no env flags, nothing should auto-activate
      expect(report.handleMonitorActive).toBe(false);
      expect(report.windowHidden).toBe(false);
      expect(report.terminationProtected).toBe(false);
      expect(report.priorityProtected).toBe(false);
      expect(report.handleHardeningApplied).toBe(false);
      expect(report.aclProtectionApplied).toBe(false);
      expect(report.watchdogActive).toBe(false);
      expect(report.suspiciousHandleCount).toBe(0);
    });

    it('includes honest limitations about what cannot be protected', () => {
      const report = applySelfDefense();

      const limitations = report.limitations.join(' ');
      expect(limitations).toMatch(/kernel/i);
    });

    it('explicit config can enable protections without env flags', () => {
      const report = applySelfDefense({
        monitorHandles: false, // don't start polling in tests
        hideWindow: true,
        protectPriority: true,
      });

      // windowHidden depends on Windows platform; priorityProtected depends on FFI
      expect(typeof report.windowHidden).toBe('boolean');
      expect(typeof report.priorityProtected).toBe('boolean');
      expect(report.terminationProtected).toBe(false); // requires extreme flag
    });

    it('BreakOnTermination requires JSHOOK_SELFDEFENSE_EXTREME', () => {
      const report = applySelfDefense({
        breakOnTermination: true,
      });

      // Without extreme flag, it should not activate
      expect(report.terminationProtected).toBe(false);
    });

    it('BreakOnTermination is permanently disabled (stub — no BSOD risk)', () => {
      vi.stubEnv('JSHOOK_SELFDEFENSE_EXTREME', '1');

      const report = applySelfDefense({
        breakOnTermination: true,
        monitorHandles: false,
      });

      // BreakOnTermination is PERMANENTLY DISABLED — see BSOD-CRITICAL_PROCESS_DIED-Analysis.md
      expect(report.terminationProtected).toBe(false);
      expect(report.limitations).toContain(
        'BreakOnTermination: BreakOnTermination disabled — irreversibly marks process as critical, causing BSOD on restart. This is NOT safe for user-mode MCP servers. Use ACL protection + watchdog instead (safe, reversible alternatives).',
      );
    });

    it('JSHOOK_SELFDEFENSE=1 enables auto-protection', () => {
      vi.stubEnv('JSHOOK_SELFDEFENSE', '1');

      const report = applySelfDefense({
        // Don't actually poll in tests
        monitorHandles: false,
      });

      // Window hiding and handle monitoring should be attempted
      expect(typeof report.handleMonitorActive).toBe('boolean');
      expect(typeof report.windowHidden).toBe('boolean');
    });

    it('JSHOOK_SELFDEFENSE=1 enables handle hardening', () => {
      vi.stubEnv('JSHOOK_SELFDEFENSE', '1');

      const report = applySelfDefense({
        monitorHandles: false,
        hardenHandles: true,
      });

      expect(typeof report.handleHardeningApplied).toBe('boolean');
    });

    it('JSHOOK_SELFDEFENSE=1 enables ACL protection', () => {
      vi.stubEnv('JSHOOK_SELFDEFENSE', '1');

      const report = applySelfDefense({
        monitorHandles: false,
        aclProtection: true,
      });

      expect(typeof report.aclProtectionApplied).toBe('boolean');
    });

    it('handle hardening can be explicitly disabled', () => {
      vi.stubEnv('JSHOOK_SELFDEFENSE', '1');

      const report = applySelfDefense({
        monitorHandles: false,
        hardenHandles: false,
      });

      expect(report.handleHardeningApplied).toBe(false);
    });

    it('ACL protection can be explicitly disabled', () => {
      vi.stubEnv('JSHOOK_SELFDEFENSE', '1');

      const report = applySelfDefense({
        monitorHandles: false,
        aclProtection: false,
      });

      expect(report.aclProtectionApplied).toBe(false);
    });

    it('watchdog is not enabled without JSHOOK_WATCHDOG_ENABLE=1', () => {
      const report = applySelfDefense({
        monitorHandles: false,
        watchdog: true,
      });

      // Watchdog requires the env flag
      expect(report.watchdogActive).toBe(false);
    });

    it('watchdog is enabled with JSHOOK_WATCHDOG_ENABLE=1', () => {
      vi.stubEnv('JSHOOK_WATCHDOG_ENABLE', '1');

      const report = applySelfDefense({
        monitorHandles: false,
        watchdog: true,
      });

      expect(typeof report.watchdogActive).toBe('boolean');
    });

    it('watchdog can be explicitly disabled even with env flag', () => {
      vi.stubEnv('JSHOOK_WATCHDOG_ENABLE', '1');

      const report = applySelfDefense({
        monitorHandles: false,
        watchdog: false,
      });

      expect(report.watchdogActive).toBe(false);
    });

    it('report includes limitations about ACL bypass by admin', () => {
      const report = applySelfDefense();
      const limitations = report.limitations.join(' ');
      expect(limitations).toMatch(/ACL|bypass|Administrator/i);
    });

    it('report includes limitations about handle hardening bypass', () => {
      const report = applySelfDefense();
      const limitations = report.limitations.join(' ');
      expect(limitations).toMatch(/handle hardening|kernel bypass/i);
    });
  });

  describe('getSuspiciousHandleCount', () => {
    it('returns 0 initially', () => {
      expect(getSuspiciousHandleCount()).toBe(0);
    });
  });

  describe('stopSelfDefense', () => {
    it('stops handle monitoring and resets count', () => {
      // Apply self defense with monitor handles disabled (no timer)
      applySelfDefense({ monitorHandles: false });

      // Should not throw
      expect(() => stopSelfDefense()).not.toThrow();
      expect(getSuspiciousHandleCount()).toBe(0);
    });

    it('is safe to call multiple times', () => {
      stopSelfDefense();
      stopSelfDefense();
      expect(() => stopSelfDefense()).not.toThrow();
    });

    it('handles stop with ACL protection applied', () => {
      vi.stubEnv('JSHOOK_SELFDEFENSE', '1');
      applySelfDefense({ monitorHandles: false, aclProtection: true });
      expect(() => stopSelfDefense()).not.toThrow();
    });

    it('handles stop with handle hardening applied', () => {
      vi.stubEnv('JSHOOK_SELFDEFENSE', '1');
      applySelfDefense({ monitorHandles: false, hardenHandles: true });
      expect(() => stopSelfDefense()).not.toThrow();
    });

    it('handles stop with watchdog running', () => {
      vi.stubEnv('JSHOOK_WATCHDOG_ENABLE', '1');
      applySelfDefense({ monitorHandles: false, watchdog: true });
      expect(() => stopSelfDefense()).not.toThrow();
    });
  });

  describe('v2 safety contract', () => {
    it('all new protections are gated behind env flags or config', () => {
      // Default: nothing active
      const report = applySelfDefense({ monitorHandles: false });
      expect(report.handleHardeningApplied).toBe(false);
      expect(report.aclProtectionApplied).toBe(false);
      expect(report.watchdogActive).toBe(false);
    });

    it('BreakOnTermination is never applied regardless of config', () => {
      vi.stubEnv('JSHOOK_SELFDEFENSE_EXTREME', '1');

      const report = applySelfDefense({
        breakOnTermination: true,
        monitorHandles: false,
      });

      expect(report.terminationProtected).toBe(false);
    });

    it('report structure is backward-compatible with v1 consumers', () => {
      const report = applySelfDefense({ monitorHandles: false });

      // v1 fields still present
      expect(report).toHaveProperty('handleMonitorActive');
      expect(report).toHaveProperty('windowHidden');
      expect(report).toHaveProperty('terminationProtected');
      expect(report).toHaveProperty('priorityProtected');
      expect(report).toHaveProperty('suspiciousHandleCount');

      // v2 new fields present
      expect(report).toHaveProperty('handleHardeningApplied');
      expect(report).toHaveProperty('aclProtectionApplied');
      expect(report).toHaveProperty('watchdogActive');
    });
  });
});

describe('buildWatchdogScript', () => {
  it('keeps the monitor interval referenced so the child stays alive', () => {
    const script = buildWatchdogScript(4242, ['--flag']);
    expect(script).toContain('setInterval');
    // An unref'ed interval is the only handle in the child (stdio: ignore),
    // so unref'ing it makes the watchdog exit immediately.
    expect(script).not.toContain('interval.unref()');
  });
});
