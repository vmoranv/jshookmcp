import { describe, expect, it, vi } from 'vitest';

vi.mock('@modules/deobfuscator/JSVMPDeobfuscator', () => ({
  JSVMPDeobfuscator: class {
    detectJSVMP() {
      return null;
    }
  },
}));

vi.mock('@utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
}));

import { ObfuscationDetector } from '@modules/detector/ObfuscationDetector';

describe('ObfuscationDetector extra coverage', () => {
  it('detects the remaining static heuristic families in one pass', () => {
    const detector = new ObfuscationDetector();
    const hexPayload = '\\x41'.repeat(24);
    const minifiedLetters = Array.from(
      { length: 60 },
      (_, i) => `var ${String.fromCharCode(97 + (i % 26))}=${i};`,
    ).join('\n');
    const code = `
      var _0x12ab = ['alpha', 'beta'];
      (function(_0x12ab, _0x77ff) { return _0x12ab[_0x77ff]; })(_0x12ab, 0);
      var bag = ['a', 'b'];
      (function(arr, seed) { return arr[seed]; })(bag, 0);
      bag = bag + 0x1;
      if (false) { console.log('dead'); }
      if (1 === 1) { console.log('opaque'); }
      atob('QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=');
      const bytes = '${hexPayload}';
      ${minifiedLetters}
    `;

    const result = detector.detect(code);

    expect(result.types).toEqual(
      expect.arrayContaining([
        'javascript-obfuscator',
        'uglify',
        'string-array-rotation',
        'dead-code-injection',
        'opaque-predicates',
        'base64-encoding',
        'hex-encoding',
      ]),
    );
    expect(result.toolRecommendations.map((item) => item.tool)).toEqual(
      expect.arrayContaining(['deobfuscate', 'advanced_deobfuscate']),
    );
  });

  it('prefers bundle unpacking recommendations without duplicates', () => {
    const detector = new ObfuscationDetector();
    const code = `
      function load(id) {
        return __webpack_require__(id);
      }
      eval(function(p,a,c,k,e,d){return p;});
    `;

    const result = detector.detect(code);

    expect(result.types).toEqual(expect.arrayContaining(['webpack', 'packer']));
    expect(result.toolRecommendations).toEqual([
      expect.objectContaining({
        tool: 'webcrack_unpack',
        suggestedArgs: expect.objectContaining({
          code,
          unpack: true,
          unminify: true,
        }),
      }),
    ]);
  });

  it('keeps unknown detection on the fallback path and surfaces default tooling', () => {
    const detector = new ObfuscationDetector();
    const result = detector.detect('const answer = 42; function square(x){ return x * x; }');
    const report = detector.generateReport(result);

    expect(result.types).toEqual(['unknown']);
    expect(result.toolRecommendations).toEqual([
      expect.objectContaining({
        tool: 'deobfuscate',
        suggestedArgs: expect.objectContaining({
          code: 'const answer = 42; function square(x){ return x * x; }',
        }),
      }),
    ]);
    expect(report).toContain('Suggested Tools');
    expect(report).toContain('deobfuscate: Static cleanup is likely sufficient');
  });
});
