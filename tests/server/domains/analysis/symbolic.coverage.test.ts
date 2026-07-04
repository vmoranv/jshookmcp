/**
 * Coverage tests for symbolic handlers — exercises input validation +
 * executor delegation (SymbolicExecutor / JSVMPSymbolicExecutor mocked).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn();
const mockExecuteJsvmp = vi.fn();

vi.mock('@modules/symbolic/SymbolicExecutor', () => ({
  SymbolicExecutor: class {
    execute = (...args: unknown[]) => mockExecute(...args);
  },
}));

vi.mock('@modules/symbolic/JSVMPSymbolicExecutor', () => ({
  JSVMPSymbolicExecutor: class {
    executeJSVMP = (...args: unknown[]) => mockExecuteJsvmp(...args);
  },
}));

import {
  handleJsSymbolicExecute,
  handleJsSymbolicExecuteJsvmp,
} from '@server/domains/analysis/handlers/symbolic';

function body(r: { content?: Array<{ text?: string }> }): Record<string, unknown> {
  return JSON.parse(r.content?.[0]?.text ?? '{}');
}

beforeEach(() => {
  mockExecute.mockReset();
  mockExecuteJsvmp.mockReset();
});

describe('handleJsSymbolicExecute', () => {
  it('throws when code is missing (argStringRequired)', async () => {
    await expect(handleJsSymbolicExecute({} as never)).rejects.toThrow(/code/);
  });

  it('delegates to SymbolicExecutor.execute and forwards optional bounds', async () => {
    mockExecute.mockResolvedValue({ paths: [], pathCount: 0 });
    const r = await handleJsSymbolicExecute({
      code: 'var x = 1;',
      maxPaths: 5,
      maxDepth: 3,
      timeout: 100,
      enableConstraintSolving: true,
    } as never);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'var x = 1;',
        maxPaths: 5,
        maxDepth: 3,
        timeout: 100,
        enableConstraintSolving: true,
      }),
    );
    expect(body(r).pathCount).toBe(0);
  });

  it('works with only the required code arg', async () => {
    mockExecute.mockResolvedValue({ pathCount: 1 });
    const r = await handleJsSymbolicExecute({ code: 'f()' } as never);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'f()', enableConstraintSolving: false }),
    );
    expect(body(r).pathCount).toBe(1);
  });
});

describe('handleJsSymbolicExecuteJsvmp', () => {
  it('errors when instructions is missing or not an array', async () => {
    const r1 = await handleJsSymbolicExecuteJsvmp({} as never);
    expect(body(r1).error).toMatch(/instructions array is required/);
    const r2 = await handleJsSymbolicExecuteJsvmp({ instructions: 'nope' } as never);
    expect(body(r2).error).toMatch(/instructions array is required/);
  });

  it('BUG: rejects valid instruction arrays (argObject excludes arrays → delegation unreachable)', async () => {
    // argObject() returns undefined for Array input (!Array.isArray check),
    // so handleJsSymbolicExecuteJsvmp always hits the error branch even when
    // a valid instructions array is supplied. The executeJSVMP delegation is
    // therefore dead code via the handler. Documented here; not fixed in this
    // coverage pass. Calling still returns the well-formed error response.
    const r = await handleJsSymbolicExecuteJsvmp({
      instructions: [{ op: 'PUSH', args: [1] }],
    } as never);
    expect(body(r).error).toMatch(/instructions array is required/);
    expect(mockExecuteJsvmp).not.toHaveBeenCalled();
  });
});
