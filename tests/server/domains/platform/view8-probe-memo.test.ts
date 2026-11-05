import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock execFile BEFORE importing the module: the module captures promisify(execFile)
// at load time, so the mock must be hoisted. The fake callback-style execFile
// immediately reports "view8 not importable" (error) for any interpreter.
const mocks = vi.hoisted(() => ({
  execFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      cb(new Error('view8 not installed'), '', '');
    },
  ),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, execFile: mocks.execFile };
});

import {
  probeView8Availability,
  resetView8AvailabilityCacheForTesting,
} from '@server/domains/platform/handlers/v8-bytecode-handler';

describe('probeView8Availability memoization', () => {
  beforeEach(() => {
    mocks.execFile.mockClear();
    resetView8AvailabilityCacheForTesting();
  });

  it('spawns the interpreter probes only once across repeated calls', async () => {
    const first = await probeView8Availability();
    const second = await probeView8Availability();
    const third = await probeView8Availability();

    // Same cached promise => same resolved result object (no re-probe).
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(first.available).toBe(false);
    // Two interpreters (python, python3) are tried exactly once, not 3x.
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
  });

  it('re-probes after the test reset hook clears the cache', async () => {
    await probeView8Availability();
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
    resetView8AvailabilityCacheForTesting();
    await probeView8Availability();
    expect(mocks.execFile).toHaveBeenCalledTimes(4);
  });
});
