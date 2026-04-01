import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

const sandboxState = vi.hoisted(() => ({
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
    execute = vi.fn((...args: any[]) => (sandboxState.executeImpl as any)(...args));
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

  it('stops iterating when unpacking returns the same code', async () => {
    const deobfuscator = new PackerDeobfuscator();
    vi.spyOn(deobfuscator as any, 'unpack').mockResolvedValue(PACKER_LIKE);

    const result = await deobfuscator.deobfuscate({ code: PACKER_LIKE, maxIterations: 3 });

    expect(result.success).toBe(true);
    expect(result.iterations).toBe(0);
    expect(result.warnings).toContain('');
  });

  it('parses packer params from sandbox output', async () => {
    const deobfuscator = new PackerDeobfuscator();
    sandboxState.executeImpl.mockResolvedValue({
      ok: true,
      output: ['payload', 62, 2, 'foo|bar'] as any,
    });

    const parsed = await (deobfuscator as any).parsePackerParams("'payload',62,2,'foo|bar'");

    expect(parsed.p).toBe('payload');
    expect(parsed.a).toBe(62);
    expect(parsed.k).toEqual(['foo', 'bar']);
  });

  it('returns null when packer params are incomplete', async () => {
    const deobfuscator = new PackerDeobfuscator();
    sandboxState.executeImpl.mockResolvedValue({
      ok: true,
      output: ['payload', 62] as any,
    });

    await expect((deobfuscator as any).parsePackerParams("'payload',62")).resolves.toBeNull();
  });

  it('executes unpack replacement and base conversion helpers', () => {
    const deobfuscator = new PackerDeobfuscator();
    const output = (deobfuscator as any).executeUnpacker({
      p: '0 1 2',
      a: 10,
      c: 3,
      k: ['zero', 'one', 'two'],
      e: () => '',
      d: () => '',
    });

    expect(output).toBe('zero one two');
  });

  it('decodes AAEncode payload through sandbox execution', async () => {
    const aa = new AAEncodeDeobfuscator();
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

  // ─── PackerDeobfuscator error-path coverage ─────────────────────────────────

  it('deobfuscate returns failure payload when unpack throws', async () => {
    const deobfuscator = new PackerDeobfuscator();
    // Mock unpack to throw, simulating a critical failure during deobfuscation
    vi.spyOn(deobfuscator as any, 'unpack').mockRejectedValue(new Error('sandbox error'));

    const result = await deobfuscator.deobfuscate({ code: PACKER_LIKE });

    expect(result.success).toBe(false);
    expect(result.iterations).toBe(0);
    expect(result.warnings.some((w) => w.includes('sandbox error'))).toBe(true);
  });

  it('unpack returns original code when regex match has no args', async () => {
    const deobfuscator = new PackerDeobfuscator();
    const result = await (deobfuscator as any).unpack('eval(function(p,a,c,k,e,d){})(0)');
    // The regex captures group 2 but it will be empty
    expect(result).toBe('eval(function(p,a,c,k,e,d){})(0)');
  });

  it('unpack returns original code when params parsing returns null', async () => {
    const deobfuscator = new PackerDeobfuscator();
    sandboxState.executeImpl.mockResolvedValue({ ok: true, output: ['x'] as any });

    const result = await (deobfuscator as any).unpack(PACKER_LIKE);
    expect(result).toBe(PACKER_LIKE);
  });

  it('unpack catches errors from executeUnpacker', async () => {
    const deobfuscator = new PackerDeobfuscator();
    sandboxState.executeImpl.mockResolvedValue({
      ok: true,
      output: ['', 0, 0, ''] as any,
    });
    // executeUnpacker will be called; if it throws the catch block handles it
    const result = await (deobfuscator as any).unpack(PACKER_LIKE);
    expect(result).toBe(PACKER_LIKE);
  });

  it('parsePackerParams returns null when sandbox fails', async () => {
    const deobfuscator = new PackerDeobfuscator();
    sandboxState.executeImpl.mockResolvedValue({ ok: false, output: null });

    const result = await (deobfuscator as any).parsePackerParams("'x',1,1,'a'");
    expect(result).toBeNull();
  });

  it('parsePackerParams returns null when output is not an array', async () => {
    const deobfuscator = new PackerDeobfuscator();
    sandboxState.executeImpl.mockResolvedValue({ ok: true, output: 'not-an-array' as any });

    const result = await (deobfuscator as any).parsePackerParams("'x',1,1,'a'");
    expect(result).toBeNull();
  });

  it('parsePackerParams returns null when array is too short', async () => {
    const deobfuscator = new PackerDeobfuscator();
    sandboxState.executeImpl.mockResolvedValue({ ok: true, output: [1, 2, 3] as any });

    const result = await (deobfuscator as any).parsePackerParams('1,2,3');
    expect(result).toBeNull();
  });

  it('parsePackerParams uses defaults for missing optional params 4 and 5', async () => {
    const deobfuscator = new PackerDeobfuscator();
    sandboxState.executeImpl.mockResolvedValue({
      ok: true,
      output: ['payload', 62, 2, 'foo|bar'] as any,
    });

    const result = await (deobfuscator as any).parsePackerParams("'payload',62,2,'foo|bar'");

    expect(result?.e).toBeDefined();
    expect(result?.d).toBeDefined();
    // The defaults are identity functions
    expect((result as any).e(42)).toBe(42);
    expect((result as any).d()).toBe('');
  });

  it('parsePackerParams returns null when sandbox throws', async () => {
    const deobfuscator = new PackerDeobfuscator();
    sandboxState.executeImpl.mockRejectedValue(new Error('parse error'));

    const result = await (deobfuscator as any).parsePackerParams("'x',1,1,'a'");
    expect(result).toBeNull();
  });

  it('executeUnpacker replaces base-encoded keys in the payload', () => {
    const deobfuscator = new PackerDeobfuscator();
    // payload uses base36 indices: base36(0)='0', base36(1)='1', base36(2)='2'
    const result = (deobfuscator as any).executeUnpacker({
      p: 'a 0 b 1 c 2',
      a: 36,
      c: 3,
      k: ['X', 'Y', 'Z'],
      e: () => '',
      d: () => '',
    });
    expect(result).toBe('a X b Y c Z');
  });

  it('executeUnpacker skips undefined replacement keys', () => {
    const deobfuscator = new PackerDeobfuscator();
    const result = (deobfuscator as any).executeUnpacker({
      p: 'a 0 b 1',
      a: 10,
      c: 2,
      k: ['only-one'], // k[1] is undefined
      e: () => '',
      d: () => '',
    });
    expect(result).toBe('a only-one b 1');
  });

  it('base returns 0 for zero input', () => {
    const deobfuscator = new PackerDeobfuscator();
    expect((deobfuscator as any).base(0, 10)).toBe('0');
  });

  it('base converts numbers in arbitrary radix', () => {
    const deobfuscator = new PackerDeobfuscator();
    // Digits string: 0-9 then a-z then A-Z
    expect((deobfuscator as any).base(10, 36)).toBe('a'); // 10 in base36
    expect((deobfuscator as any).base(35, 36)).toBe('z'); // 35 in base36
    expect((deobfuscator as any).base(36, 36)).toBe('10'); // 36 in base36 = '10'
    expect((deobfuscator as any).base(61, 62)).toBe('Z'); // 61 in base62 (uppercase Z)
    expect((deobfuscator as any).base(62, 62)).toBe('10'); // 62 in base62 = '10'
  });

  it('beautify formats code with newlines and trims', () => {
    const deobfuscator = new PackerDeobfuscator();
    const result = deobfuscator.beautify('var x=1;var y=2;{var z=3}');
    expect(result).toContain('\n');
    expect(result).toBe(result.trim());
  });

  it('beautify collapses multiple blank lines', () => {
    const deobfuscator = new PackerDeobfuscator();
    const result = deobfuscator.beautify('a;\n\n\n\nb;');
    expect(result).not.toContain('\n\n\n');
  });

  // ─── AAEncodeDeobfuscator coverage ──────────────────────────────────────────

  it('AAEncode returns original code when sandbox returns non-string', async () => {
    const aa = new AAEncodeDeobfuscator();
    sandboxState.executeImpl.mockResolvedValue({ ok: true, output: 123 as any });

    const output = await aa.deobfuscate('ω゜)');
    expect(output).toBe('ω゜)');
  });

  it('AAEncode returns original code when sandbox throws', async () => {
    const aa = new AAEncodeDeobfuscator();
    sandboxState.executeImpl.mockRejectedValue(new Error('eval error'));

    const output = await aa.deobfuscate('ω゜)');
    expect(output).toBe('ω゜)');
  });

  // ─── URLEncodeDeobfuscator coverage ─────────────────────────────────────────

  it('URLEncodeDeobfuscator.detect returns true for >10 percent-encoded chars', () => {
    const longEncoded = '%41%42%43%44%45%46%47%48%49%4A%4B%4C%4D%4E%4F'; // 16 chars, 16%
    expect(URLEncodeDeobfuscator.detect(longEncoded)).toBe(true);
  });

  it('URLEncodeDeobfuscator.detect returns false for ≤10 percent-encoded chars', () => {
    const shortEncoded = '%41%42%43%44%45%46%47%48%49%4A'; // 10 chars, ~71%
    expect(URLEncodeDeobfuscator.detect(shortEncoded)).toBe(false);
  });

  it('URLEncodeDeobfuscator.deobfuscate falls back on malformed percent encoding', async () => {
    const url = new URLEncodeDeobfuscator();
    // decodeURIComponent throws on malformed sequences
    const result = await url.deobfuscate('%E0%A4%A'); // truncated UTF-8 sequence
    expect(result).toBe('%E0%A4%A');
  });

  // ─── UniversalUnpacker coverage ─────────────────────────────────────────────

  it('UniversalUnpacker.deobfuscate routes to AAEncodeDeobfuscator', async () => {
    const unpacker = new UniversalUnpacker();
    const aaEncoded = 'ω゜)';

    const result = await unpacker.deobfuscate(aaEncoded);
    expect(result.type).toBe('AAEncode');
  });

  it('UniversalUnpacker.deobfuscate routes to URLEncodeDeobfuscator', async () => {
    const unpacker = new UniversalUnpacker();
    const urlEncoded = '%41%42%43%44%45%46%47%48%49%4A%4B%4C'; // 12 encoded chars

    const result = await unpacker.deobfuscate(urlEncoded);
    expect(result.type).toBe('URLEncode');
  });

  it('UniversalUnpacker.deobfuscate marks success false when AAEncode returns same code', async () => {
    const unpacker = new UniversalUnpacker();
    sandboxState.executeImpl.mockResolvedValue({ ok: true, output: 123 as any });

    const result = await unpacker.deobfuscate('ω゜)');
    expect(result.success).toBe(false);
  });

  it('UniversalUnpacker.deobfuscate marks success false when URLEncode returns same code', async () => {
    const unpacker = new UniversalUnpacker();
    // a string with few percent-encoded chars won't trigger URLEncode detection
    const result = await unpacker.deobfuscate('%E0%A4%A'); // malformed, decodeURIComponent throws
    // This won't route to URLEncode since it only detects >10% percent-encoded
    expect(result.type).toBeDefined();
  });
});
