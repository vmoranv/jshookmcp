/**
 * Coverage tests for ErrorCaptureHook — page-eval wrappers with a mocked page.
 * The injected browser-side scripts are exercised end-to-end in the e2e suite;
 * here we verify the Node-side wrappers call page.evaluate and propagate state.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  getCapturedErrors,
  installErrorCaptureHook,
  uninstallErrorCaptureHook,
} from '@modules/webgpu/ErrorCaptureHook';

function mockPage(returnValue: unknown = undefined) {
  return {
    evaluate: vi.fn().mockResolvedValue(returnValue),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ErrorCaptureHook page-eval wrappers', () => {
  it('installErrorCaptureHook calls evaluate and returns a cleanup function', async () => {
    const page = mockPage();
    const cleanup = await installErrorCaptureHook(page as never, { captureCount: 5 });
    expect(page.evaluate).toHaveBeenCalled();
    expect(typeof cleanup).toBe('function');
    await cleanup();
    // ensureState (1) + install (1) + uninstall via cleanup (1) = 3 evaluate calls.
    expect(page.evaluate).toHaveBeenCalledTimes(3);
  });

  it('installErrorCaptureHook threads wrapAllocations through to the page script', async () => {
    const page = mockPage();
    await installErrorCaptureHook(page as never, { captureCount: 3, wrapAllocations: true });
    const call = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => typeof c[0] === 'function' && String(c[0]).includes('uncapturederror'),
    );
    expect(call).toBeDefined();
    // The second arg is the options payload.
    expect(call![1]).toMatchObject({ captureCount: 3, wrapAllocations: true });
  });

  it('getCapturedErrors returns the page.evaluate state', async () => {
    const state = {
      errors: [{ type: 'validation', message: 'bad descriptor', timestamp: 1 }],
      deviceLost: null,
      totalErrors: 1,
    };
    const page = mockPage(state);
    const r = await getCapturedErrors(page as never);
    expect(r.errors).toHaveLength(1);
    expect(r.totalErrors).toBe(1);
    expect(r.deviceLost).toBeNull();
  });

  it('getCapturedErrors returns an empty state when the page yields null', async () => {
    const page = mockPage(null);
    const r = await getCapturedErrors(page as never);
    expect(r.errors).toEqual([]);
    expect(r.totalErrors).toBe(0);
    expect(r.deviceLost).toBeNull();
  });

  it('uninstallErrorCaptureHook calls page.evaluate', async () => {
    const page = mockPage();
    await uninstallErrorCaptureHook(page as never);
    expect(page.evaluate).toHaveBeenCalled();
  });
});
