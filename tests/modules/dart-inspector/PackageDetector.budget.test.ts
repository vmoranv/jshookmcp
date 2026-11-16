/**
 * Tests for PackageDetector's wall-clock budget.
 *
 * A hostile/oversized ref list must not make detect() run unbounded. The
 * budget is env-tunable via DART_PACKAGES_MAX_DETECT_DURATION_MS; when the
 * accumulated elapsed time exceeds it, detect() throws ToolError('TIMEOUT').
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PackageDetector } from '@modules/dart-inspector/PackageDetector';
import { DART_PACKAGES_MAX_DETECT_DURATION_MS } from '@src/constants';
import { ToolError } from '@errors/ToolError';

function manyRefs(count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(`package:pkg${i}/file${i}.dart`);
  }
  return out;
}

describe('DART_PACKAGES_MAX_DETECT_DURATION_MS constant', () => {
  it('is exported from @src/constants as a positive integer', () => {
    expect(Number.isInteger(DART_PACKAGES_MAX_DETECT_DURATION_MS)).toBe(true);
    expect(DART_PACKAGES_MAX_DETECT_DURATION_MS).toBeGreaterThan(0);
  });
});

describe('PackageDetector.detect budget', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws ToolError(TIMEOUT) when the aggregation exceeds the budget', async () => {
    // Simulate a slow clock: each Date.now() call advances by 1000ms, so
    // even a few refs push elapsed well past any positive budget.
    let tick = 0;
    vi.mocked(Date.now).mockImplementation(() => {
      tick += 1;
      return tick * 1000;
    });

    const detector = new PackageDetector();
    // The budget check runs once per ref, so even a handful of refs cross
    // the limit under this fake clock.
    await expect(
      detector.detect({ packageRefs: manyRefs(50), maxPackages: 100000 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('throws an instance of ToolError with code TIMEOUT (not a raw Error)', async () => {
    let value = 0;
    vi.mocked(Date.now).mockImplementation(() => {
      value += 1000;
      return value;
    });

    const detector = new PackageDetector();
    await expect(detector.detect({ packageRefs: manyRefs(50) })).rejects.toBeInstanceOf(ToolError);
  });

  it('does not throw when the clock stays under the budget', async () => {
    // Constant clock => elapsed is 0, comfortably within any positive budget.
    vi.mocked(Date.now).mockReturnValue(1_000_000);
    const detector = new PackageDetector();
    await expect(detector.detect({ packageRefs: manyRefs(10) })).resolves.toMatchObject({
      total: 10,
    });
  });
});
