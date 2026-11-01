/**
 * Three-way equivalence for the shared JScrambler pass core.
 *
 * `JScramblerDeobfuscator` (main thread) and the off-thread worker both
 * consume `createJscramblerCore` from `jscrambler-core.ts` — the single source
 * of truth for the Babel parse + five traverse/generate passes. This file
 * proves the core produces byte-identical output to the main-thread class on
 * the same fixtures, so a drift between the shared module and its consumers
 * fails here instead of silently diverging in production.
 */

import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import { generate } from '@babel/generator';
import * as t from '@babel/types';
import { describe, expect, it } from 'vitest';
import { JScramberDeobfuscator } from '@modules/deobfuscator/JScramblerDeobfuscator';
import {
  createJscramblerCore,
  calculateConfidence,
  type JscramblerCoreBabel,
  type JscramblerCoreOptions,
} from '@modules/deobfuscator/jscrambler-core';

const babel: JscramblerCoreBabel = { parser, traverse, generate, types: t };
const core = createJscramblerCore(babel);

interface Fixture {
  name: string;
  code: string;
  options: Partial<JscramblerCoreOptions>;
}

const FIXTURES: Fixture[] = [
  {
    name: 'self-defending debugger',
    code: `
function guard(){ debugger; return 1; }
setInterval(function(){ debugger; }, 1000);
guard();
`,
    options: {},
  },
  {
    name: 'unresolvable decrypt call left in place',
    code: `
function dec(s){ return s.split('').map(c=>String.fromCharCode(c.charCodeAt(0))).join(''); }
const value = dec("abc");
`,
    options: {},
  },
  {
    name: 'successful static decryption',
    code: `
const dec = (s) => String.fromCharCode(s.charCodeAt(0) + 1);
var _s = ["alpha", "beta"];
function idx(i) { return _s[i]; }
const a = dec("a");
const c = idx(1);
`,
    options: {},
  },
  {
    name: 'while-switch linearizable',
    code: `
var state = 0;
while (true) {
  switch (state) {
    case 0: foo(); state = 1; break;
    case 1: bar(); break;
  }
}
`,
    options: {},
  },
  {
    name: 'dead branch + arithmetic simplification',
    code: `
if (false) { drop(); } else { keep(); }
const n = 2 + 3;
`,
    options: {},
  },
  {
    name: 'parse failure',
    code: 'function broken( {',
    options: {},
  },
];

describe('jscrambler-core three-way equivalence', () => {
  for (const fixture of FIXTURES) {
    it(`matches the main-thread class for: ${fixture.name}`, async () => {
      const mainThread = await new JScramberDeobfuscator().deobfuscate({
        code: fixture.code,
        removeDeadCode: fixture.options.removeDeadCode,
        restoreControlFlow: fixture.options.restoreControlFlow,
        decryptStrings: fixture.options.decryptStrings,
        simplifyExpressions: fixture.options.simplifyExpressions,
      });

      const coreResult = core.deobfuscate(fixture.code, {
        removeDeadCode: fixture.options.removeDeadCode ?? true,
        restoreControlFlow: fixture.options.restoreControlFlow ?? true,
        decryptStrings: fixture.options.decryptStrings ?? true,
        simplifyExpressions: fixture.options.simplifyExpressions ?? true,
      });

      expect(coreResult.code).toBe(mainThread.code);
      expect(coreResult.success).toBe(mainThread.success);
      expect(coreResult.transformations).toEqual(mainThread.transformations);
      expect(coreResult.warnings).toEqual(mainThread.warnings);
      expect(coreResult.confidence).toBeCloseTo(mainThread.confidence);
    });
  }
});

describe('jscrambler-core confidence', () => {
  it('caps at 1.0 and scales by the confidence divisor', () => {
    expect(calculateConfidence(0)).toBe(0);
    expect(calculateConfidence(3)).toBeCloseTo(0.6);
    expect(calculateConfidence(9)).toBe(1);
  });
});

/**
 * Static-evaluator branch coverage.
 *
 * `evalCall` decides whether a decrypt call can be folded to a literal. Each
 * supported callee shape (global constructor, `String.fromCharCode`, and the
 * string-instance methods) has its own guard that turns an unresolvable
 * argument into "leave the call in place" rather than folding it to a wrong
 * value. The end-to-end fixtures above only exercise one or two of these, so a
 * structural split of `evalCall` could reorder or drop a guard and stay green.
 *
 * Each case reaches a specific branch through `decryptStrings`: the wrapper
 * `dec` is recognised as a decryptor, and its single `return` expression is
 * evaluated statically. A folded integer/string result proves the branch ran.
 */
describe('jscrambler-core static evaluator branches', () => {
  // Shape that actually reaches `evalCall`:
  //   - `dec` is registered as a decryptor because its body indexes the
  //     module-level array `_s` (`looksLikeDecryptFunction`).
  //   - `evalBlock` only accepts `var` declarations, assignments and `return`,
  //     so the body holds a single declaration plus the return under test.
  // The folded value is read from `const __out = <value>;`. Asserting on that
  // exact literal (not a substring of the whole program) is what makes these
  // cases fail if a guard is dropped: e.g. without the fromCharCode arity/type
  // guard, `String.fromCharCode("A")` folds to a NUL character instead of staying put.
  const fold = (returnExpr: string): string => {
    const code = `
var _s = ["alpha"];
function dec(){ var _k = _s[0]; return ${returnExpr}; }
const __out = dec();
`;
    const result = core.deobfuscate(code, {
      removeDeadCode: false,
      restoreControlFlow: false,
      decryptStrings: true,
      simplifyExpressions: false,
    });
    const match = /const __out = ([^;]+);/.exec(result.code);
    return match?.[1] ?? '<missing>';
  };

  const FOLD_CASES: Array<[name: string, expr: string, expected: string]> = [
    ['String over a single numeric literal', 'String(12345)', '"12345"'],
    ['String refuses a non-single argument count', 'String(1, 2)', 'dec()'],
    ['Number over a numeric string', 'Number("12345")', '12345'],
    ['Number refuses booleans that JS would coerce to 0/1', 'Number(true)', 'dec()'],
    ['parseInt with an explicit radix', 'parseInt("ff", 16)', '255'],
    ['parseInt with the default radix', 'parseInt("42")', '42'],
    ['parseFloat', 'parseFloat("1.5")', '1.5'],
    ['String.fromCharCode over numeric arguments', 'String.fromCharCode(65, 66)', '"AB"'],
    [
      'String.fromCharCode refuses a non-numeric argument instead of folding to NUL',
      'String.fromCharCode("A")',
      'dec()',
    ],
    ['string charCodeAt', '"A".charCodeAt(0)', '65'],
    ['string charAt', '"abc".charAt(1)', '"b"'],
    ['string substr', '"abcdef".substr(1, 2)', '"bc"'],
    ['string substring', '"abcdef".substring(1, 3)', '"bc"'],
    ['string slice', '"abcdef".slice(1, 3)', '"bc"'],
    ['string concat', '"a".concat("b", "c")', '"abc"'],
    [
      'string concat refuses non-string arguments instead of collapsing to the receiver',
      '"a".concat(1)',
      'dec()',
    ],
    ['string indexOf', '"abcdef".indexOf("cd")', '2'],
    ['toLowerCase', '"AB".toLowerCase()', '"ab"'],
    ['toUpperCase', '"ab".toUpperCase()', '"AB"'],
    ['trim', '"  x  ".trim()', '"x"'],
    ['zero-argument string methods refuse arguments', '"AB".toLowerCase(1)', 'dec()'],
    ['replace folds to a literal split/join', '"a-b".replace("-", "+")', '"a+b"'],
    ['replace refuses a non-string replacement', '"a-b".replace("-", 1)', 'dec()'],
    ['unknown string method is left in place', '"ab".padStart(4)', 'dec()'],
    ['unknown global callee is left in place', 'decodeURI("x")', 'dec()'],
  ];

  for (const [name, expr, expected] of FOLD_CASES) {
    it(`${name}: ${expr}`, () => {
      expect(fold(expr)).toBe(expected);
    });
  }
});
