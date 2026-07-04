/**
 * Coverage tests for CommandHook — analyzeCommandTrace (pure classification)
 * + the page-eval wrappers (reset / get / uninstall) with a mocked page.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  analyzeCommandTrace,
  getGPUCommandTrace,
  resetGPUCommandTrace,
  uninstallGPUCommandHook,
} from '@modules/webgpu/CommandHook';

function mockPage(returnValue: unknown = undefined): { evaluate: ReturnType<typeof vi.fn> } {
  return { evaluate: vi.fn().mockResolvedValue(returnValue) };
}

describe('analyzeCommandTrace — gap-based classification', () => {
  it('gap > 50 → compute; last command (no next) → copy', () => {
    const trace = {
      commands: [{ timestamp: 100 }, { timestamp: 200 }],
      totalSubmissions: 2,
    } as never;
    const r = analyzeCommandTrace(trace);
    expect(r.inferredTypes[0]?.inferredType).toBe('compute'); // gap 100
    expect(r.inferredTypes[1]?.inferredType).toBe('copy'); // no next → gap 0 < 5
  });

  it('gap < 5 → copy', () => {
    const trace = { commands: [{ timestamp: 0 }, { timestamp: 3 }], totalSubmissions: 1 } as never;
    expect(analyzeCommandTrace(trace).inferredTypes[0]?.inferredType).toBe('copy');
  });

  it('gap 5–50 → render', () => {
    const trace = { commands: [{ timestamp: 0 }, { timestamp: 25 }], totalSubmissions: 1 } as never;
    expect(analyzeCommandTrace(trace).inferredTypes[0]?.inferredType).toBe('render');
  });

  it('returns the original trace fields + inferredTypes', () => {
    const trace = { commands: [{ timestamp: 0 }], totalSubmissions: 1, startTime: 99 } as never;
    const r = analyzeCommandTrace(trace);
    expect(r.totalSubmissions).toBe(1);
    expect(r.inferredTypes.length).toBe(1);
  });

  it('handles an empty command list', () => {
    const r = analyzeCommandTrace({ commands: [], totalSubmissions: 0 } as never);
    expect(r.inferredTypes).toEqual([]);
  });
});

describe('page-eval wrappers', () => {
  it('resetGPUCommandTrace calls page.evaluate', async () => {
    const page = mockPage();
    await resetGPUCommandTrace(page as never);
    expect(page.evaluate).toHaveBeenCalled();
  });

  it('getGPUCommandTrace returns whatever page.evaluate yields', async () => {
    const trace = { commands: [{ timestamp: 0 }], totalSubmissions: 1 };
    const page = mockPage(trace);
    const r = await getGPUCommandTrace(page as never);
    expect(r).toBe(trace);
  });

  it('uninstallGPUCommandHook calls page.evaluate', async () => {
    const page = mockPage();
    await uninstallGPUCommandHook(page as never);
    expect(page.evaluate).toHaveBeenCalled();
  });
});
