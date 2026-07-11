/**
 * Coverage tests for PipelineDumpHook — page-eval wrappers with a mocked page.
 * Browser-side descriptor sanitization is exercised end-to-end in the e2e suite.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  getCapturedPipelines,
  installPipelineDumpHook,
  uninstallPipelineDumpHook,
} from '@modules/webgpu/PipelineDumpHook';

function mockPage(returnValue: unknown = undefined) {
  return {
    evaluate: vi.fn().mockResolvedValue(returnValue),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PipelineDumpHook page-eval wrappers', () => {
  it('installPipelineDumpHook calls evaluate and returns a cleanup function', async () => {
    const page = mockPage();
    const cleanup = await installPipelineDumpHook(page as never, 5);
    expect(page.evaluate).toHaveBeenCalled();
    expect(typeof cleanup).toBe('function');
    await cleanup();
    // ensureState (1) + install (1) + uninstall via cleanup (1) = 3 evaluate calls.
    expect(page.evaluate).toHaveBeenCalledTimes(3);
  });

  it('install threads maxPipelines as the page-evaluate payload', async () => {
    const page = mockPage();
    await installPipelineDumpHook(page as never, 7);
    const call = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => typeof c[0] === 'function' && String(c[0]).includes('createRenderPipeline'),
    );
    expect(call).toBeDefined();
    expect(call![1]).toBe(7);
  });

  it('getCapturedPipelines returns the page.evaluate state', async () => {
    const state = {
      pipelines: [
        {
          kind: 'render',
          method: 'createRenderPipeline',
          descriptor: { vertex: { entryPoint: 'vs_main' } },
          timestamp: 1,
        },
      ],
      totalCreated: 1,
    };
    const page = mockPage(state);
    const r = await getCapturedPipelines(page as never);
    expect(r.pipelines).toHaveLength(1);
    expect(r.pipelines[0]!.kind).toBe('render');
    expect(r.totalCreated).toBe(1);
  });

  it('getCapturedPipelines returns an empty state when the page yields null', async () => {
    const page = mockPage(null);
    const r = await getCapturedPipelines(page as never);
    expect(r.pipelines).toEqual([]);
    expect(r.totalCreated).toBe(0);
  });

  it('uninstallPipelineDumpHook calls page.evaluate', async () => {
    const page = mockPage();
    await uninstallPipelineDumpHook(page as never);
    expect(page.evaluate).toHaveBeenCalled();
  });
});
