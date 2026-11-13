/**
 * launchWithDebugPosix — spawn-failure handling contract.
 *
 * Regression guard for the Linux CI crash (2026-11-13): `spawn()` delivers
 * ENOENT/EACCES as an async 'error' EVENT, not a throw. Without a listener,
 * Node raises an uncaught exception and takes the whole vitest process — or
 * the production MCP server — down. The Windows implementation
 * (ProcessManager.impl.ts) carries this guard; the shared POSIX path must
 * behave identically: a missing executable resolves to `null` (the handler
 * then reports "Failed to launch process"), never crashes.
 */
import { describe, expect, it } from 'vitest';
import { launchWithDebugPosix } from '@modules/process/posix-debug-launch';

describe('launchWithDebugPosix spawn-failure contract', () => {
  it('resolves null for a non-existent executable instead of crashing on the spawn error event', async () => {
    const never = async (): Promise<null> => null;
    await expect(
      launchWithDebugPosix('no-such-binary-for-launch-debug-test-9f3a2c', never, 9229, []),
    ).resolves.toBeNull();
  });

  it('resolves null for an absolute path in a non-existent directory', async () => {
    const never = async (): Promise<null> => null;
    const missing =
      process.platform === 'win32' ? 'C:\\bench\\no-such-binary.exe' : '/proc/self/no-such-binary';
    await expect(launchWithDebugPosix(missing, never, 9229, [])).resolves.toBeNull();
  });
});
