import { describe, it, expect, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import {
  analyzeWASMMixedScheme,
  getWASMMixedSchemeSummary,
  detectWASMBytecodePayloads,
  extractWASMMetadata,
} from '@modules/deobfuscator/WASMMixedSchemeAnalyzer';

describe('WASMMixedSchemeAnalyzer', () => {
  describe('analyzeWASMMixedScheme', () => {
    it('returns no detections for clean code', () => {
      const code = `function add(a, b) { return a + b; }`;
      const result = analyzeWASMMixedScheme(code);
      expect(result.detected).toBe(false);
      expect(result.detections).toHaveLength(0);
    });

    it('detects WebAssembly binary loading', () => {
      const code = `WebAssembly.instantiate(bytes, importObj);`;
      const result = analyzeWASMMixedScheme(code);
      expect(result.detected).toBe(true);
      const wasm = result.detections.find((d) => d.type === 'wasm-binary-loading');
      expect(wasm).toBeTruthy();
      expect(wasm?.confidence).toBe(0.95);
    });

    it('detects WebAssembly compile', () => {
      const code = `WebAssembly.compile(bytecode);`;
      const result = analyzeWASMMixedScheme(code);
      expect(result.detected).toBe(true);
    });

    it('detects JS-WASM interop patterns', () => {
      const code = `var data = new Uint8Array(memory.buffer);`;
      const result = analyzeWASMMixedScheme(code);
      const interop = result.detections.find((d) => d.type === 'js-wasm-interop');
      expect(interop).toBeTruthy();
    });

    it('detects WASM bytecode embedding as byte array', () => {
      const code = `var bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];`;
      const result = analyzeWASMMixedScheme(code);
      const bytecode = result.detections.find((d) => d.type === 'wasm-bytecode-embedding');
      expect(bytecode).toBeTruthy();
    });

    it('detects mixed WASM and JS execution', () => {
      const code = `setTimeout(instance.run, 100);`;
      const result = analyzeWASMMixedScheme(code);
      const mixed = result.detections.find((d) => d.type === 'wasm-js-mixed-execution');
      expect(mixed).toBeTruthy();
    });

    it('returns warnings when detections found', () => {
      const code = `WebAssembly.instantiate(bytes);`;
      const result = analyzeWASMMixedScheme(code);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('includes location info in detections', () => {
      const code = `var wasm = WebAssembly.instantiate(bytes);`;
      const result = analyzeWASMMixedScheme(code);
      const wasm = result.detections.find((d) => d.type === 'wasm-binary-loading');
      expect(wasm?.locations).toBeDefined();
      expect(wasm?.locations.length).toBeGreaterThan(0);
    });

    it('detects multiple WASM scheme types in complex code', () => {
      const code = `WebAssembly.instantiate(bytes); var data = new Uint8Array(memory.buffer);`;
      const result = analyzeWASMMixedScheme(code);
      expect(result.detections.length).toBeGreaterThan(1);
    });
  });

  describe('getWASMMixedSchemeSummary', () => {
    it('returns low threat for clean code', () => {
      const code = `function test() { return 42; }`;
      const summary = getWASMMixedSchemeSummary(code);
      expect(summary.threat).toBe('low');
    });

    it('returns high threat for multiple high-confidence detections', () => {
      const code = `WebAssembly.instantiate(bytes); new Function("instance", "run");`;
      const summary = getWASMMixedSchemeSummary(code);
      expect(['medium', 'high']).toContain(summary.threat);
    });

    it('returns medium threat for moderate detections', () => {
      const code = `var data = new Uint8Array(memory.buffer);`;
      const summary = getWASMMixedSchemeSummary(code);
      expect(['low', 'medium', 'high']).toContain(summary.threat);
    });

    it('returns details string', () => {
      const code = `WebAssembly.compile(bytecode);`;
      const summary = getWASMMixedSchemeSummary(code);
      expect(summary.details).toBeTruthy();
      expect(typeof summary.details).toBe('string');
    });
  });

  describe('detectWASMBytecodePayloads', () => {
    it('detects base64 encoded WASM payload', () => {
      const code = `var wasm = atob("AGFzbQEAAAADAGgWYAYAAA==");`;
      const payloads = detectWASMBytecodePayloads(code);
      expect(payloads.length).toBeGreaterThan(0);
      expect(payloads[0]?.type).toBe('base64');
    });

    it('detects hex encoded WASM payload', () => {
      const code = `var bytes = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];`;
      const payloads = detectWASMBytecodePayloads(code);
      expect(payloads.length).toBeGreaterThan(0);
    });

    it('returns empty for clean code', () => {
      const code = `function test() { return 42; }`;
      const payloads = detectWASMBytecodePayloads(code);
      expect(payloads).toHaveLength(0);
    });
  });

  describe('extractWASMMetadata', () => {
    it('extracts valid WASM magic and version', () => {
      const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
      const metadata = extractWASMMetadata(wasmBytes);
      expect(metadata.hasMagic).toBe(true);
      expect(metadata.rawSize).toBe(8);
    });

    it('returns false hasMagic for non-WASM bytes', () => {
      const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
      const metadata = extractWASMMetadata(bytes);
      expect(metadata.hasMagic).toBe(false);
    });

    it('returns zeros for short byte arrays', () => {
      const bytes = new Uint8Array([0x00, 0x01]);
      const metadata = extractWASMMetadata(bytes);
      expect(metadata.hasMagic).toBe(false);
      expect(metadata.rawSize).toBe(2);
    });
  });
});
