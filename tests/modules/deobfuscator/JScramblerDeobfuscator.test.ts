import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: loggerState,
}));

import { JScramberDeobfuscator } from '../../../src/modules/deobfuscator/JScramblerDeobfuscator.js';

describe('JScramberDeobfuscator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  it('removes self-defending debugger statements', async () => {
    const code = `
      function guard(){ debugger; return 1; }
      setInterval(function(){ debugger; }, 1000);
      guard();
    `;
    const result = await new JScramberDeobfuscator().deobfuscate({ code });

    expect(result.success).toBe(true);
    expect(result.code).not.toContain('debugger');
    expect(result.transformations.length).toBeGreaterThan(0);
  });

  it('replaces decrypt-function calls with placeholder strings', async () => {
    const code = `
      function dec(s){ return s.split('').map(c=>String.fromCharCode(c.charCodeAt(0))).join(''); }
      const value = dec("abc");
    `;
    const result = await new JScramberDeobfuscator().deobfuscate({ code, decryptStrings: true });

    expect(result.code).toContain('[DECRYPTED_STRING]');
  });

  it('restores flattened control-flow while-switch pattern', async () => {
    const code = `
      while (true) {
        switch (state) {
          case 0: a(); break;
          case 1: b(); break;
        }
      }
    `;
    const result = await new JScramberDeobfuscator().deobfuscate({ code, restoreControlFlow: true });

    expect(result.success).toBe(true);
    expect(result.code).toContain('a();');
    expect(result.code).toContain('b();');
  });

  it('removes dead branches and simplifies arithmetic expressions', async () => {
    const code = `
      if (false) { drop(); } else { keep(); }
      const n = 2 + 3;
    `;
    const result = await new JScramberDeobfuscator().deobfuscate({ code });

    expect(result.code).toContain('keep();');
    expect(result.code).toContain('const n = 5');
  });

  it('calculates confidence from transformation count', () => {
    const deobfuscator = new JScramberDeobfuscator() as any;
    expect(deobfuscator.calculateConfidence(0)).toBe(0);
    expect(deobfuscator.calculateConfidence(3)).toBeCloseTo(0.6);
    expect(deobfuscator.calculateConfidence(9)).toBe(1);
  });

  it('returns failure payload when parse pipeline throws', async () => {
    const result = await new JScramberDeobfuscator().deobfuscate({
      code: 'function broken( {',
    });

    expect(result.success).toBe(false);
    expect(result.confidence).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

