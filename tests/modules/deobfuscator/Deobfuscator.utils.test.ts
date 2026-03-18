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

    expect(detectObfuscationType(code)).toEqual([
      'javascript-obfuscator',
      'webpack',
      'vm-protection',
    ]);
  });

  it('falls back to unknown when no known signatures are present', () => {
    expect(detectObfuscationType('const answer = 42;\nconsole.log(answer);')).toEqual(['unknown']);
  });

  it('computes higher readability for multiline, descriptive, non-obfuscated code', () => {
    const readable = calculateReadabilityScore(
      'const longVariableName = 1;\nfunction computeValue() {\n  return longVariableName;\n}\n'
    );
    const unreadable = calculateReadabilityScore('var _0xabc=1;var _0xdef=2;');

    expect(readable).toBeGreaterThan(unreadable);
    expect(readable).toBeLessThanOrEqual(100);
  });
});
