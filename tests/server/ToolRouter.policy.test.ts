/**
 * Tests for buildPrerequisiteCheck condition matchers
 * and getEffectivePrerequisites cache.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getEffectivePrerequisites } from '@server/ToolRouter.policy';

// We need to reset the internal cache between tests
// The module caches prerequisites lazily
vi.mock('@server/registry/index', () => ({
  getAllManifests: vi.fn(() => [
    {
      kind: 'domain-manifest',
      version: 1,
      domain: 'test-domain',
      depKey: 'testHandlers',
      profiles: ['workflow', 'full'],
      registrations: [],
      ensure: () => ({}),
      prerequisites: {
        test_browser_tool: [
          { condition: 'Browser must be launched', fix: 'Call browser_launch first' },
        ],
        test_network_tool: [
          { condition: 'Network monitoring must be enabled', fix: 'Call network_enable' },
        ],
        test_debugger_tool: [
          {
            condition: 'Debugger must be enabled',
            fix: "Call debugger_lifecycle({ action: 'enable' })",
          },
        ],
        test_debugger_attach_tool: [
          {
            condition: 'Debugger must be attached',
            fix: "Call debugger_lifecycle({ action: 'enable' })",
          },
        ],
        test_page_tool: [{ condition: 'Page must be navigated', fix: 'Call page_navigate' }],
        test_ws_tool: [
          { condition: 'WebSocket monitoring must be active', fix: 'Call ws_monitor_enable' },
        ],
        test_unknown_tool: [{ condition: 'Some future condition', fix: 'Unknown' }],
      },
    },
  ]),
}));

describe('buildPrerequisiteCheck', () => {
  beforeEach(() => {
    // Force cache reset by clearing module state
    // The getEffectivePrerequisites function caches internally,
    // but since we're mocking getAllManifests it returns the same data
  });

  it('returns true for browser condition when hasActivePage is true', () => {
    const prereqs = getEffectivePrerequisites();
    const browserPrereqs = prereqs['test_browser_tool'];
    expect(browserPrereqs).toBeDefined();
    expect(browserPrereqs!.length).toBe(1);

    const check = browserPrereqs![0]!.check;
    expect(
      check({
        hasActivePage: true,
        networkEnabled: false,
        capturedRequestCount: 0,
      }),
    ).toBe(true);

    expect(
      check({
        hasActivePage: false,
        networkEnabled: false,
        capturedRequestCount: 0,
      }),
    ).toBe(false);
  });

  it('returns true for network condition when networkEnabled is true', () => {
    const prereqs = getEffectivePrerequisites();
    const netPrereqs = prereqs['test_network_tool'];
    expect(netPrereqs).toBeDefined();

    const check = netPrereqs![0]!.check;
    expect(
      check({
        hasActivePage: true,
        networkEnabled: true,
        capturedRequestCount: 0,
      }),
    ).toBe(true);

    expect(
      check({
        hasActivePage: true,
        networkEnabled: false,
        capturedRequestCount: 0,
      }),
    ).toBe(false);
  });

  it('returns true for debugger enabled condition when hasActivePage is true', () => {
    const prereqs = getEffectivePrerequisites();
    const debugPrereqs = prereqs['test_debugger_tool'];
    expect(debugPrereqs).toBeDefined();

    const check = debugPrereqs![0]!.check;
    expect(check({ hasActivePage: true, networkEnabled: false, capturedRequestCount: 0 })).toBe(
      true,
    );
    expect(check({ hasActivePage: false, networkEnabled: false, capturedRequestCount: 0 })).toBe(
      false,
    );
  });

  it('returns true for debugger attached condition when hasActivePage is true', () => {
    const prereqs = getEffectivePrerequisites();
    const attachPrereqs = prereqs['test_debugger_attach_tool'];
    expect(attachPrereqs).toBeDefined();

    const check = attachPrereqs![0]!.check;
    expect(check({ hasActivePage: true, networkEnabled: false, capturedRequestCount: 0 })).toBe(
      true,
    );
  });

  it('returns true for page navigated condition when hasActivePage is true', () => {
    const prereqs = getEffectivePrerequisites();
    const pagePrereqs = prereqs['test_page_tool'];
    expect(pagePrereqs).toBeDefined();

    const check = pagePrereqs![0]!.check;
    expect(check({ hasActivePage: true, networkEnabled: false, capturedRequestCount: 0 })).toBe(
      true,
    );
  });

  it('returns true for WebSocket monitoring condition when hasActivePage is true', () => {
    const prereqs = getEffectivePrerequisites();
    const wsPrereqs = prereqs['test_ws_tool'];
    expect(wsPrereqs).toBeDefined();

    const check = wsPrereqs![0]!.check;
    expect(check({ hasActivePage: true, networkEnabled: false, capturedRequestCount: 0 })).toBe(
      true,
    );
  });

  it('returns false for unknown conditions', () => {
    const prereqs = getEffectivePrerequisites();
    const unknownPrereqs = prereqs['test_unknown_tool'];
    expect(unknownPrereqs).toBeDefined();

    const check = unknownPrereqs![0]!.check;
    // Unknown conditions always return false
    expect(check({ hasActivePage: true, networkEnabled: true, capturedRequestCount: 10 })).toBe(
      false,
    );
  });

  it('preserves condition and fix strings from manifest', () => {
    const prereqs = getEffectivePrerequisites();
    const entry = prereqs['test_browser_tool']![0]!;
    expect(entry.condition).toBe('Browser must be launched');
    expect(entry.fix).toBe('Call browser_launch first');
  });
});
