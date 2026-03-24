import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    unref: vi.fn(),
  })),
}));

// Mock global fetch for CDP waitForCDP
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  handleElectronLaunchDebug,
  handleElectronDebugStatus,
} from '@server/domains/platform/handlers/electron-dual-cdp';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonPayload = Record<string, unknown>;

function parse(result: { content: Array<{ text?: string }> }): JsonPayload {
  return JSON.parse(result.content[0]!.text!) as JsonPayload;
}

describe('electron_launch_debug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should error on non-existent exePath', async () => {
    const result = parse(
      await handleElectronLaunchDebug({
        exePath: 'C:\\nonexistent\\path\\app.exe',
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('should require exePath', async () => {
    // parseStringArg throws when required arg missing
    const result = parse(await handleElectronLaunchDebug({}));
    expect(result.success).toBe(false);
  });
});

describe('electron_debug_status', () => {
  it('should return empty sessions list when no sessions launched', async () => {
    const result = parse(await handleElectronDebugStatus({}));

    expect(result.success).toBe(true);
    expect(Array.isArray(result.sessions)).toBe(true);
    expect((result.sessions as unknown[]).length).toBe(0);
  });

  it('should return error for non-existent session ID', async () => {
    const result = parse(
      await handleElectronDebugStatus({
        sessionId: 'electron-nonexistent',
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No session found');
  });
});
