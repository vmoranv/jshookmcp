import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  calculateReadabilityScore,
  detectObfuscationType,
} from '@modules/deobfuscator/Deobfuscator.utils';

describe('Deobfuscator utils', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects multiple obfuscation signatures from a single source snippet', () => {
    const code = 'var _0xabc=["a"]; __webpack_require__(1); eval("x"); Function("return 1");';

    const types = detectObfuscationType(code);
    expect(types).toContain('javascript-obfuscator');
    expect(types).toContain('webpack');
    expect(types).toContain('vm-protection');
    expect(types.length).toBeGreaterThanOrEqual(3);
  });

  it('falls back to unknown when no known signatures are present', () => {
    expect(detectObfuscationType('const answer = 42;\nconsole.log(answer);')).toEqual(['unknown']);
  });

  it('detects uglify-style one-line bundles', () => {
    const code = 'var a=1;'.repeat(160);
    expect(detectObfuscationType(code)).toContain('uglify');
  });

  it('computes higher readability for multiline, descriptive, non-obfuscated code', () => {
    const readable = calculateReadabilityScore(
      'const longVariableName = 1;\nfunction computeValue() {\n  return longVariableName;\n}\n',
    );
    const unreadable = calculateReadabilityScore('var _0xabc=1;var _0xdef=2;');

    expect(readable).toBeGreaterThan(unreadable);
    expect(readable).toBeLessThanOrEqual(100);
  });

  it('detects jsdecode obfuscation', () => {
    const code = '\x01\x02_(0x1234)=["a","b"]';
    expect(detectObfuscationType(code)).toContain('jsdecode');
  });

  it('detects hidden properties obfuscation', () => {
    const code = 'Object.defineProperty(obj,"key",{hidden:true,value:123});';
    expect(detectObfuscationType(code)).toContain('hidden-properties');
  });

  it('detects encoded calls obfuscation', () => {
    const code = 'obj["push"](1);arr["pop"](); obj["shift"]();';
    expect(detectObfuscationType(code)).toContain('encoded-calls');
  });

  it('detects proxy obfuscation', () => {
    const code = 'Proxy(new Function("return 1"),{})';
    expect(detectObfuscationType(code)).toContain('proxy-obfuscation');
  });

  it('detects with statement obfuscation', () => {
    const code = 'with({a:1,b:2}){console.log(a);}';
    expect(detectObfuscationType(code)).toContain('with-obfuscation');
  });
});
