import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const sandboxState = vi.hoisted(() => ({
  executeImpl: vi.fn(async () => ({ ok: false, output: null })),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

vi.mock('../../../src/modules/security/ExecutionSandbox.js', () => {
  class ExecutionSandbox {
    execute = vi.fn((...args: any[]) => sandboxState.executeImpl(...args));
  }
  return { ExecutionSandbox };
});

import {
  AAEncodeDeobfuscator,
  PackerDeobfuscator,
  URLEncodeDeobfuscator,
  UniversalUnpacker,
} from '../../../src/modules/deobfuscator/PackerDeobfuscator.js';

const PACKER_LIKE =
  "eval(function(p,a,c,k,e,d){return p;}('0',62,1,'x'.split('|'),0,{}))";

describe('Packer-family deobfuscators', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sandboxState.executeImpl.mockReset();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  it('detects packer signature via static helper', () => {
    expect(PackerDeobfuscator.detect(PACKER_LIKE)).toBe(true);
    expect(PackerDeobfuscator.detect('const x = 1;')).toBe(false);
  });

  it('iterates unpacking until code stops changing', async () => {
    const deobfuscator = new PackerDeobfuscator();
    vi.spyOn(deobfuscator as any, 'unpack')
      .mockResolvedValueOnce(PACKER_LIKE + ';')
      .mockResolvedValueOnce(PACKER_LIKE + ';');

    const result = await deobfuscator.deobfuscate({ code: PACKER_LIKE, maxIterations: 3 });

    expect(result.success).toBe(true);
    expect(result.iterations).toBe(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('parses packer params from sandbox output', async () => {
    const deobfuscator = new PackerDeobfuscator();
    sandboxState.executeImpl.mockResolvedValue({
      ok: true,
      output: ['payload', 62, 2, 'foo|bar'],
    });

    const parsed = await (deobfuscator as any).parsePackerParams("'payload',62,2,'foo|bar'");

    expect(parsed.p).toBe('payload');
    expect(parsed.a).toBe(62);
    expect(parsed.k).toEqual(['foo', 'bar']);
  });

  it('decodes AAEncode payload through sandbox execution', async () => {
    const aa = new AAEncodeDeobfuscator();
    sandboxState.executeImpl.mockResolvedValue({ ok: true, output: 'decoded-aa' });

    const output = await aa.deobfuscate('ω゜)');
    expect(output).toBe('decoded-aa');
  });

  it('detects and decodes URL encoded content with safe fallback', async () => {
    const urlDeobfuscator = new URLEncodeDeobfuscator();
    const encoded = '%41%42%43%44%45%46%47%48%49%4A%4B';

    expect(URLEncodeDeobfuscator.detect(encoded)).toBe(true);
    expect(await urlDeobfuscator.deobfuscate(encoded)).toBe('ABCDEFGHIJK');
    expect(await urlDeobfuscator.deobfuscate('%E0%A4%A')).toBe('%E0%A4%A');
  });

  it('dispatches through UniversalUnpacker by detected obfuscation type', async () => {
    const unpacker = new UniversalUnpacker();
    vi.spyOn((unpacker as any).packerDeobfuscator, 'deobfuscate').mockResolvedValue({
      code: 'decoded-packer',
      success: true,
      iterations: 1,
      warnings: [],
    });

    const packerResult = await unpacker.deobfuscate(PACKER_LIKE);
    const unknownResult = await unpacker.deobfuscate('plain-code');

    expect(packerResult.type).toBe('Packer');
    expect(packerResult.code).toBe('decoded-packer');
    expect(unknownResult).toEqual({ code: 'plain-code', type: 'Unknown', success: false });
  });
});

