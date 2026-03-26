import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as parser from '@babel/parser';

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import {
  derotateStringArray,
  removeDeadCode,
  removeOpaquePredicates,
  decodeStrings,
  applyASTOptimizations,
  estimateCodeComplexity,
} from '@modules/deobfuscator/AdvancedDeobfuscator.ast';

describe('AdvancedDeobfuscator AST – additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── derotateStringArray ──────────────────────────────────────────

  describe('derotateStringArray', () => {
    it('returns original code when no rotation IIFE is present', () => {
      const code = 'const x = 1; console.log(x);';
      const result = derotateStringArray(code);
      expect(result).toBe(code);
    });

    it('removes rotation IIFE with while loop containing push/shift', () => {
      const code = `
        (function(){ while(true){ arr.push(arr.shift()); break; } })();
        var kept = "hello";
      `;
      const result = derotateStringArray(code);
      expect(result).not.toContain('push');
      expect(result).not.toContain('shift');
      expect(result).toContain('kept');
    });

    it('handles multiple rotation IIFEs', () => {
      const code = `
        (function(){ while(true){ a.push(a.shift()); break; } })();
        (function(){ while(true){ b.push(b.shift()); break; } })();
        var safe = 1;
      `;
      const result = derotateStringArray(code);
      expect(result).toContain('safe');
      expect(result).not.toContain('a.push');
      expect(result).not.toContain('b.push');
    });

    it('ignores arrow function expressions as callee', () => {
      // Arrow function IIFEs should be checked — the code checks for
      // isFunctionExpression specifically in the second guard
      const code = `
        (() => { while(true){ arr.push(arr.shift()); break; } })();
        var keep = 1;
      `;
      const result = derotateStringArray(code);
      // Arrow functions pass the first guard but fail the second (isFunctionExpression check)
      expect(result).toContain('keep');
    });

    it('ignores IIFE without while loop', () => {
      const code = `
        (function(){ arr.push(arr.shift()); })();
        var keep = 1;
      `;
      const result = derotateStringArray(code);
      expect(result).toContain('push');
      expect(result).toContain('keep');
    });

    it('ignores IIFE with while loop but no push/shift', () => {
      const code = `
        (function(){ while(true){ console.log("loop"); break; } })();
        var keep = 1;
      `;
      const result = derotateStringArray(code);
      expect(result).toContain('console.log');
      expect(result).toContain('keep');
    });

    it('returns original code on parse error', () => {
      const parseSpy = vi.spyOn(parser, 'parse').mockImplementation(() => {
        throw new Error('syntax error');
      });

      const code = 'const x = 1;';
      const result = derotateStringArray(code);
      expect(result).toBe(code);
      expect(loggerState.error).toHaveBeenCalled();
      parseSpy.mockRestore();
    });
  });

  // ─── removeDeadCode ───────────────────────────────────────────────

  describe('removeDeadCode', () => {
    it('removes if(false) block without alternate', () => {
      const code = `if (false) { dead(); }`;
      const result = removeDeadCode(code);
      expect(result).not.toContain('dead()');
    });

    it('replaces if(false) with alternate when present', () => {
      const code = `if (false) { dead(); } else { alive(); }`;
      const result = removeDeadCode(code);
      expect(result).toContain('alive()');
      expect(result).not.toContain('dead()');
    });

    it('replaces if(true) with consequent', () => {
      const code = `if (true) { kept(); }`;
      const result = removeDeadCode(code);
      expect(result).toContain('kept()');
    });

    it('removes !![] opaque truthy pattern', () => {
      const code = `if (!![]) { truthy(); }`;
      const result = removeDeadCode(code);
      expect(result).toContain('truthy()');
    });

    it('removes statements after return', () => {
      const code = `
        function f() {
          return 1;
          console.log("unreachable");
          foo();
        }
      `;
      const result = removeDeadCode(code);
      expect(result).toContain('return 1');
      expect(result).not.toContain('unreachable');
      expect(result).not.toContain('foo()');
    });

    it('removes statements after throw', () => {
      const code = `
        function f() {
          throw new Error("boom");
          console.log("unreachable");
        }
      `;
      const result = removeDeadCode(code);
      expect(result).toContain('throw');
      expect(result).not.toContain('unreachable');
    });

    it('returns original code when nothing is dead', () => {
      const code = `var x = 1; var y = 2;`;
      const result = removeDeadCode(code);
      expect(result).toBe(code);
    });

    it('returns original code on parse error', () => {
      const parseSpy = vi.spyOn(parser, 'parse').mockImplementation(() => {
        throw new Error('parse error');
      });

      const code = 'var x = 1;';
      const result = removeDeadCode(code);
      expect(result).toBe(code);
      expect(loggerState.error).toHaveBeenCalled();
      parseSpy.mockRestore();
    });

    it('handles nested dead code blocks', () => {
      const code = `
        function outer() {
          if (false) { innerDead(); }
          if (true) {
            if (false) { nestedDead(); } else { nestedKept(); }
          }
        }
      `;
      const result = removeDeadCode(code);
      expect(result).not.toContain('innerDead');
      expect(result).not.toContain('nestedDead');
      expect(result).toContain('nestedKept');
    });
  });

  // ─── removeOpaquePredicates ───────────────────────────────────────

  describe('removeOpaquePredicates', () => {
    it('resolves > comparison with numeric literals (true case)', () => {
      const code = `if (5 > 3) { kept(); } else { removed(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).toContain('kept()');
      expect(result).not.toContain('removed()');
    });

    it('resolves > comparison with numeric literals (false case)', () => {
      const code = `if (1 > 10) { removed(); } else { kept(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).toContain('kept()');
      expect(result).not.toContain('removed()');
    });

    it('resolves < comparison', () => {
      const code = `if (2 < 8) { kept(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).toContain('kept()');
    });

    it('resolves >= comparison', () => {
      const code = `if (5 >= 5) { kept(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).toContain('kept()');
    });

    it('resolves <= comparison', () => {
      const code = `if (3 <= 5) { kept(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).toContain('kept()');
    });

    it('resolves === comparison (true)', () => {
      const code = `if (7 === 7) { kept(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).toContain('kept()');
    });

    it('resolves === comparison (false) without alternate', () => {
      const code = `if (7 === 8) { removed(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).not.toContain('removed()');
    });

    it('resolves == comparison', () => {
      const code = `if (3 == 3) { kept(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).toContain('kept()');
    });

    it('resolves !== comparison', () => {
      const code = `if (1 !== 2) { kept(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).toContain('kept()');
    });

    it('resolves != comparison', () => {
      const code = `if (1 != 2) { kept(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).toContain('kept()');
    });

    it('resolves false numeric comparison without alternate – removes node', () => {
      const code = `if (10 < 5) { removed(); }\nvar kept = 1;`;
      const result = removeOpaquePredicates(code);
      expect(result).not.toContain('removed()');
      expect(result).toContain('kept');
    });

    it('resolves 0 * x === 0 opaque predicate', () => {
      const code = `if ((0 * value) === 0) { always(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).toContain('always()');
    });

    it('resolves x * 0 === 0 opaque predicate (right operand is 0)', () => {
      const code = `if ((value * 0) === 0) { always(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).toContain('always()');
    });

    it('resolves 0 * x == 0 opaque predicate with ==', () => {
      const code = `if ((0 * value) == 0) { always(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).toContain('always()');
    });

    it('returns original code when no opaque predicates found', () => {
      const code = `if (x > y) { dynamic(); }`;
      const result = removeOpaquePredicates(code);
      expect(result).toBe(code);
    });

    it('returns original code on parse error', () => {
      const parseSpy = vi.spyOn(parser, 'parse').mockImplementation(() => {
        throw new Error('parse error');
      });

      const code = 'var x = 1;';
      const result = removeOpaquePredicates(code);
      expect(result).toBe(code);
      expect(loggerState.error).toHaveBeenCalled();
      parseSpy.mockRestore();
    });
  });

  // ─── decodeStrings ────────────────────────────────────────────────

  describe('decodeStrings', () => {
    it('decodes String.fromCharCode with numeric literals', () => {
      const code = `var x = String.fromCharCode(72, 101, 108, 108, 111);`;
      const result = decodeStrings(code);
      expect(result).toContain('"Hello"');
      expect(result).not.toContain('fromCharCode');
    });

    it('decodes single char code', () => {
      const code = `var x = String.fromCharCode(65);`;
      const result = decodeStrings(code);
      expect(result).toContain('"A"');
    });

    it('does not decode when args include non-numeric values', () => {
      const code = `var x = String.fromCharCode(72, y, 108);`;
      const result = decodeStrings(code);
      expect(result).toContain('fromCharCode');
    });

    it('returns original code when no String.fromCharCode calls exist', () => {
      const code = `var x = "hello";`;
      const result = decodeStrings(code);
      expect(result).toBe(code);
    });

    it('handles multiple String.fromCharCode calls', () => {
      const code = `
        var a = String.fromCharCode(65);
        var b = String.fromCharCode(66);
      `;
      const result = decodeStrings(code);
      expect(result).toContain('"A"');
      expect(result).toContain('"B"');
      expect(result).not.toContain('fromCharCode');
    });

    it('returns original code on parse error', () => {
      const parseSpy = vi.spyOn(parser, 'parse').mockImplementation(() => {
        throw new Error('parse error');
      });

      const code = 'var x = 1;';
      const result = decodeStrings(code);
      expect(result).toBe(code);
      expect(loggerState.error).toHaveBeenCalled();
      parseSpy.mockRestore();
    });
  });

  // ─── applyASTOptimizations ────────────────────────────────────────

  describe('applyASTOptimizations', () => {
    it('folds numeric addition: 2 + 3 => 5', () => {
      const code = `var x = 2 + 3;`;
      const result = applyASTOptimizations(code);
      expect(result).toContain('5');
      expect(result).not.toContain('2 + 3');
    });

    it('folds numeric subtraction: 10 - 4 => 6', () => {
      const code = `var x = 10 - 4;`;
      const result = applyASTOptimizations(code);
      expect(result).toContain('6');
    });

    it('folds numeric multiplication: 3 * 7 => 21', () => {
      const code = `var x = 3 * 7;`;
      const result = applyASTOptimizations(code);
      expect(result).toContain('21');
    });

    it('folds numeric division: 20 / 5 => 4', () => {
      const code = `var x = 20 / 5;`;
      const result = applyASTOptimizations(code);
      expect(result).toContain('4');
    });

    it('folds numeric modulo: 10 % 3 => 1', () => {
      const code = `var x = 10 % 3;`;
      const result = applyASTOptimizations(code);
      expect(result).toContain('1');
    });

    it('folds numeric exponentiation: 2 ** 3 => 8', () => {
      const code = `var x = 2 ** 3;`;
      const result = applyASTOptimizations(code);
      expect(result).toContain('8');
    });

    it('simplifies true && expr to expr', () => {
      const code = `var x = true && getValue();`;
      const result = applyASTOptimizations(code);
      expect(result).toContain('getValue()');
      expect(result).not.toContain('true &&');
    });

    it('simplifies false || expr to expr', () => {
      const code = `var x = false || getValue();`;
      const result = applyASTOptimizations(code);
      expect(result).toContain('getValue()');
      expect(result).not.toContain('false ||');
    });

    it('removes empty statements', () => {
      const code = `var x = 1;;; var y = 2;`;
      const result = applyASTOptimizations(code);
      // After removing empty statements, the extra semicolons should be gone
      expect(result).toContain('var x = 1');
      expect(result).toContain('var y = 2');
    });

    it('simplifies true ternary: true ? a : b => a', () => {
      const code = `var x = true ? "yes" : "no";`;
      const result = applyASTOptimizations(code);
      expect(result).toContain('"yes"');
      expect(result).not.toContain('"no"');
    });

    it('simplifies false ternary: false ? a : b => b', () => {
      const code = `var x = false ? "yes" : "no";`;
      const result = applyASTOptimizations(code);
      expect(result).toContain('"no"');
      expect(result).not.toContain('"yes"');
    });

    it('returns original code when nothing to optimize', () => {
      const code = `var x = a + b;`;
      const result = applyASTOptimizations(code);
      expect(result).toBe(code);
    });

    it('returns original code on parse error', () => {
      const parseSpy = vi.spyOn(parser, 'parse').mockImplementation(() => {
        throw new Error('parse error');
      });

      const code = 'var x = 1;';
      const result = applyASTOptimizations(code);
      expect(result).toBe(code);
      expect(loggerState.error).toHaveBeenCalled();
      parseSpy.mockRestore();
    });

    it('handles chained constant folding', () => {
      // 2 + 3 => 5, then 5 * 4 depends on traversal but at minimum the inner is folded
      const code = `var x = (2 + 3) * 4;`;
      const result = applyASTOptimizations(code);
      // At least the inner addition should be folded
      expect(result).toContain('5');
    });
  });

  // ─── estimateCodeComplexity ───────────────────────────────────────

  describe('estimateCodeComplexity', () => {
    it('returns 0 for empty/simple code', () => {
      const code = `var x = 1;`;
      const result = estimateCodeComplexity(code);
      expect(result).toBe(0);
    });

    it('counts function declarations (+2)', () => {
      const code = `function foo() {} function bar() {}`;
      const result = estimateCodeComplexity(code);
      expect(result).toBe(4); // 2 functions * 2
    });

    it('counts function expressions (+2)', () => {
      const code = `var x = function() {};`;
      const result = estimateCodeComplexity(code);
      expect(result).toBe(2);
    });

    it('counts arrow function expressions (+2)', () => {
      const code = `var x = () => {};`;
      const result = estimateCodeComplexity(code);
      expect(result).toBe(2);
    });

    it('counts if statements (+1)', () => {
      const code = `if (x) {} if (y) {}`;
      const result = estimateCodeComplexity(code);
      expect(result).toBe(2);
    });

    it('counts switch statements (+2)', () => {
      const code = `switch(x) { case 1: break; }`;
      const result = estimateCodeComplexity(code);
      expect(result).toBe(2);
    });

    it('counts conditional expressions (+1)', () => {
      const code = `var x = a ? b : c;`;
      const result = estimateCodeComplexity(code);
      expect(result).toBe(1);
    });

    it('counts while statements (+2)', () => {
      const code = `while(true) { break; }`;
      const result = estimateCodeComplexity(code);
      expect(result).toBe(2);
    });

    it('counts for statements (+2)', () => {
      const code = `for(var i=0; i<10; i++) {}`;
      const result = estimateCodeComplexity(code);
      expect(result).toBe(2);
    });

    it('counts do-while statements (+2)', () => {
      const code = `do { } while(false);`;
      const result = estimateCodeComplexity(code);
      expect(result).toBe(2);
    });

    it('counts try statements (+3)', () => {
      const code = `try { foo(); } catch(e) {}`;
      const result = estimateCodeComplexity(code);
      expect(result).toBe(3);
    });

    it('accumulates complexity across multiple constructs', () => {
      const code = `
        function complex() {
          if (x) {
            for (var i=0; i<10; i++) {
              try {
                while(cond) { break; }
              } catch(e) {}
            }
          }
          switch(y) { case 1: break; }
        }
      `;
      const result = estimateCodeComplexity(code);
      // function(2) + if(1) + for(2) + try(3) + while(2) + switch(2) = 12
      expect(result).toBe(12);
    });

    it('returns 100 on parse error as fallback', () => {
      const parseSpy = vi.spyOn(parser, 'parse').mockImplementation(() => {
        throw new Error('bad code');
      });

      const result = estimateCodeComplexity('not valid js }}}');
      expect(result).toBe(100);
      parseSpy.mockRestore();
    });

    it('returns 100 on non-Error exception', () => {
      const parseSpy = vi.spyOn(parser, 'parse').mockImplementation(() => {
        throw 'string error';
      });

      const result = estimateCodeComplexity('whatever');
      expect(result).toBe(100);
      parseSpy.mockRestore();
    });
  });
});
