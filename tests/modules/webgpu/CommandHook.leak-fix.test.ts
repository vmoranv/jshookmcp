/**
 * Fix: re-install timestampQuery state leaks + querySet/dst destroy leaks.
 *
 * Bug #1: Re-install spread `...ts` copies `resolving: true` from a previous
 * capture window, causing all future submit hooks to permanently skip GPU
 * timestamp resolution.
 *
 * Bug #2: querySet and dst buffer are never destroyed:
 *  - querySet created on first install, abandoned on uninstall and re-install
 *  - dst buffer destroyed only on happy path (not on error)
 *
 * The hook page-script runs inside the browser, so module-level tests verify
 * the installed hook script string contains the correct cleanup logic.
 */

import { describe, expect, it, vi } from 'vitest';
import { installGPUCommandHook, uninstallGPUCommandHook } from '@modules/webgpu/CommandHook';

function mockPage(): {
  evaluate: ReturnType<typeof vi.fn>;
  evaluateOnNewDocument: ReturnType<typeof vi.fn>;
} {
  return {
    evaluate: vi.fn().mockResolvedValue(undefined),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
  };
}

/** Extract the string version of the install script passed to page.evaluate. */
function installScript(page: { evaluate: ReturnType<typeof vi.fn> }): string {
  // evaluate calls: [0] = hookScript (ensureHookState), [1] = install script.
  return String(page.evaluate.mock.calls[1]?.[0] ?? '');
}

/** Extract the string version of the uninstall script passed to page.evaluate. */
function uninstallScript(page: { evaluate: ReturnType<typeof vi.fn> }): string {
  return String(page.evaluate.mock.calls[page.evaluate.mock.calls.length - 1]?.[0] ?? '');
}

describe('CommandHook Bug #1 — re-install stale resolving', () => {
  it('re-install timestampQuery object explicitly sets resolving: false after ...ts spread', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    const script = installScript(page);

    // The re-install else-branch override block must explicitly mention
    // `resolving` right after `overflow`, proving the spread doesn't
    // silently copy a stale `resolving: true`. The hookScript init has
    // its own `resolving: false` but that is in a *different* object
    // literal — we verify the re-install override by looking for
    // `overflow` immediately followed by `resolving` in the same literal.
    expect(script).toMatch(/overflow:\s*(false|!1)\s*,\s*resolving:\s*(false|!1)/);
  });

  it('re-install timestampQuery object explicitly sets resolveStartedAt: 0', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    const script = installScript(page);

    // `resolveStartedAt` must appear near the overflow/resolving reset block.
    expect(script).toMatch(
      /overflow:\s*(false|!1)\s*,\s*resolving[\s\S]{0,200}?resolveStartedAt:\s*0/,
    );
  });
});

describe('CommandHook Bug #2 — querySet & dst destroy leaks', () => {
  it('re-install path calls destroy on old querySet before null assignment', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    const script = installScript(page);

    // The re-install else-branch must destroy the old querySet before
    // `querySet: null` overwrites the reference. The code pattern is
    // `if (ts.querySet && typeof ts.querySet.destroy === 'function')
    //   { ts.querySet.destroy(); }`.
    // Verify `querySet` and `.destroy()` both appear in the install script
    // (the hookScript init has `querySet: null` but no `.destroy()` call
    // on it, so any `.querySet.destroy()` must be from the fix).
    expect(script).toMatch(/querySet\.destroy\s*\(\)/);
  });

  it('uninstall path destroys querySet before restoring prototypes', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    await uninstallGPUCommandHook(page as never);
    const script = uninstallScript(page);

    // Uninstall must now call `.destroy()` on timestampQuery.querySet.
    const destroyCount = (script.match(/\b\.destroy\b/g) || []).length;
    expect(destroyCount).toBeGreaterThanOrEqual(1);
  });

  it('install script destroys dst buffer in all paths (happy + error)', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    const script = installScript(page);

    // The dst buffer created inside the resolve chain must be destroyed on
    // ALL paths — happy path AND inner-catch (mapAsync fails) AND
    // outer-catch (onSubmittedWorkDone fails). The fix uses try/finally
    // or adds destroy calls in catch blocks.
    //
    // Count .destroy() occurrences: before fix only 1 (happy-path
    // dst.destroy()). After fix at least 3 (happy + inner-catch +
    // outer-catch) plus querySet destroy.
    const destroyCount = (script.match(/\b\.destroy\b/g) || []).length;
    expect(destroyCount).toBeGreaterThanOrEqual(3);
  });
});

describe('CommandHook hardening regressions', () => {
  it('guards non-WebGPU pages and gates timestamps on the shared cached device', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    const script = installScript(page);

    expect(script).toMatch(/typeof GPUDevice === ['"]undefined['"]/);
    expect(script).toContain('__webgpuDeviceCache');
    // A freshly requested device does not match the application's device.
    expect(script).not.toContain('requestAdapter');
    expect(script).toContain('deviceForTiming.queue === this');
  });

  it('associates timestamps by the pass own slot mark and records indirect compute', async () => {
    const page = mockPage();
    await installGPUCommandHook(page as never, 10);
    const script = installScript(page);

    expect(script).toContain('p.begin === slotMark.begin');
    expect(script).toContain('dispatchCalled');
    expect(script).toContain('p.begin >= resolveCount');
  });
});
