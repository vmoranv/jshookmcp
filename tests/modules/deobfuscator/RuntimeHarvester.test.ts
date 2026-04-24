import { describe, it, expect, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));

import {
  buildHarvesterHarness,
  buildSandboxOptions,
  prepareHarvest,
  parseHarvestResult,
} from '@modules/deobfuscator/RuntimeHarvester';

describe('RuntimeHarvester', () => {
  it('buildHarvesterHarness returns string containing harvest hooks', () => {
    const harness = buildHarvesterHarness('console.log("test");', { mode: 'observe' });
    expect(typeof harness).toBe('string');
    expect(harness).toContain('__HARVEST__');
    expect(harness).toContain('__hp__(');
  });

  it('buildHarvesterHarness with different hook configurations', () => {
    const harnessEval = buildHarvesterHarness('eval("x")', { mode: 'observe', hooks: ['eval'] });
    expect(harnessEval).toContain('eval');

    const harnessWasm = buildHarvesterHarness('WebAssembly.instantiate()', {
      mode: 'observe',
      hooks: ['WebAssembly'],
      captureWASM: true,
    });
    expect(harnessWasm).toContain('WebAssembly');
  });

  it('buildSandboxOptions for each mode', () => {
    const observe = buildSandboxOptions('observe');
    expect(observe.mode).toBe('observe');
    expect(observe.preserveToString).toBe(true);

    const emulate = buildSandboxOptions('emulate');
    expect(emulate.mode).toBe('emulate');
    expect(emulate.fakeEnvironment).toBe(true);

    const strict = buildSandboxOptions('strict');
    expect(strict.mode).toBe('strict');
  });

  it('buildSandboxOptions with overrides', () => {
    const opts = buildSandboxOptions('observe', { timeoutMs: 3000, maxCaptureBytes: 1024 });
    expect(opts.timeoutMs).toBe(3000);
    expect(opts.maxCaptureBytes).toBe(1024);
  });

  it('prepareHarvest returns harness code and options', () => {
    const result = prepareHarvest('const x = 1;', 'emulate');
    expect(result).toHaveProperty('harnessCode');
    expect(result).toHaveProperty('options');
    expect(typeof result.harnessCode).toBe('string');
    expect(result.options.mode).toBe('emulate');
  });

  it('parseHarvestResult with valid harvest data', () => {
    const raw = {
      __HARVEST__: [
        {
          category: 'eval-source',
          value: 'test',
          trigger: 'eval()',
          relativeTimestampMs: 10,
          sizeBytes: 4,
          truncated: false,
          confidence: 0.9,
        },
      ],
      __antiDebugEvents__: [],
    };
    const result = parseHarvestResult(raw, Date.now() - 100);
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.captures)).toBe(true);
    expect(result.captures.length).toBe(1);
    expect(result.captures[0]!.category).toBe('eval-source');
  });

  it('parseHarvestResult with empty/invalid data', () => {
    const empty = parseHarvestResult({}, Date.now());
    expect(empty.ok).toBe(true);
    expect(empty.captures.length).toBe(0);

    const invalid = parseHarvestResult(null, Date.now());
    expect(Array.isArray(invalid.captures)).toBe(true);
  });

  it('harness code contains __HARVEST__ global', () => {
    const harness = buildHarvesterHarness('var x = 1;', { mode: 'strict' });
    expect(harness).toContain('var __HARVEST__ = []');
  });

  it('harness is UTF-8 safe', () => {
    const harness = buildHarvesterHarness('const msg = "\u4f60\u597d";', { mode: 'observe' });
    expect(typeof harness).toBe('string');
    expect(harness.length).toBeGreaterThan(0);
  });
});
