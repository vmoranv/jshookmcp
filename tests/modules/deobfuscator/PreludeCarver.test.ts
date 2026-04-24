import { describe, it, expect, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));

import { detectPrelude, carvePrelude } from '@modules/deobfuscator/PreludeCarver';

describe('PreludeCarver', () => {
  it('detectPrelude returns empty array for clean code', () => {
    const result = detectPrelude('const x = 42; console.log(x);');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('detectPrelude detects string decoder patterns', () => {
    const code = `var _0x1a2b=["hello","world"];function _0x3c4d(i){return _0x1a2b[i];}`;
    const result = detectPrelude(code);
    expect(result.length).toBeGreaterThan(0);
    const decoder = result.find((p) => p.category === 'decoder' || p.category === 'string-table');
    expect(decoder).toBeDefined();
  });

  it('detectPrelude detects wrapper patterns', () => {
    const code = `function wrapper(){return _0x1a2b(0);}var _0x1a2b=function(i){return arr[i];}`;
    const result = detectPrelude(code);
    const wrapper = result.find((p) => p.category === 'wrapper');
    expect(wrapper).toBeDefined();
  });

  it('detectPrelude detects integrity/anti-debug patterns', () => {
    // debugger statement matches integrity patterns first
    const code = `function guard(){setInterval(function(){debugger;},100);}`;
    const result = detectPrelude(code);
    const integrityOrAntiDebug = result.find(
      (p) => p.category === 'integrity' || p.category === 'anti-debug',
    );
    expect(integrityOrAntiDebug).toBeDefined();
  });

  it('carvePrelude with empty prelude functions returns original code', () => {
    const code = 'const x = 1;';
    const result = carvePrelude(code, []);
    expect(result.code).toBe(code);
    expect(result.replaced).toBe(0);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('carvePrelude with detected prelude functions separates prelude from payload', () => {
    const code = `var _0x1a2b=["hello","world"];
function _0x3c4d(i){return _0x1a2b[i];}
console.log("payload");`;
    const prelude = detectPrelude(code);
    const result = carvePrelude(code, prelude);
    expect(result).toHaveProperty('preludeCode');
    expect(result).toHaveProperty('payloadCode');
    expect(result).toHaveProperty('replaced');
    expect(result).toHaveProperty('success');
  });

  it('carvePrelude returns replaced count', () => {
    const result = carvePrelude('const x = 1;', []);
    expect(typeof result.replaced).toBe('number');
    expect(result.replaced).toBe(0);
  });

  it('carvePrelude returns warnings array even when empty', () => {
    const result = carvePrelude('const x = 1;', []);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.success).toBe(false);
  });
});
