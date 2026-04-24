import { describe, it, expect, vi } from 'vitest';

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
    output: { __HARVEST__: [], __antiDebugEvents__: [] },
  })),
}));

vi.mock('@modules/security/ExecutionSandbox', () => {
  class ExecutionSandbox {
    execute = vi.fn((...args: any[]) => (sandboxState.executeImpl as any)(...args));
  }
  return { ExecutionSandbox };
});

import { reconstructBehavior } from '@modules/deobfuscator/BehavioralReconstructor';
import type {
  BehavioralReconstruction,
  BehavioralCapability,
} from '@modules/deobfuscator/BehavioralReconstructor';

describe('BehavioralReconstructor', () => {
  it('BehavioralCapability interface has expected fields', () => {
    const cap: BehavioralCapability = {
      category: 'eval',
      description: 'test',
      evidence: 'test',
      risk: 'high',
    };
    expect(cap).toHaveProperty('category');
    expect(cap).toHaveProperty('description');
    expect(cap).toHaveProperty('evidence');
    expect(cap).toHaveProperty('risk');
  });

  it('BehavioralReconstruction interface has expected fields', () => {
    const recon: BehavioralReconstruction = {
      ok: true,
      code: 'function test() {}',
      summary: 'test',
      capabilities: [],
      confidence: 0.5,
      warnings: [],
      method: 'failed',
      captures: [],
      preludeFunctions: [],
    };
    expect(recon).toHaveProperty('ok');
    expect(recon).toHaveProperty('code');
    expect(recon).toHaveProperty('summary');
    expect(recon).toHaveProperty('capabilities');
    expect(recon).toHaveProperty('confidence');
    expect(recon).toHaveProperty('method');
  });

  it('capability extraction with eval captures', async () => {
    const sandbox = new (await import('@modules/security/ExecutionSandbox')).ExecutionSandbox();
    const result = await reconstructBehavior('eval("test")', sandbox);
    expect(result).toHaveProperty('capabilities');
    expect(Array.isArray(result.capabilities)).toBe(true);
  });

  it('capability extraction with WASM captures', async () => {
    const sandbox = new (await import('@modules/security/ExecutionSandbox')).ExecutionSandbox();
    const result = await reconstructBehavior('WebAssembly.instantiate(bytes)', sandbox);
    expect(result).toHaveProperty('capabilities');
    expect(result).toHaveProperty('confidence');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('capability extraction with network captures', async () => {
    const sandbox = new (await import('@modules/security/ExecutionSandbox')).ExecutionSandbox();
    const result = await reconstructBehavior('fetch("/api/data")', sandbox);
    expect(result).toHaveProperty('ok');
    expect(typeof result.ok).toBe('boolean');
  });

  it('behavioral summary generation', async () => {
    const sandbox = new (await import('@modules/security/ExecutionSandbox')).ExecutionSandbox();
    const result = await reconstructBehavior('const x = 1; eval(x);', sandbox);
    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('confidence scoring', async () => {
    const sandbox = new (await import('@modules/security/ExecutionSandbox')).ExecutionSandbox();
    const result = await reconstructBehavior('function test() { return 1; }', sandbox);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('with empty captures returns empty result', async () => {
    const sandbox = new (await import('@modules/security/ExecutionSandbox')).ExecutionSandbox();
    const result = await reconstructBehavior('', sandbox);
    expect(result).toHaveProperty('capabilities');
    expect(result.capabilities.length).toBe(0);
  });
});
