import { describe, it, expect, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const sandboxState = vi.hoisted(() => ({
  executeImpl: vi.fn<(...args: any[]) => Promise<{ ok: boolean; output: any }>>(async () => ({
    ok: false,
    output: null,
  })),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@modules/security/ExecutionSandbox', () => {
  class ExecutionSandbox {
    execute = vi.fn((...args: any[]) => (sandboxState.executeImpl as any)(...args));
  }
  return { ExecutionSandbox };
});

import { EnhancedDeobfuscationPipeline } from '@modules/deobfuscator/EnhancedPipeline';

describe('EnhancedPipeline', () => {
  const pipeline = new EnhancedDeobfuscationPipeline();

  describe('run', () => {
    it('processes simple code without errors', async () => {
      const code = `function add(a,b){return a+b;}`;
      const result = await pipeline.run({ code });
      expect(result.originalCode).toBe(code);
    });

    it('returns obfuscation types detected', async () => {
      const code = `function test(){return 42;}`;
      const result = await pipeline.run({ code });
      expect(result.obfuscationTypes).toBeInstanceOf(Array);
    });

    it('returns readability scores', async () => {
      const code = `function test(){return 42;}`;
      const result = await pipeline.run({ code });
      expect(result.readabilityScoreBefore).toBeGreaterThanOrEqual(0);
      expect(result.readabilityScore).toBeGreaterThanOrEqual(0);
    });

    it('returns confidence score', async () => {
      const code = `function test(){return 42;}`;
      const result = await pipeline.run({ code });
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('returns pipeline steps', async () => {
      const code = `function test(){return 42;}`;
      const result = await pipeline.run({ code });
      expect(result.steps).toBeInstanceOf(Array);
    });

    it('handles obfuscator.io style code', async () => {
      const code = `var _0x1a2b = ["hello","world"]; console.log(_0x1a2b[0]);`;
      const result = await pipeline.run({ code });
      expect(result.code).toBeTruthy();
    });

    it('handles code with anti-debug patterns', async () => {
      const code = `function test(){ debugger; return 42; }`;
      const result = await pipeline.run({ code, skipCFF: true, skipStringArray: true });
      expect(result.steps).toBeInstanceOf(Array);
    });

    it('includes fingerprint when enabled', async () => {
      const code = `__webpack_require__;`;
      const result = await pipeline.run({ code, fingerprint: true });
      expect(result.fingerprint).toBeTruthy();
    });

    it('includes bundle format when enabled', async () => {
      const code = `__webpack_require__; __webpack_modules__;`;
      const result = await pipeline.run({ code, detectBundle: true });
      expect(result.bundleFormat).toBeTruthy();
      expect(result.bundleFormat?.format).toBe('webpack');
    });

    it('skips steps when requested', async () => {
      const code = `function test(){return 42;}`;
      const result = await pipeline.run({
        code,
        skipCFF: true,
        skipStringArray: true,
        skipAntiDebug: true,
        skipConstantProp: true,
        skipDeadStore: true,
        skipAST: true,
      });
      expect(result.steps.length).toBeGreaterThan(0);
    });

    it('returns round metadata', async () => {
      const code = `function test(){return 42;}`;
      const result = await pipeline.run({ code });
      expect(result.metadata.rounds).toBeGreaterThanOrEqual(1);
      expect(result.metadata.roundResults).toBeInstanceOf(Array);
      expect(result.metadata.roundResults.length).toBe(result.metadata.rounds);
    });

    it('respects maxRounds option', async () => {
      const code = `function test(){return 42;}`;
      const result = await pipeline.run({ code, maxRounds: 1 });
      expect(result.metadata.rounds).toBeLessThanOrEqual(1);
    });

    it('returns sourcemap when generateSourcemap is true', async () => {
      const code = `function test(){return 42;}`;
      const result = await pipeline.run({ code, generateSourcemap: true });
      expect(result.sourcemap).toBeTruthy();
      expect(() => JSON.parse(result.sourcemap!)).not.toThrow();
      const parsed = JSON.parse(result.sourcemap!);
      expect(parsed.version).toBe(3);
    });
  });

  describe('runBatch', () => {
    it('processes multiple files', async () => {
      const codes = [
        `function add(a,b){return a+b;}`,
        `function sub(a,b){return a-b;}`,
      ];
      const results = await pipeline.runBatch(codes.map((code) => ({ code })));
      expect(results).toHaveLength(2);
      expect(results[0]?.originalCode).toBe(codes[0]);
      expect(results[1]?.originalCode).toBe(codes[1]);
    });
  });
});
