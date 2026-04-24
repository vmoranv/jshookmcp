import { describe, it, expect, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));

import { harvestWASM } from '@modules/deobfuscator/WASMHarvester';

describe('WASMHarvester', () => {
  it('harvestWASM returns result with boundaries array', () => {
    const result = harvestWASM('const x = 1;');
    expect(result).toHaveProperty('boundaries');
    expect(Array.isArray(result.boundaries)).toBe(true);
  });

  it('harvestWASM detects WebAssembly.instantiate calls', () => {
    const code = 'WebAssembly.instantiate(buffer, imports);';
    const result = harvestWASM(code);
    const instantiate = result.boundaries.find((b) => b.type === 'instantiate');
    expect(instantiate).toBeDefined();
    expect(instantiate?.confidence).toBeGreaterThan(0);
  });

  it('harvestWASM detects WebAssembly.compile calls', () => {
    const code = 'WebAssembly.compile(buffer);';
    const result = harvestWASM(code);
    const compile = result.boundaries.find((b) => b.type === 'compile');
    expect(compile).toBeDefined();
  });

  it('harvestWASM detects WASM binary (magic bytes)', () => {
    const code = 'new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);';
    const result = harvestWASM(code);
    const inline = result.boundaries.find((b) => b.type === 'inline-bytes');
    expect(inline).toBeDefined();
  });

  it('harvestWASM extracts JS-WASM interface', () => {
    const code = `
      const result = WebAssembly.instantiate(bytes, {
        env: { log: console.log }
      });
      result.instance.exports.main();
    `;
    const result = harvestWASM(code);
    expect(result).toHaveProperty('interfaces');
    expect(Array.isArray(result.interfaces)).toBe(true);
  });

  it('harvestWASM with clean JS code returns no boundaries', () => {
    const result = harvestWASM('const x = 42; console.log(x);');
    expect(result.boundaries.length).toBe(0);
    expect(result.moduleCount).toBe(0);
  });

  it('harvestWASM returns module headers when WASM detected', () => {
    const code = 'new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);';
    const result = harvestWASM(code);
    expect(result).toHaveProperty('headers');
    expect(Array.isArray(result.headers)).toBe(true);
    if (result.headers.length > 0) {
      expect(result.headers[0]).toHaveProperty('hasValidMagic');
      expect(result.headers[0]).toHaveProperty('version');
      expect(result.headers[0]).toHaveProperty('totalSize');
    }
  });

  it('harvestWASM returns extraction result with strings array', () => {
    const result = harvestWASM('WebAssembly.instantiate(buf);');
    expect(result).toHaveProperty('decodedStrings');
    expect(Array.isArray(result.decodedStrings)).toBe(true);
  });

  it('harvestWASM handles options (extractStrings, traceInterface)', () => {
    const code = 'WebAssembly.instantiate(bytes, { env: { log: () => {} } });';
    const result = harvestWASM(code, { extractStrings: false, traceInterfaces: false });
    expect(result.interfaces.length).toBe(0);

    const resultWithOpts = harvestWASM(code, { extractStrings: true, traceInterfaces: true });
    expect(resultWithOpts).toHaveProperty('interfaces');
  });
});
