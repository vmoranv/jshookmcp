/* eslint-disable unicorn/consistent-function-scoping */
import { describe, expect, it, vi } from 'vitest';
import { JITInspector } from '@modules/v8-inspector/JITInspector';

function createInspector(
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
) {
  const session = {
    send: vi.fn(send),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const page = {
    createCDPSession: vi.fn().mockResolvedValue(session),
  };
  return new JITInspector(() => Promise.resolve(page));
}

describe('JITInspector', () => {
  it('inspects a script and reports optimized function tiers', async () => {
    const inspector = createInspector(async (method, params) => {
      if (method === 'Debugger.getScriptSource')
        return { scriptSource: 'function myFunc() { return 1; }' };
      if (method === 'Profiler.takePreciseCoverage') {
        return {
          result: [
            {
              scriptId: '1',
              functions: [{ functionName: 'myFunc', ranges: [{ startOffset: 0, endOffset: 30 }] }],
            },
          ],
        };
      }
      if (method === 'Runtime.evaluate' && params?.expression?.includes('%HaveSameMap')) {
        return { result: { value: true } };
      }
      if (method === 'Runtime.evaluate' && params?.expression?.includes('%GetOptimizationStatus')) {
        return { result: { value: 64 } };
      }
      return {};
    });

    const result = await inspector.inspectJIT('1');
    expect(result).toHaveLength(1);
    expect(result[0]?.optimized).toBe(true);
    expect(result[0]?.tier).toBe('turbofan');
  });

  it('returns a cached list of optimized functions', async () => {
    const inspector = new JITInspector();
    await expect(inspector.getOptimizedFunctions()).resolves.toEqual([]);
  });
});
