import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const sandboxState = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  executeImpl: vi.fn<(...args: any[]) => Promise<{ ok: boolean; output: any }>>(async () => ({
    ok: false,
    output: null,
  })),
}));

vi.mock('@src/utils/logger', () => ({
  logger: loggerState,
}));

vi.mock('@src/modules/security/ExecutionSandbox', () => {
  class ExecutionSandbox {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    execute = vi.fn((...args: any[]) => (sandboxState.executeImpl as unknown)(...args));
  }
  return { ExecutionSandbox };
});

import {
  AAEncodeDeobfuscator,
  PackerDeobfuscator,
  URLEncodeDeobfuscator,
  UniversalUnpacker,
} from '@modules/deobfuscator/PackerDeobfuscator';

const PACKER_LIKE = "eval(function(p,a,c,k,e,d){return p;}('0',62,1,'x'.split('|'),0,{}))";

describe('Packer-family deobfuscators', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sandboxState.executeImpl.mockReset();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  it('detects packer signature via static helper', () => {
    expect(PackerDeobfuscator.detect(PACKER_LIKE)).toBe(true);
    expect(PackerDeobfuscator.detect('const x = 1;')).toBe(false);
  });

  it('iterates unpacking until code stops changing', async () => {
    const deobfuscator = new PackerDeobfuscator();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      output: ['payload', 62, 2, 'foo|bar'] as any,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const parsed = await (deobfuscator as any).parsePackerParams("'payload',62,2,'foo|bar'");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.p).toBe('payload');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.a).toBe(62);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    expect(parsed.k).toEqual(['foo', 'bar']);
  });

  it('decodes AAEncode payload through sandbox execution', async () => {
    const aa = new AAEncodeDeobfuscator();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    sandboxState.executeImpl.mockResolvedValue({ ok: true, output: 'decoded-aa' as any });

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    vi.spyOn((unpacker as unknown).packerDeobfuscator, 'deobfuscate').mockResolvedValue({
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
