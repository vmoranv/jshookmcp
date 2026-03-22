import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TransformKind } from '@server/domains/transform/handlers.impl.transform-base';
import { TransformToolHandlersOps } from '@server/domains/transform/handlers.impl.transform-ops';

vi.mock('@utils/WorkerPool', () => ({
  WorkerPool: class MockWorkerPool {
    submit = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@src/constants', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    TRANSFORM_WORKER_TIMEOUT_MS: 5000,
    TRANSFORM_CRYPTO_POOL_MAX_WORKERS: 2,
    TRANSFORM_CRYPTO_POOL_IDLE_TIMEOUT_MS: 30000,
    TRANSFORM_CRYPTO_POOL_MAX_OLD_GEN_MB: 64,
    TRANSFORM_CRYPTO_POOL_MAX_YOUNG_GEN_MB: 32,
  };
});

class TestableOps extends TransformToolHandlersOps {
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    super(null as any);
  }

  public testTransformConstantFold(code: string) {
    return this.transformConstantFold(code);
  }
  public testTransformStringDecrypt(code: string) {
    return this.transformStringDecrypt(code);
  }
  public testTransformDeadCodeRemove(code: string) {
    return this.transformDeadCodeRemove(code);
  }
  public testTransformControlFlowFlatten(code: string) {
    return this.transformControlFlowFlatten(code);
  }
  public testTransformRenameVars(code: string) {
    return this.transformRenameVars(code);
  }
  public testApplySingleTransform(code: string, kind: TransformKind) {
    return this.applySingleTransform(code, kind);
  }
  public testApplyTransforms(code: string, kinds: TransformKind[]) {
    return this.applyTransforms(code, kinds);
  }
  public testBuildDiff(a: string, b: string) {
    return this.buildDiff(a, b);
  }
  public testBuildFallbackDiff(a: string[], b: string[]) {
    return this.buildFallbackDiff(a, b);
  }

  public testParseTransforms(raw: unknown) {
    return this.parseTransforms(raw);
  }
  public testParseBoolean(raw: unknown, def: boolean) {
    return this.parseBoolean(raw, def);
  }
  public testRequireString(raw: unknown, field: string) {
    return this.requireString(raw, field);
  }
  public testEscapeStringContent(v: string, q: string) {
    return this.escapeStringContent(v, q);
  }
  public testDecodeEscapedString(v: string) {
    return this.decodeEscapedString(v);
  }
  public testIsValidIdentifier(v: string) {
    return this.isValidIdentifier(v);
  }
  public testParseTestInputs(raw: unknown) {
    return this.parseTestInputs(raw);
  }

  public getChains() {
    return this.chains;
  }
  public testResolveTransformsForApply(chainName: string, raw: unknown) {
    return this.resolveTransformsForApply(chainName, raw);
  }
}

describe('TransformToolHandlersOps', () => {
  let ops: TestableOps;

  beforeEach(() => {
    ops = new TestableOps();
  });

  describe('transformConstantFold', () => {
    it('folds numeric binary expressions', () => {
      expect(ops.testTransformConstantFold('1+2')).toBe('3');
      expect(ops.testTransformConstantFold('10-3')).toBe('7');
      expect(ops.testTransformConstantFold('4*5')).toBe('20');
      expect(ops.testTransformConstantFold('10/2')).toBe('5');
      expect(ops.testTransformConstantFold('10%3')).toBe('1');
    });

    it('leaves division/modulo by zero unchanged', () => {
      expect(ops.testTransformConstantFold('10/0')).toBe('10/0');
      expect(ops.testTransformConstantFold('10%0')).toBe('10%0');
    });

    it('leaves non-finite results unchanged', () => {
      const big = `1${'0'.repeat(200)}`; // ~1e200 (finite)
      const expr = `${big}*${big}`; // ~1e400 (Infinity)
      expect(ops.testTransformConstantFold(expr)).toBe(expr);
    });

    it('folds string concatenations and normalizes mixed quotes to single quotes', () => {
      expect(ops.testTransformConstantFold(`'a'+'b'`)).toBe(`'ab'`);
      expect(ops.testTransformConstantFold(`'a'+"b"`)).toBe(`'ab'`);
    });

    it('folds iteratively across rounds', () => {
      expect(ops.testTransformConstantFold('1+2+3')).toBe('6');
    });
  });

  describe('transformStringDecrypt', () => {
    it('decodes hex escapes inside string literals', () => {
      expect(ops.testTransformStringDecrypt("'\\x48\\x65\\x6c\\x6c\\x6f'")).toBe("'Hello'");
    });

    it('decodes unicode escapes inside string literals', () => {
      expect(ops.testTransformStringDecrypt("'\\u0048\\u0065'")).toBe("'He'");
    });

    it('leaves already-plain strings unchanged', () => {
      expect(ops.testTransformStringDecrypt(`'Hello'`)).toBe(`'Hello'`);
    });
  });

  describe('transformDeadCodeRemove', () => {
    it('replaces if(false){dead}else{live} with live body', () => {
      expect(ops.testTransformDeadCodeRemove('if(false){dead}else{live}')).toBe('live');
    });

    it('removes if(false){dead} entirely', () => {
      expect(ops.testTransformDeadCodeRemove('if(false){dead}')).toBe('');
    });

    it('removes if(0){dead} entirely', () => {
      expect(ops.testTransformDeadCodeRemove('if(0){dead}')).toBe('');
    });

    it('leaves normal if statements unchanged', () => {
      const code = 'if(x){dead}else{live}';
      expect(ops.testTransformDeadCodeRemove(code)).toBe(code);
    });
  });

  describe('transformControlFlowFlatten', () => {
    it('rebuilds statements from standard switch dispatch pattern', () => {
      const code = `var order="2|0|1".split("|");var i=0;while(!![]){switch(order[i++]){case "0":console.log("a");continue;case "1":console.log("b");continue;case "2":console.log("c");continue;}break;}`;
      const expected = `console.log("c");\nconsole.log("a");\nconsole.log("b");`;
      expect(ops.testTransformControlFlowFlatten(code)).toBe(expected);
    });

    it('returns unchanged when no pattern matches', () => {
      const code = 'var x = 1; x++;';
      expect(ops.testTransformControlFlowFlatten(code)).toBe(code);
    });
  });

  describe('transformRenameVars', () => {
    it('renames single-letter vars', () => {
      const code = 'var a = 1; a + 2';
      expect(ops.testTransformRenameVars(code)).toBe('var var_1 = 1; var_1 + 2');
    });

    it('leaves code unchanged when there are no single-letter var/let/const declarations', () => {
      const code = 'var alpha = 1; alpha + 2';
      expect(ops.testTransformRenameVars(code)).toBe(code);
    });

    it('does not rename after dots', () => {
      const code = 'var a = 1; obj.a = a;';
      const out = ops.testTransformRenameVars(code);
      expect(out).toContain('obj.a');
      expect(out).toContain('var var_1');
    });
  });

  describe('applySingleTransform', () => {
    it('dispatches constant_fold to transformConstantFold', () => {
      expect(ops.testApplySingleTransform('1+2', 'constant_fold')).toBe('3');
    });

    it('dispatches string_decrypt to transformStringDecrypt', () => {
      expect(ops.testApplySingleTransform("'\\x48\\x69'", 'string_decrypt')).toBe("'Hi'");
    });

    it('dispatches dead_code_remove to transformDeadCodeRemove', () => {
      expect(ops.testApplySingleTransform('if(false){a}', 'dead_code_remove')).toBe('');
    });

    it('dispatches control_flow_flatten to transformControlFlowFlatten', () => {
      const code = `var o="0".split("|");var i=0;while(!![]){switch(o[i++]){case "0":console.log("x");continue;}break;}`;
      expect(ops.testApplySingleTransform(code, 'control_flow_flatten')).toBe(`console.log("x");`);
    });

    it('dispatches rename_vars to transformRenameVars', () => {
      expect(ops.testApplySingleTransform('let a = 1; a;', 'rename_vars')).toBe(
        'let var_1 = 1; var_1;'
      );
    });

    it('returns code unchanged for unknown transform kind', () => {
      const code = 'const x = 1;';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      expect(ops.testApplySingleTransform(code, 'unknown' as any)).toBe(code);
    });
  });

  describe('applyTransforms', () => {
    it('returns only actually-changed transforms in appliedTransforms', () => {
      const result = ops.testApplyTransforms('const x = 1+2;', [
        'constant_fold',
        'dead_code_remove',
      ]);
      expect(result.transformed).toBe('const x = 3;');
      expect(result.appliedTransforms).toEqual(['constant_fold']);
    });

    it('applies transforms in order', () => {
      const code = 'if(false){var a=1;a;}else{var b=2;b;}';
      const result = ops.testApplyTransforms(code, ['dead_code_remove', 'rename_vars']);
      expect(result.appliedTransforms).toEqual(['dead_code_remove', 'rename_vars']);
    });
  });

  describe('buildDiff', () => {
    it('returns empty diff when strings are identical', () => {
      expect(ops.testBuildDiff('a\nb', 'a\nb')).toBe('');
    });

    it('emits + and - lines when content differs', () => {
      const diff = ops.testBuildDiff('a\nb\nc', 'a\nx\nc');
      expect(diff).toContain('-b');
      expect(diff).toContain('+x');
    });

    it('uses fallback diff for large inputs', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      const spy = vi.spyOn(ops as any, 'buildFallbackDiff');

      const oldText = Array.from({ length: 600 }, (_, i) => `L${i}`).join('\n');
      const newText = Array.from({ length: 600 }, (_, i) => (i === 300 ? `X${i}` : `L${i}`)).join(
        '\n'
      );

      const diff = ops.testBuildDiff(oldText, newText);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(diff).toContain('-L300');
      expect(diff).toContain('+X300');
    });
  });

  describe('buildFallbackDiff', () => {
    it('computes a minimal prefix/suffix diff', () => {
      const diff = ops.testBuildFallbackDiff(['a', 'b', 'c'], ['a', 'x', 'c']);
      expect(diff).toBe('-b\n+x');
    });
  });

  describe('resolveTransformsForApply', () => {
    it('uses parseTransforms when chainName is empty', () => {
      expect(ops.testResolveTransformsForApply('', ['constant_fold', 'constant_fold'])).toEqual([
        'constant_fold',
      ]);
    });

    it('returns the chain transforms when chainName exists', () => {
      ops.getChains().set('fast', {
        name: 'fast',
        transforms: ['constant_fold', 'dead_code_remove'],
        createdAt: Date.now(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      } as any);

      expect(ops.testResolveTransformsForApply('fast', null)).toEqual([
        'constant_fold',
        'dead_code_remove',
      ]);
    });

    it('throws when chainName is unknown', () => {
      expect(() => ops.testResolveTransformsForApply('missing', ['constant_fold'])).toThrow(
        'Transform chain not found: missing'
      );
    });
  });
});
