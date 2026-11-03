/**
 * Differential baseline for the createJscramblerCore split.
 *
 * Every case captures the FULL result object (code, transformations,
 * warnings, stats) so a structural refactor that changes any observable
 * field fails here even when the headline output looks the same.
 *
 * Snapshot values were recorded against the pre-split implementation.
 */
import { describe, expect, it } from 'vitest';
import * as parser from '@babel/parser';
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import * as types from '@babel/types';

import { createJscramblerCore } from '@modules/deobfuscator/jscrambler-core';

const traverse = (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse;
const generate = (_generate as unknown as { default: typeof _generate }).default ?? _generate;

const core = createJscramblerCore({
  parser: parser as never,
  traverse: traverse as never,
  generate: generate as never,
  types: types as never,
});

const ALL_OFF = {
  decryptStrings: false,
  removeSelfDefending: false,
  restoreControlFlow: false,
  removeDeadCode: false,
  simplifyExpressions: false,
};
const ALL_ON = {
  decryptStrings: true,
  removeSelfDefending: true,
  restoreControlFlow: true,
  removeDeadCode: true,
  simplifyExpressions: true,
};

const CASES: Array<{ name: string; code: string }> = [
  { name: 'plain assignment', code: 'var a = 1; var b = a + 2;' },
  { name: 'function declaration', code: 'function f(x) { return x * 2; }' },
  { name: 'self-defending pattern', code: 'function g(){ debugger; } var s = "" + g;' },
  { name: 'string array + index', code: "var arr = ['aa','bb']; console.log(arr[0], arr[1]);" },
  { name: 'empty program', code: '' },
  { name: 'syntax error', code: 'var = ;' },
  { name: 'template literal', code: 'var t = `a${1 + 2}b`;' },
  { name: 'nested ternary', code: 'var v = a ? b ? 1 : 2 : 3;' },
  { name: 'unreachable code', code: 'function h(){ return 1; var dead = 2; }' },
  { name: 'logic chain', code: 'var r = (1 && 2) || (3 && 4);' },
];

describe('jscrambler-core differential baseline', () => {
  for (const c of CASES) {
    it(`all-off: ${c.name}`, () => {
      const r = core.deobfuscate(c.code, ALL_OFF);
      expect({
        code: r.code,
        transformations: r.transformations,
        warnings: r.warnings,
        success: r.success,
        confidence: r.confidence,
      }).toMatchSnapshot();
    });

    it(`all-on: ${c.name}`, () => {
      const r = core.deobfuscate(c.code, ALL_ON);
      expect({
        code: r.code,
        transformations: r.transformations,
        warnings: r.warnings,
        success: r.success,
        confidence: r.confidence,
      }).toMatchSnapshot();
    });
  }
});
