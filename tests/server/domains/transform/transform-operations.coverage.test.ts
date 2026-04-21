import { describe, it, expect } from 'vitest';
import {
  resolveTransformsForApply,
  applyTransforms,
  buildDiff,
} from '@server/domains/transform/handlers/transform-operations';
import type { TransformKind } from '@server/domains/transform/handlers/shared';

describe('transform-operations', () => {
  describe('resolveTransformsForApply', () => {
    it('resolves transforms from a named chain', () => {
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

    it('throws when chain name not found', () => {
      const chains = new Map();
      expect(() => resolveTransformsForApply(chains, 'missing', [])).toThrow(
        'Transform chain not found: missing',
      );
    });

    it('falls through to parseTransforms when no chain name', () => {
      const result = resolveTransformsForApply(new Map(), '', ['string_decrypt']);
      expect(result).toEqual(['string_decrypt']);
    });
  });

  describe('applyTransforms', () => {
    it('returns unchanged code when no transforms apply', () => {
      const result = applyTransforms('let x = 1;', ['constant_fold']);
      expect(result.transformed).toBe('let x = 1;');
      expect(result.appliedTransforms).toEqual([]);
    });

    it('applies constant_fold for numeric expressions', () => {
      const result = applyTransforms('let x = 2 + 3;', ['constant_fold']);
      expect(result.transformed).toContain('5');
      expect(result.appliedTransforms).toEqual(['constant_fold']);
    });

    it('applies string_decrypt for escaped strings', () => {
      const result = applyTransforms("let x = '\\x41';", ['string_decrypt']);
      expect(result.transformed).toContain('A');
      expect(result.appliedTransforms).toEqual(['string_decrypt']);
    });

    it('applies dead_code_remove for dead branches', () => {
      const code = 'if (false) { dead(); } else { alive(); }';
      const result = applyTransforms(code, ['dead_code_remove']);
      expect(result.transformed).toContain('alive');
      expect(result.transformed).not.toContain('dead');
    });

    it('applies dead_code_remove without else', () => {
      const code = 'if (false) { dead(); }';
      const result = applyTransforms(code, ['dead_code_remove']);
      expect(result.transformed).not.toContain('dead');
    });

    it('applies control_flow_flatten for dispatcher pattern', () => {
      const code = `var _0x1234='a|b'.split('|');var _0x5678=0;while(!![]){switch(_0x1234[_0x5678++]){case'a':doA();continue;case'b':doB();break;}}`;
      const result = applyTransforms(code, ['control_flow_flatten']);
      expect(result.transformed).toContain('doA');
      expect(result.transformed).toContain('doB');
    });

    it('applies rename_vars for single-letter vars', () => {
      const code = 'var a = 1; var b = 2;';
      const result = applyTransforms(code, ['rename_vars']);
      expect(result.transformed).toContain('var_1');
      expect(result.transformed).toContain('var_2');
    });

    it('applies multiple transforms in sequence', () => {
      const code = 'var a = 2 + 3; if (false) { dead(); }';
      const result = applyTransforms(code, ['constant_fold', 'dead_code_remove']);
      expect(result.appliedTransforms).toContain('constant_fold');
    });

    it('handles empty code', () => {
      const result = applyTransforms('', ['constant_fold']);
      expect(result.transformed).toBe('');
    });

    it('skips unrecognized transforms', () => {
      const result = applyTransforms('function hello() { return 1; }', ['rename_vars']);
      expect(result.transformed).toBe('function hello() { return 1; }');
      expect(result.appliedTransforms).toEqual([]);
    });
  });

  describe('buildDiff', () => {
    it('returns empty string for identical inputs', () => {
      expect(buildDiff('abc', 'abc')).toBe('');
    });

    it('produces unified diff for changes', () => {
      const diff = buildDiff('line1\nline2', 'line1\nline3');
      expect(diff).toContain('-line2');
      expect(diff).toContain('+line3');
      expect(diff).toContain(' line1');
    });

    it('handles all lines removed', () => {
      const diff = buildDiff('a\nb', '');
      expect(diff).toContain('-a');
      expect(diff).toContain('-b');
    });

    it('handles all lines added', () => {
      const diff = buildDiff('', 'a\nb');
      expect(diff).toContain('+a');
      expect(diff).toContain('+b');
    });

    it('handles single-line diff', () => {
      const diff = buildDiff('old', 'new');
      expect(diff).toContain('-old');
      expect(diff).toContain('+new');
    });

    it('uses fallback for very large inputs', () => {
      const size = 600;
      const oldLines = Array.from({ length: size }, (_, i) => `old_${i}`);
      const newLines = Array.from({ length: size }, (_, i) => `new_${i}`);
      const diff = buildDiff(oldLines.join('\n'), newLines.join('\n'));
      expect(diff).toContain('-old_1');
      expect(diff).toContain('+new_1');
    });

    it('preserves common prefix and suffix in fallback diff', () => {
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
