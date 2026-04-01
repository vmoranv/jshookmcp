import { describe, expect, it, vi } from 'vitest';

vi.mock('@src/modules/deobfuscator/JSVMPDeobfuscator', () => {
  return {
    JSVMPDeobfuscator: class {
      detectJSVMP(code: string) {
        if (code.includes('vmhit')) {
          return {
            instructionCount: 64,
            interpreterLocation: 'line:10',
            complexity: 'high',
            hasSwitch: true,
            hasInstructionArray: true,
            hasProgramCounter: true,
          };
        }
        throw new Error('not-vm');
      }
    },
  };
});

import { ObfuscationDetector } from '@modules/detector/ObfuscationDetector';

describe('ObfuscationDetector', () => {
  it('returns unknown for clean code', () => {
    const detector = new ObfuscationDetector();
    const result = detector.detect('const answer = 42;');

    expect(result.types).toEqual(['unknown']);
    expect(result.confidence.unknown).toBe(0.5);
  });

  it('detects webpack obfuscation pattern', () => {
    const detector = new ObfuscationDetector();
    const result = detector.detect('function x(){ return __webpack_require__(1); }');
    expect(result.types).toContain('webpack');
  });

  it('detects JSFuck payload', () => {
    const detector = new ObfuscationDetector();
    const jsfuck = '[](!+[]+!![])[+!![]]';
    const result = detector.detect(jsfuck);
    expect(result.types).toContain('jsfuck');
  });

  it('uses direct VM detection result when available', () => {
    const detector = new ObfuscationDetector();
    const result = detector.detect('vmhit');

    expect(result.types).toContain('vm-protection');
    expect(result.vmFeatures?.instructionCount).toBe(64);
    expect(result.features.some((f) => f.includes('JSVMP'))).toBe(true);
  });

  it('falls back to heuristic VM detection when parser throws', () => {
    const detector = new ObfuscationDetector();
    const heuristicVmCode = `
      while (true) {
        switch (state) {
          case 0: state = vm[pc++]; break;
        }
      }
      var vm = [1,2,3,4,5,6,7,8,9,10,11,12];
    `;
    const result = detector.detect(heuristicVmCode);

    expect(result.types).toContain('vm-protection');
    expect(result.vmFeatures?.interpreterLocation).toBe('Unknown');
  });

  it('generateReport includes types, features and recommendations', () => {
    const detector = new ObfuscationDetector();
    const detected = detector.detect('eval(function(p,a,c,k,e,d){})');
    const report = detector.generateReport(detected);

    expect(report).toContain('Obfuscation Detection Report');
    expect(report).toContain('Detected Types');
    expect(report).toContain('Recommendations');
  });

  it('detects remaining signature families and recommends runtime hooks when needed', () => {
    const detector = new ObfuscationDetector();
    const runtimeCode = `
      eval("a");
      eval("b");
      eval("c");
      const factory = new Function("return 1");
      const hidden = "zero\u200Bwidth";
      const encoded = "%41%42%43%44%45%46%47%48%49%4A%4B";
      const packed = eval(function(p,a,c,k,e,d){return p;});
      const aa = "゚ω゚";
      const jj = "$={___:++$";
    `;

    const result = detector.detect(runtimeCode);

    expect(result.types).toEqual(
      expect.arrayContaining([
        'invisible-unicode',
        'eval-obfuscation',
        'self-modifying',
        'packer',
        'aaencode',
        'jjencode',
        'urlencoded',
      ]),
    );
    expect(result.toolRecommendations.some((item) => item.tool === 'manage_hooks')).toBe(true);
    expect(result.toolRecommendations.some((item) => item.tool === 'advanced_deobfuscate')).toBe(
      true,
    );
  });

  it('accumulates JScrambler heuristics from multiple indicators', () => {
    const detector = new ObfuscationDetector();
    const code = `
      while (!![]) {
        switch (state) {
          case 0:
            debugger;
            constructor;
            function demo(x) { return x.charCodeAt(0).fromCharCode(0); }
            Function.prototype.toString.call(demo);
            break;
        }
      }
    `;

    const result = detector.detect(code);

    expect(result.types).toContain('jscrambler');
    expect(result.features).toContain('Control flow flattening + Self-defending');
    expect(result.recommendations).toContain('Use JScrambler deobfuscator');
  });
});
