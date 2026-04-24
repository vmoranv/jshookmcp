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

import { detectJITSpray, getJITSpraySummary } from '@modules/deobfuscator/JITSprayDetector';

describe('JITSprayDetector', () => {
  describe('detectJITSpray', () => {
    it('returns no detections for clean code', () => {
      const code = `function add(a, b) { return a + b; }`;
      const result = detectJITSpray(code);
      expect(result.detected).toBe(false);
      expect(result.detections).toHaveLength(0);
    });

    it('detects dynamic Function constructor', () => {
      const code = `var fn = new Function("a", "b", "return a + b");`;
      const result = detectJITSpray(code);
      expect(result.detected).toBe(true);
      const dyn = result.detections.find((d) => d.type === 'dynamic-constructor');
      expect(dyn).toBeTruthy();
    });

    it('detects eval with constructed string', () => {
      const code = `eval(String.fromCharCode(97, 98, 99));`;
      const result = detectJITSpray(code);
      expect(result.detected).toBe(true);
      const evalDet = result.detections.find((d) => d.type === 'eval-with-constructed-string');
      expect(evalDet).toBeTruthy();
    });

    it('detects setTimeout with string argument', () => {
      const code = `setTimeout("console.log('x')", 100);`;
      const result = detectJITSpray(code);
      expect(result.detected).toBe(true);
      const sett = result.detections.find((d) => d.type === 'settimeout-string');
      expect(sett).toBeTruthy();
    });

    it('detects inline machine code bytes', () => {
      const code = `var bytes = [0x90, 0x90, 0xCC, 0x90, 0x90, 0xCC, 0x90, 0x90];`;
      const result = detectJITSpray(code);
      expect(result.detected).toBe(true);
      const mc = result.detections.find((d) => d.type === 'machine-code-patterns');
      expect(mc).toBeTruthy();
      expect(mc?.confidence).toBe(0.9);
    });

    it('detects Proxy function usage', () => {
      const code = `var handler = { apply: function() {} }; var proxy = new Proxy(fn, handler);`;
      const result = detectJITSpray(code);
      const proxy = result.detections.find((d) => d.type === 'proxy-function');
      expect(proxy).toBeTruthy();
    });

    it('detects WebAssembly instantiate', () => {
      const code = `WebAssembly.instantiate(bytes, {});`;
      const result = detectJITSpray(code);
      expect(result.detected).toBe(true);
      const wasm = result.detections.find((d) => d.type === 'wasm-instantiate');
      expect(wasm).toBeTruthy();
    });

    it('returns warnings when detections found', () => {
      const code = `var fn = new Function("return 42");`;
      const result = detectJITSpray(code);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('includes location info in detections', () => {
      const code = `var fn = new Function("return 42");`;
      const result = detectJITSpray(code);
      const dyn = result.detections.find((d) => d.type === 'dynamic-constructor');
      expect(dyn?.locations).toBeDefined();
      expect(dyn?.locations.length).toBeGreaterThan(0);
      expect(dyn?.locations[0]?.line).toBe(1);
    });
  });

  describe('getJITSpraySummary', () => {
    it('returns low risk for clean code', () => {
      const code = `function test() { return 42; }`;
      const summary = getJITSpraySummary(code);
      expect(summary.risk).toBe('low');
    });

    it('returns high risk for high-confidence detections', () => {
      const code = `var bytes = [0x90, 0xCC, 0x90, 0xCC, 0x90, 0xCC, 0x90, 0xCC, 0x90, 0xCC];`;
      const summary = getJITSpraySummary(code);
      expect(summary.risk).toBe('high');
    });

    it('returns medium risk for moderate detections', () => {
      const code = `setTimeout("x = 1", 100);`;
      const summary = getJITSpraySummary(code);
      expect(['low', 'medium', 'high']).toContain(summary.risk);
    });

    it('returns details string', () => {
      const code = `eval("alert(1)");`;
      const summary = getJITSpraySummary(code);
      expect(summary.details).toBeTruthy();
      expect(typeof summary.details).toBe('string');
    });
  });
});
