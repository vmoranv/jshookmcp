/**
 * Coverage tests for JSVMPDeobfuscator.restore.ts — exercise all uncovered branches.
 *
 * Gaps in the main test suite:
 *  - restoreJSVMPCode: all 4 vmType branches (obfuscator.io, jsfuck, jjencode, default/custom)
 *  - restoreObfuscatorIO:
 *      outer try/catch error path (skipped — hard to trigger without internals patching)
 *      string array match with sandbox returning non-array
 *      string array match with sandbox throwing
 *      no string array match
 *      aggressive=false branch (skip aggressive-only regex)
 *      hex replacement branch
 *      ;; and { } cleanup branches
 *  - restoreJSFuck:
 *      outer try/catch error path (skipped — hard to trigger)
 *      code.length > 100000 early-return branch
 *      sandbox returning non-string branch
 *      inner catch (execError) path
 *  - restoreJJEncode:
 *      outer try/catch error path (skipped — hard to trigger)
 *      no $$$$ match — sandbox not-ok branch
 *      no $$$$ match — sandbox ok but non-string result branch
 *      inner catch (execError) path
 *  - restoreCustomVMBasic:
 *      aggressive=false branch (skip aggressive-only replacements)
 *      outer catch error path (skipped — hard to trigger)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  restoreJSVMPCode,
  restoreCustomVMBasic,
} from '../../../src/modules/deobfuscator/JSVMPDeobfuscator.restore';

// ── Mock shared state (hoisted before vi.mock) ─────────────────────────────────

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

// ── Mocks ───────────────────────────────────────────────────────────────────────

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@src/modules/security/ExecutionSandbox', () => {
  class ExecutionSandbox {
    // Default implementation; individual tests replace execute entirely.
    execute = vi.fn(async () => ({ ok: true, output: 'sandbox-output' }));
  }
  return { ExecutionSandbox };
});

// ── Sandbox factory helpers ────────────────────────────────────────────────────

/** Create a sandbox-like object with a configurable execute fn. */
function makeSandbox(opts?: { ok?: boolean; output?: unknown; error?: string; reject?: boolean }) {
  const cfg = opts ?? {};
  const fn = vi.fn(async () => {
    if (cfg.reject) throw new Error(cfg.error ?? 'sandbox error');
    return { ok: cfg.ok ?? true, output: cfg.output, error: cfg.error };
  }) as any;
  fn.mockResolvedValueOnce = fn.mockImplementationOnce; // no-op compat
  fn.mockRejectedValueOnce = (err: Error) => fn.mockImplementationOnce(() => Promise.reject(err));
  return { execute: fn };
}

// ── Testable wrapper ───────────────────────────────────────────────────────────
// restore.ts exports only standalone functions (no class).  TestableRestore wraps
// them in a class solely to satisfy the "one writer per file" convention.

class TestableRestore {
  testRestoreCustomVMBasic(
    code: string,
    aggressive: boolean,
    warnings: string[],
    unresolvedParts: any[],
  ) {
    return restoreCustomVMBasic(code, aggressive, warnings, unresolvedParts);
  }
}

describe('JSVMPDeobfuscator.restore — coverage', () => {
  let wrapper: TestableRestore;

  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    wrapper = new TestableRestore();
  });

  // ── restoreCustomVMBasic ──────────────────────────────────────────────────────

  describe('restoreCustomVMBasic', () => {
    it('aggressive=true: removes debugger, redundant ternary, updates confidence', () => {
      const warnings: string[] = [];
      const unresolvedParts: any[] = [];
      const code = 'debugger; if(a){} "" + x; cond ? same : same;';
      const result = wrapper.testRestoreCustomVMBasic(code, true, warnings, unresolvedParts);

      expect(result.code).not.toContain('debugger');
      expect(result.code).not.toContain('cond ? same : same');
      expect(result.code).not.toContain('!!(');
      // confidence: 0.3 + 0.1 (debugger) + 0.05 (ternary) = 0.45
      expect(result.confidence).toBe(0.45);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.unresolvedParts).toBeDefined();
      expect(result.unresolvedParts!.length).toBeGreaterThan(0);
    });

    it('aggressive=false: removes !! and empty if, skips aggressive-only transforms', () => {
      const warnings: string[] = [];
      const unresolvedParts: any[] = [];
      // debugger removal is only in the aggressive branch
      const code = '!!(x); if(a){} "" + y; debugger;';
      const result = wrapper.testRestoreCustomVMBasic(code, false, warnings, unresolvedParts);

      expect(result.code).not.toContain('!!'); // unconditional
      expect(result.code).not.toContain('if(a){}'); // unconditional
      expect(result.code).not.toContain('"" +'); // unconditional
      expect(result.code).toContain('debugger'); // aggressive-only → kept
      expect(result.confidence).toBe(0.3); // no bonus
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.unresolvedParts).toBeDefined();
    });

    // Outer catch: hard to trigger without internals patching — documented but skipped.
    it.skip('outer catch fires when the try block throws unexpectedly', () => {});
  });

  // ── restoreJSVMPCode — vmType branches ───────────────────────────────────────

  describe('restoreJSVMPCode', () => {
    it('routes obfuscator.io to restoreObfuscatorIO', async () => {
      const sandbox = makeSandbox({ ok: false });
      const result = await restoreJSVMPCode(
        { sandbox } as any,
        'var _0xa = ["a"];',
        'obfuscator.io',
        false,
      );
      expect(result.code).toBeDefined();
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('routes jsfuck to restoreJSFuck', async () => {
      const sandbox = makeSandbox({ ok: false, output: undefined });
      const result = await restoreJSVMPCode({ sandbox } as any, '[][([][[]]+[])]', 'jsfuck', false);
      expect(result.code).toBeDefined();
    });

    it('routes jjencode to restoreJJEncode', async () => {
      const sandbox = makeSandbox({ ok: false, output: undefined });
      const result = await restoreJSVMPCode({ sandbox } as any, '$=~[];', 'jjencode', false);
      expect(result.code).toBeDefined();
    });

    it('routes custom to restoreCustomVM which delegates to restoreCustomVMBasic', async () => {
      const sandbox = makeSandbox();
      const result = await restoreJSVMPCode({ sandbox } as any, 'debugger; !!x;', 'custom', true);
      expect(result.code).not.toContain('debugger');
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  // ── restoreObfuscatorIO ───────────────────────────────────────────────────────

  describe('restoreObfuscatorIO', () => {
    it('no string array match: skips array processing, applies IIFE removal', async () => {
      const sandbox = makeSandbox();
      const code = '(function(_0x1,_0x2){}(0x1,0xa));';
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'obfuscator.io', false);
      expect(result.code).not.toContain('_0x1,_0x2');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('string array match: sandbox returns array → replaces indices, confidence +0.2', async () => {
      const sandbox = makeSandbox({ ok: true, output: ['hello', 'world'] });
      const code = 'var _0x1 = ["hello","world"]; x = _0x1[0] + _0x1[1];';
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'obfuscator.io', false);
      expect(result.code).toContain('"hello"');
      expect(result.code).toContain('"world"');
      // confidence: 0.5 (base) + 0.2 (array) = 0.7
      expect(result.confidence).toBe(0.7);
    });

    it('string array match: sandbox returns non-array → skips array processing', async () => {
      const sandbox = makeSandbox({ ok: true, output: 'not-an-array' });
      const code = 'var _0x1 = ["a"];';
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'obfuscator.io', false);
      expect(result.code).toBeDefined();
      // Array.isArray check fails → no +0.2 bonus
      expect(result.confidence).toBe(0.5);
    });

    it('string array match: sandbox throws → adds unresolved part', async () => {
      const sandbox = makeSandbox({ reject: true, error: 'sandbox boom' });
      const code = 'var _0x1 = ["a"];';
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'obfuscator.io', false);
      expect(result.unresolvedParts).toBeDefined();
      expect(result.unresolvedParts!.length).toBeGreaterThan(0);
      expect(result.warnings.some((w: string) => w.includes('sandbox boom'))).toBe(true);
    });

    it('aggressive=true: unwraps IIFE and adds confidence', async () => {
      const sandbox = makeSandbox({ ok: false }); // no string array match
      const code = '(function(){return 42;}());';
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'obfuscator.io', true);
      expect(result.code).toContain('return 42');
      // confidence: 0.5 + 0.1 (aggressive) = 0.6
      expect(result.confidence).toBe(0.6);
    });

    it('converts 0x hex literals to decimal', async () => {
      const sandbox = makeSandbox({ ok: false });
      const code = 'x = 0x10 + 0xff;';
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'obfuscator.io', false);
      expect(result.code).toContain('16');
      expect(result.code).toContain('255');
    });

    it('removes double semicolons and empty blocks', async () => {
      const sandbox = makeSandbox({ ok: false });
      const code = 'a;; b { } c';
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'obfuscator.io', false);
      expect(result.code).not.toContain(';;');
      expect(result.code).not.toContain('{ }');
    });

    it.skip('outer catch: returns original code with low confidence on error', () => {});
  });

  // ── restoreJSFuck ─────────────────────────────────────────────────────────────

  describe('restoreJSFuck', () => {
    // Note: JSFuck code must be <= 100000 chars to bypass the early-return check.
    // Use a short valid JSFuck fragment.
    const SHORT_CODE = '[][([][[]]+[])]';

    it('code too large (>100000 chars): returns early with low confidence', async () => {
      const sandbox = makeSandbox();
      const code = '[][' + 'x'.repeat(100000) + ']'; // well over 100k
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'jsfuck', false);
      expect(result.code).toBe(code);
      expect(result.confidence).toBe(0.1);
      expect(result.warnings.some((w: string) => w.includes('too large'))).toBe(true);
    });

    it('sandbox returns string: high confidence (0.9)', async () => {
      const sandbox = makeSandbox({ ok: true, output: 'decoded!' });
      const result = await restoreJSVMPCode({ sandbox } as any, SHORT_CODE, 'jsfuck', false);
      expect(result.code).toBe('decoded!');
      expect(result.confidence).toBe(0.9);
    });

    it('sandbox returns non-string: low confidence (0.2)', async () => {
      const sandbox = makeSandbox({ ok: true, output: 12345 });
      const result = await restoreJSVMPCode({ sandbox } as any, SHORT_CODE, 'jsfuck', false);
      expect(result.code).toBe(SHORT_CODE); // original returned
      expect(result.confidence).toBe(0.2);
    });

    it('sandbox throws execError: lower confidence (0.1), adds tool suggestion', async () => {
      const sandbox = makeSandbox({ reject: true, error: 'exec failed' });
      const result = await restoreJSVMPCode({ sandbox } as any, SHORT_CODE, 'jsfuck', false);
      expect(result.code).toBe(SHORT_CODE);
      expect(result.confidence).toBe(0.1);
      expect(result.warnings.some((w: string) => w.includes('exec failed'))).toBe(true);
      expect(result.warnings.some((w: string) => w.includes('online'))).toBe(true);
    });

    it.skip('outer catch: returns original with confidence 0.1', () => {});
  });

  // ── restoreJJEncode ───────────────────────────────────────────────────────────

  describe('restoreJJEncode', () => {
    // JJEncode patterns used in tests:
    // - Without $$$$: code that doesn't match the $$$$ check
    // - With $$$$: code where the last non-empty line contains $$$$

    it('$$$$ in last line: sandbox executes and returns string → high confidence', async () => {
      // restoreJJEncode splits on '\n', takes the last non-empty line, and checks
      // if it includes '$$$$'.  We use a code string whose last line is exactly $$$$().
      const sandbox = makeSandbox({ ok: true, output: 'decoded-jj' });
      const code = 'some code\nreturn $$$$()';
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'jjencode', false);
      expect(result.code).toBe('decoded-jj');
      expect(result.confidence).toBe(0.9);
    });

    it('no $$$$: sandbox ok, non-string output → low confidence (0.2)', async () => {
      // No $$$$ → falls through to `execute({ code })` which is called with
      // a non-string output mock here.
      const sandbox = makeSandbox({ ok: true, output: 42 });
      const code = '$=~[];'; // no $$$$
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'jjencode', false);
      expect(result.code).toBe(code);
      expect(result.confidence).toBe(0.2);
      expect(result.warnings).toContainEqual('JJEncode deobfuscation may be incomplete');
    });

    it('no $$$$: sandbox not-ok → adds warn log', async () => {
      const sandbox = makeSandbox({ ok: false, error: 'sandbox error' });
      const code = '$=~[];';
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'jjencode', false);
      expect(result.code).toBe(code);
      expect(result.confidence).toBe(0.2);
      expect(loggerState.warn).toHaveBeenCalled();
    });

    it('inner catch (execError): adds warning about evaluation artifacts', async () => {
      // No $$$$ → falls through to `execute({ code })` which throws here.
      const sandbox = makeSandbox({ reject: true, error: 'eval error' });
      const code = '$=~[];';
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'jjencode', false);
      expect(result.code).toBe(code);
      expect(result.confidence).toBe(0.1);
      expect(result.warnings.some((w: string) => w.includes('eval error'))).toBe(true);
      expect(result.warnings).toContainEqual('Result may contain evaluation artifacts');
    });

    it.skip('outer catch: returns original with confidence 0.1', () => {});
  });

  // ── Confidence boundary: Math.min clamps to 1.0 ─────────────────────────────

  describe('confidence clamping', () => {
    it('restoreObfuscatorIO: confidence does not exceed 1.0', async () => {
      // With string array (+0.2) + aggressive (+0.1) = 0.8, still below 1.0 cap
      const sandbox = makeSandbox({ ok: true, output: ['a', 'b'] });
      const code = 'var _0x1 = ["a","b"]; x = _0x1[0]; (function(){return 1;}());';
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'obfuscator.io', true);
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  // ── unresolvedParts: empty array means undefined in result ──────────────────

  describe('unresolvedParts edge cases', () => {
    it('restoreCustomVMBasic: always pushes an unresolved part → never undefined', () => {
      const warnings: string[] = [];
      const unresolvedParts: any[] = [];
      const result = wrapper.testRestoreCustomVMBasic('x', false, warnings, unresolvedParts);
      expect(result.unresolvedParts).toBeDefined();
      expect(result.unresolvedParts!.length).toBeGreaterThan(0);
    });

    it('restoreObfuscatorIO: unresolvedParts undefined when no errors occurred', async () => {
      const sandbox = makeSandbox({ ok: false }); // no string array match, no error
      const code = '(function(_0x1){}(1));';
      const result = await restoreJSVMPCode({ sandbox } as any, code, 'obfuscator.io', false);
      expect(result.unresolvedParts).toBeUndefined();
    });
  });
});
