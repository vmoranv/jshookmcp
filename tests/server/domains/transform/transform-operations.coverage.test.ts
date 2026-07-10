import { describe, it, expect } from 'vitest';
import {
  resolveTransformsForApply,
  applyTransforms,
  buildDiff,
} from '@server/domains/transform/handlers/transform-operations';
import type { TransformKind } from '@server/domains/transform/handlers/shared';

describe('transform-operations', () => {
  describe('resolveTransformsForApply', () => {
    it('resolves transforms from a named chain', async () => {
      const chains = new Map([
        [
          'mychain',
          {
            name: 'mychain',
            transforms: ['constant_fold', 'dead_code_remove'] as TransformKind[],
            description: '',
            createdAt: 0,
          },
        ],
      ]);
      const result = resolveTransformsForApply(chains, 'mychain', []);
      expect(result).toEqual(['constant_fold', 'dead_code_remove']);
    });

    it('throws when chain name not found', async () => {
      const chains = new Map();
      expect(() => resolveTransformsForApply(chains, 'missing', [])).toThrow(
        'Transform chain not found: missing',
      );
    });

    it('falls through to parseTransforms when no chain name', async () => {
      const result = resolveTransformsForApply(new Map(), '', ['string_decrypt']);
      expect(result).toEqual(['string_decrypt']);
    });
  });

  describe('applyTransforms', () => {
    it('returns unchanged code when no transforms apply', async () => {
      const result = applyTransforms('let x = 1;', ['constant_fold']);
      expect(result.transformed).toBe('let x = 1;');
      expect(result.appliedTransforms).toEqual([]);
    });

    it('applies constant_fold for numeric expressions', async () => {
      const result = applyTransforms('let x = 2 + 3;', ['constant_fold']);
      expect(result.transformed).toContain('5');
      expect(result.appliedTransforms).toEqual(['constant_fold']);
    });

    it('applies string_decrypt for escaped strings', async () => {
      const result = applyTransforms("let x = '\\x41';", ['string_decrypt']);
      expect(result.transformed).toContain('A');
      expect(result.appliedTransforms).toEqual(['string_decrypt']);
    });

    it('applies dead_code_remove for dead branches', async () => {
      const code = 'if (false) { dead(); } else { alive(); }';
      const result = applyTransforms(code, ['dead_code_remove']);
      expect(result.transformed).toContain('alive');
      expect(result.transformed).not.toContain('dead');
    });

    it('applies dead_code_remove without else', async () => {
      const code = 'if (false) { dead(); }';
      const result = applyTransforms(code, ['dead_code_remove']);
      expect(result.transformed).not.toContain('dead');
    });

    it('applies control_flow_flatten for dispatcher pattern', async () => {
      const code = `var _0x1234='a|b'.split('|');var _0x5678=0;while(!![]){switch(_0x1234[_0x5678++]){case'a':doA();continue;case'b':doB();break;}}`;
      const result = applyTransforms(code, ['control_flow_flatten']);
      expect(result.transformed).toContain('doA');
      expect(result.transformed).toContain('doB');
    });

    it('applies rename_vars for single-letter vars', async () => {
      const code = 'var a = 1; var b = 2;';
      const result = applyTransforms(code, ['rename_vars']);
      expect(result.transformed).toContain('var_1');
      expect(result.transformed).toContain('var_2');
    });

    it('applies multiple transforms in sequence', async () => {
      const code = 'var a = 2 + 3; if (false) { dead(); }';
      const result = applyTransforms(code, ['constant_fold', 'dead_code_remove']);
      expect(result.appliedTransforms).toContain('constant_fold');
    });

    it('does not fold arithmetic inside comments', async () => {
      const code = 'const x = 1 + 2; /* 3 + 4 */';
      const result = applyTransforms(code, ['constant_fold']);
      expect(result.transformed).toContain('const x = 3');
      expect(result.transformed).toContain('/* 3 + 4 */');
    });

    it('decodes printable base64 and plain hex string literals', async () => {
      const base64 = applyTransforms("'SGVsbG8gd29ybGQh'", ['string_decrypt']);
      const hex = applyTransforms("'48656c6c6f20776f726c642148656c6c6f20776f726c6421'", [
        'string_decrypt',
      ]);
      expect(base64.transformed).toBe("'Hello world!'");
      expect(hex.transformed).toBe("'Hello world!Hello world!'");
    });

    it('unwraps atob(...) base64 call wrappers into decoded literals', async () => {
      const result = applyTransforms("var s = atob('c3RyaW5n');", ['string_decrypt']);
      expect(result.transformed).toMatch(/var s = ["']string["'];/);
      expect(result.transformed).not.toContain('atob(');
    });

    it('unwraps Buffer.from(..., "hex") call wrappers into decoded literals', async () => {
      const result = applyTransforms('var s = Buffer.from("48656c6c6f", "hex");', [
        'string_decrypt',
      ]);
      expect(result.transformed).toMatch(/var s = ["']Hello["'];/);
      expect(result.transformed).not.toContain('Buffer.from');
    });

    it('unwraps String.fromCharCode(...) charcode-join calls into literals', async () => {
      const result = applyTransforms('var s = String.fromCharCode(0x48, 0x69);', [
        'string_decrypt',
      ]);
      expect(result.transformed).toMatch(/var s = ["']Hi["'];/);
      expect(result.transformed).not.toContain('fromCharCode');
    });

    it('leaves call wrappers untouched when args are not decodable literals', async () => {
      // dynamic arg, non-printable decode, and unrelated callee all stay verbatim
      const result = applyTransforms("var a = atob(x); var b = doThing('x');", ['string_decrypt']);
      expect(result.transformed).toContain('atob(x)');
      expect(result.transformed).toContain("doThing('x')");
    });

    it('unwraps nested call wrappers innermost-first', async () => {
      // atob(atob("...")) — inner decodes first, outer decodes the result literal
      const inner = Buffer.from('Hi').toString('base64'); // "SGk="
      const outer = Buffer.from(inner).toString('base64'); // "U0dr"
      const result = applyTransforms(`var s = atob(atob("${outer}"));`, ['string_decrypt']);
      expect(result.transformed).toMatch(/var s = ["']Hi["'];/);
      expect(result.transformed).not.toContain('atob(');
    });

    it('leaves String.fromCharCode untouched on non-integer code units', async () => {
      const result = applyTransforms('var s = String.fromCharCode(0x48, 1.5);', ['string_decrypt']);
      expect(result.transformed).toContain('fromCharCode');
    });

    it('decodes a mix of wrappers and bare literals in one pass', async () => {
      const result = applyTransforms("var a = atob('SGVsbG8='); var b = 'SGVsbG8gd29ybGQh';", [
        'string_decrypt',
      ]);
      expect(result.transformed).toMatch(/var a = ["']Hello["'];/);
      expect(result.transformed).toMatch(/var b = ["']Hello world!["'];/);
    });

    it('leaves atob of non-base64 literal untouched (fail-soft)', async () => {
      const result = applyTransforms('var s = atob("not!base64");', ['string_decrypt']);
      expect(result.transformed).toContain('atob(');
      expect(result.appliedTransforms).toEqual([]);
    });

    it('leaves Buffer.from with non-hex encoding untouched (fail-soft)', async () => {
      const result = applyTransforms('var h = Buffer.from("data", "utf8");', ['string_decrypt']);
      expect(result.transformed).toContain('Buffer.from(');
    });

    it('does not throw on lone surrogate in String.fromCharCode (fail-soft)', async () => {
      const result = applyTransforms('var c = String.fromCharCode(72, 0xd800);', [
        'string_decrypt',
      ]);
      // must not throw; surrogate sequence is not printable -> left untouched
      expect(result.transformed).toContain('fromCharCode');
    });

    it('flattens array dispatcher variants', async () => {
      const code =
        'var order=["b","a"];var i=0;while(true){switch(order[i++]){case "a":a();continue;case "b":b();continue;}break;}';
      const result = applyTransforms(code, ['control_flow_flatten']);
      expect(result.transformed.indexOf('b();')).toBeLessThan(result.transformed.indexOf('a();'));
    });

    it('flattens while(!0) / while(1) / while(!false) truthy-loop dispatchers', async () => {
      const variants = [
        `var d='a|b'.split('|');var i=0;while(!0){switch(d[i++]){case'a':a();continue;case'b':b();break;}}`,
        `var d='a|b'.split('|');var i=0;while(1){switch(d[i++]){case'a':a();continue;case'b':b();break;}}`,
        `var d='a|b'.split('|');var i=0;while(!false){switch(d[i++]){case'a':a();continue;case'b':b();break;}}`,
      ];
      for (const code of variants) {
        const result = applyTransforms(code, ['control_flow_flatten']);
        expect(result.transformed, `loop not flattened for: ${code}`).not.toContain('while');
        expect(result.transformed).toContain('a()');
        expect(result.transformed).toContain('b()');
      }
    });

    it('removes cursor self-increment dead code after flattening (cursor-in-case variant)', async () => {
      // cursor `i` is advanced inside each case body, not in the switch discriminant;
      // after flattening the loop is gone so `i` is dead — its increments must not leak
      const code =
        "var d='a|b'.split('|');var i=0;while(true){switch(d[i]){case'a':a();i++;continue;case'b':b();i++;break;}}";
      const result = applyTransforms(code, ['control_flow_flatten']);
      expect(result.transformed).not.toContain('while');
      expect(result.transformed).toContain('a()');
      expect(result.transformed).toContain('b()');
      expect(result.transformed).not.toContain('i++');
    });

    it('removes dead branches guarded by if(!1) / if(!true) (negated-literal falsy)', async () => {
      const r1 = applyTransforms('if(!1){dead();}else{alive();}', ['dead_code_remove']);
      expect(r1.transformed).not.toContain('dead');
      expect(r1.transformed).toContain('alive');
      const r2 = applyTransforms('if(!true){dead();}', ['dead_code_remove']);
      expect(r2.transformed).not.toContain('dead');
    });

    it('does NOT flatten falsy-literal loops (symmetry: while(0) / while("") / while(null))', async () => {
      const variants = [
        `var d='a|b'.split('|');var i=0;while(0){switch(d[i++]){case'a':a();continue;}}`,
        `var d='a|b'.split('|');var i=0;while(""){switch(d[i++]){case'a':a();continue;}}`,
        `var d='a|b'.split('|');var i=0;while(null){switch(d[i++]){case'a':a();continue;}}`,
      ];
      for (const code of variants) {
        const result = applyTransforms(code, ['control_flow_flatten']);
        expect(result.transformed, `falsy loop must not flatten: ${code}`).toContain('while');
        expect(result.appliedTransforms).toEqual([]);
      }
    });

    it('does NOT remove truthy-literal branches (symmetry: if(1) / if("x")) in dead_code_remove', async () => {
      expect(applyTransforms('if(1){alive();}', ['dead_code_remove']).transformed).toContain(
        'alive',
      );
      expect(applyTransforms('if("x"){alive();}', ['dead_code_remove']).transformed).toContain(
        'alive',
      );
    });

    it('renames _0x bindings without touching property names or template raw text', async () => {
      const code = 'var _0xabc = 1; obj._0xabc = _0xabc; const text = `_0xabc:${_0xabc}`;';
      const result = applyTransforms(code, ['rename_vars']);
      expect(result.transformed).toContain('var var_1 = 1');
      expect(result.transformed).toContain('obj._0xabc = var_1');
      expect(result.transformed).toContain('`_0xabc:${var_1}`');
    });

    it('renames _0x bindings per lexical scope', async () => {
      const code = 'var _0xabc = 1; function f(_0xabc) { return _0xabc; } _0xabc;';
      const result = applyTransforms(code, ['rename_vars']);
      expect(result.transformed).toContain('var var_1 = 1');
      expect(result.transformed).toContain('function f(var_2) {return var_2; }');
      expect(result.transformed.trimEnd().endsWith('var_1;')).toBe(true);
    });

    it('handles empty code', async () => {
      const result = applyTransforms('', ['constant_fold']);
      expect(result.transformed).toBe('');
    });

    it('skips unrecognized transforms', async () => {
      const result = applyTransforms('function hello() { return 1; }', ['rename_vars']);
      expect(result.transformed).toBe('function hello() { return 1; }');
      expect(result.appliedTransforms).toEqual([]);
    });
  });

  describe('buildDiff', () => {
    it('returns empty string for identical inputs', async () => {
      expect(buildDiff('abc', 'abc')).toBe('');
    });

    it('produces unified diff for changes', async () => {
      const diff = buildDiff('line1\nline2', 'line1\nline3');
      expect(diff).toContain('-line2');
      expect(diff).toContain('+line3');
      expect(diff).toContain(' line1');
    });

    it('handles all lines removed', async () => {
      const diff = buildDiff('a\nb', '');
      expect(diff).toContain('-a');
      expect(diff).toContain('-b');
    });

    it('handles all lines added', async () => {
      const diff = buildDiff('', 'a\nb');
      expect(diff).toContain('+a');
      expect(diff).toContain('+b');
    });

    it('handles single-line diff', async () => {
      const diff = buildDiff('old', 'new');
      expect(diff).toContain('-old');
      expect(diff).toContain('+new');
    });

    it('uses fallback for very large inputs', async () => {
      const size = 600;
      const oldLines = Array.from({ length: size }, (_, i) => `old_${i}`);
      const newLines = Array.from({ length: size }, (_, i) => `new_${i}`);
      const diff = buildDiff(oldLines.join('\n'), newLines.join('\n'));
      expect(diff).toContain('-old_1');
      expect(diff).toContain('+new_1');
    });

    it('preserves common prefix and suffix in fallback diff', async () => {
      const size = 600;
      const oldLines = Array.from({ length: size }, (_, i) => `line_${i}`);
      const newLines = [...oldLines];
      newLines[300] = 'changed';
      const diff = buildDiff(oldLines.join('\n'), newLines.join('\n'));
      expect(diff).toContain('-line_300');
      expect(diff).toContain('+changed');
    });
  });
});
