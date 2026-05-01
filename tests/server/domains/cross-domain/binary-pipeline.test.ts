import { describe, expect, it, beforeEach } from 'vitest';
import { buildBinaryToJSPipeline } from '@server/domains/cross-domain/handlers/binary-to-js-pipeline';
import {
  CrossDomainEvidenceBridge,
  resetIdCounter,
} from '@server/domains/cross-domain/handlers/evidence-graph-bridge';
import {
  ReverseEvidenceGraph,
  resetIdCounter as _resetGraphIdCounter,
} from '@server/evidence/ReverseEvidenceGraph';

describe('BIN-04: Binary-to-JS Pipeline', () => {
  let bridge: CrossDomainEvidenceBridge;

  beforeEach(() => {
    resetIdCounter();
    _resetGraphIdCounter();
    bridge = new CrossDomainEvidenceBridge(new ReverseEvidenceGraph());
  });

  it('should generate Frida hook script for native callable functions', async () => {
    const result = buildBinaryToJSPipeline(bridge, {
      functions: [
        { name: 'native_encrypt', moduleName: 'libcrypto.so', address: '0x7fff1000' },
        { name: 'internal_helper', moduleName: 'libcore.so' },
      ],
      moduleName: 'libgame.so',
    });

    expect(result.hookCount).toBeGreaterThanOrEqual(0);
    expect(result.generatedHookScript).toContain('// Binary-to-JS Hook Script');
    expect(result.generatedHookScript).toContain('Interceptor.attach');
  });

  it('should filter functions by native_ prefix pattern', async () => {
    const result = buildBinaryToJSPipeline(bridge, {
      functions: [
        { name: 'native_process_payment', moduleName: 'libcore.so' },
        { name: 'internal_utils', moduleName: 'libcore.so' },
        { name: 'JS_process_data', moduleName: 'libcore.so' },
        { name: 'calculate_score', moduleName: 'libgame.so' },
      ],
      moduleName: 'libgame.so',
    });

    expect(result.injectedFunctions).toContain('native_process_payment');
    expect(result.injectedFunctions).not.toContain('internal_utils');
    expect(result.hookCount).toBeGreaterThanOrEqual(1);
  });

  it('should filter functions by explicit call-graph from Ghidra', async () => {
    const result = buildBinaryToJSPipeline(bridge, {
      functions: [
        { name: 'unexported_helper', moduleName: 'libcore.so', calledFrom: ['main'] },
        { name: 'calculate_internal', moduleName: 'libgame.so' },
      ],
      moduleName: 'libgame.so',
    });

    expect(result.injectedFunctions).toContain('unexported_helper');
  });

  it('should filter functions by caller-provided list', async () => {
    const result = buildBinaryToJSPipeline(
      bridge,
      {
        functions: [
          { name: 'obscure_func', moduleName: 'libcore.so' },
          { name: 'other_func', moduleName: 'libcore.so' },
        ],
        moduleName: 'libcore.so',
      },
      ['obscure_func'],
    );

    expect(result.injectedFunctions).toContain('obscure_func');
    expect(result.injectedFunctions).not.toContain('other_func');
  });

  it('should create evidence graph links for generated hooks', async () => {
    const result = buildBinaryToJSPipeline(bridge, {
      functions: [{ name: 'native_foo', moduleName: 'libtest.so' }],
      moduleName: 'libtest.so',
    });

    expect(result.evidenceGraphLinks.length).toBe(result.injectedFunctions.length);
    for (const link of result.evidenceGraphLinks) {
      expect(link.binarySymbolNodeId).toMatch(/^binary-symbol-/);
      expect(link.hookScriptNodeId).toMatch(/^breakpoint-hook-/);
    }
  });

  it('should handle empty function list', async () => {
    const result = buildBinaryToJSPipeline(bridge, {
      functions: [],
      moduleName: 'libempty.so',
    });

    expect(result.hookCount).toBe(0);
    expect(result.injectedFunctions).toHaveLength(0);
    expect(result.generatedHookScript).toContain('Binary-to-JS hook script loaded');
  });

  it('should include module name in hook script', async () => {
    const result = buildBinaryToJSPipeline(bridge, {
      functions: [{ name: 'native_crypto', moduleName: 'libcustom.so' }],
      moduleName: 'libcustom.so',
    });

    expect(result.generatedHookScript).toContain('libcustom.so');
    expect(result.generatedHookScript).toContain('Interceptor.attach');
  });
});
