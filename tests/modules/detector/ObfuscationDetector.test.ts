import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modules/deobfuscator/JSVMPDeobfuscator.js', () => {
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

import { ObfuscationDetector } from '../../../src/modules/detector/ObfuscationDetector.js';

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
});

