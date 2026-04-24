import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));

const sandboxState = vi.hoisted(() => ({
  executeImpl: vi.fn<(...args: any[]) => Promise<{ ok: boolean; output: any }>>(async () => ({
    ok: true,
    output: null,
  })),
}));

vi.mock('@modules/security/ExecutionSandbox', () => {
  class ExecutionSandbox {
    execute = vi.fn((...args: any[]) => (sandboxState.executeImpl as any)(...args));
  }
  return { ExecutionSandbox };
});

import { UnifiedDeobfuscationPipeline } from '@modules/deobfuscator/UnifiedPipeline';

describe('UnifiedPipeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
    sandboxState.executeImpl.mockReset();
    sandboxState.executeImpl.mockResolvedValue({ ok: true, output: null });
  });

  it('can be instantiated', () => {
    const pipeline = new UnifiedDeobfuscationPipeline();
    expect(pipeline).toBeInstanceOf(UnifiedDeobfuscationPipeline);
  });

  it('run() with clean code returns result with code, obfuscationTypes, readability scores', async () => {
    const pipeline = new UnifiedDeobfuscationPipeline();
    const result = await pipeline.run({ code: 'const x = 42;' });
    expect(typeof result.code).toBe('string');
    expect(Array.isArray(result.obfuscationTypes)).toBe(true);
    expect(typeof result.readabilityScore).toBe('number');
    expect(typeof result.readabilityScoreBefore).toBe('number');
  });

  it('run() with obfuscated code (javascript-obfuscator style _0x arrays)', async () => {
    const obfuscated = `var _0x1a2b=["hello","world"];function _0x3c4d(i){return _0x1a2b[i];}console.log(_0x3c4d(0));`;
    const pipeline = new UnifiedDeobfuscationPipeline();
    const result = await pipeline.run({ code: obfuscated });
    expect(result.code.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('run() respects skip options', async () => {
    const pipeline = new UnifiedDeobfuscationPipeline();
    const result = await pipeline.run({
      code: 'const x = 1;',
      skipCFF: true,
      skipStringArray: true,
      skipAntiDebug: true,
      skipWebcrack: true,
    });
    expect(result.code).toBeDefined();
    expect(Array.isArray(result.steps)).toBe(true);
  });

  it('run() returns fingerprint when enabled', async () => {
    const pipeline = new UnifiedDeobfuscationPipeline();
    const result = await pipeline.run({ code: 'var _0x1a2b=["test"];', fingerprint: true });
    expect(result.fingerprint).toBeDefined();
    expect(result.fingerprint).toHaveProperty('tool');
    expect(result.fingerprint).toHaveProperty('confidence');
  });

  it('run() returns steps array', async () => {
    const pipeline = new UnifiedDeobfuscationPipeline();
    const result = await pipeline.run({ code: 'const x = 1;' });
    expect(Array.isArray(result.steps)).toBe(true);
    if (result.steps.length > 0) {
      expect(result.steps[0]).toHaveProperty('stage');
      expect(result.steps[0]).toHaveProperty('applied');
      expect(result.steps[0]).toHaveProperty('codeLength');
    }
  });

  it('run() returns confidence between 0 and 1', async () => {
    const pipeline = new UnifiedDeobfuscationPipeline();
    const result = await pipeline.run({ code: 'function test() { return 1; }' });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('runBatch() processes multiple files', async () => {
    const pipeline = new UnifiedDeobfuscationPipeline();
    const results = await pipeline.runBatch([{ code: 'const a = 1;' }, { code: 'const b = 2;' }]);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(2);
    expect(results[0]!.code).toBeDefined();
    expect(results[1]!.code).toBeDefined();
  });

  it('handles empty code gracefully', async () => {
    const pipeline = new UnifiedDeobfuscationPipeline();
    const result = await pipeline.run({ code: '' });
    expect(result.code).toBe('');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it('handles unicode code gracefully', async () => {
    const pipeline = new UnifiedDeobfuscationPipeline();
    const result = await pipeline.run({ code: 'const msg = "\u4f60\u597d\u4e16\u754c";' });
    expect(result.code).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });
});
