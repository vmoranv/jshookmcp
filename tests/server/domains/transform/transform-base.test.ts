import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TransformToolHandlersBase } from '@server/domains/transform/handlers.impl.transform-base';

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

class TestableBase extends TransformToolHandlersBase {
  constructor() {
    super(null as any);
  }

  public testParseTransforms(raw: any) {
    return this.parseTransforms(raw);
  }
  public testParseBoolean(raw: any, def: boolean) {
    return this.parseBoolean(raw, def);
  }
  public testRequireString(raw: any, field: string) {
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
  public testParseTestInputs(raw: any) {
    return this.parseTestInputs(raw);
  }
}

describe('TransformToolHandlersBase', () => {
  let base: TestableBase;

  beforeEach(() => {
    base = new TestableBase();
  });

  describe('parseTransforms', () => {
    it('accepts array input, validates, and dedupes', async () => {
      expect(base.testParseTransforms(['constant_fold', 'constant_fold', 'rename_vars'])).toEqual([
        'constant_fold',
        'rename_vars',
      ]);
    });

    it('accepts comma-separated strings, validates, and dedupes', async () => {
      expect(base.testParseTransforms('constant_fold, dead_code_remove, constant_fold')).toEqual([
        'constant_fold',
        'dead_code_remove',
      ]);
    });

    it('throws on empty input', async () => {
      expect(() => base.testParseTransforms([])).toThrow(
        'transforms must contain at least one transform',
      );
      expect(() => base.testParseTransforms('')).toThrow(
        'transforms must contain at least one transform',
      );
      expect(() => base.testParseTransforms(undefined)).toThrow(
        'transforms must contain at least one transform',
      );
    });

    it('throws on invalid transform kind', async () => {
      expect(() => base.testParseTransforms(['nope'])).toThrow('Unsupported transform: nope');
    });
  });

  describe('parseBoolean', () => {
    it('returns booleans as-is', async () => {
      expect(base.testParseBoolean(true, false)).toBe(true);
      expect(base.testParseBoolean(false, true)).toBe(false);
    });

    it('parses truthy strings', async () => {
      for (const v of ['true', '1', 'yes', 'on', ' TRUE ', 'On']) {
        expect(base.testParseBoolean(v, false)).toBe(true);
      }
    });

    it('parses falsy strings', async () => {
      for (const v of ['false', '0', 'no', 'off', ' FALSE ', 'Off']) {
        expect(base.testParseBoolean(v, true)).toBe(false);
      }
    });

    it('parses 1/0 numbers', async () => {
      expect(base.testParseBoolean(1, false)).toBe(true);
      expect(base.testParseBoolean(0, true)).toBe(false);
    });

    it('falls back to default for other values', async () => {
      expect(base.testParseBoolean(2, true)).toBe(true);
      expect(base.testParseBoolean('maybe', false)).toBe(false);
      expect(base.testParseBoolean(null, true)).toBe(true);
      expect(base.testParseBoolean(undefined, false)).toBe(false);
    });
  });

  describe('requireString', () => {
    it('returns valid non-empty strings', async () => {
      expect(base.testRequireString('ok', 'field')).toBe('ok');
      expect(base.testRequireString(' ', 'field')).toBe(' ');
    });

    it('throws on empty string', async () => {
      expect(() => base.testRequireString('', 'code')).toThrow('code must be a non-empty string');
    });

    it('throws on non-string', async () => {
      expect(() => base.testRequireString(123 as any, 'code')).toThrow(
        'code must be a non-empty string',
      );
    });
  });

  describe('escapeStringContent', () => {
    it('doubles backslashes and escapes control characters', async () => {
      expect(base.testEscapeStringContent('a\\b', "'")).toBe('a\\\\b');
      expect(base.testEscapeStringContent('a\nb', "'")).toBe('a\\nb');
      expect(base.testEscapeStringContent('a\tb', "'")).toBe('a\\tb');
      expect(base.testEscapeStringContent('a\rb', "'")).toBe('a\\rb');
    });

    it('escapes double quotes when quote is "', async () => {
      expect(base.testEscapeStringContent('a"b', '"')).toBe('a\\"b');
      expect(base.testEscapeStringContent("a'b", '"')).toBe("a'b");
    });

    it("escapes single quotes when quote is '", async () => {
      expect(base.testEscapeStringContent("a'b", "'")).toBe("a\\'b");
      expect(base.testEscapeStringContent('a"b', "'")).toBe('a"b');
    });
  });

  describe('decodeEscapedString', () => {
    it('decodes \\xHH sequences', async () => {
      expect(base.testDecodeEscapedString('\\x48\\x65\\x6c\\x6c\\x6f')).toBe('Hello');
    });

    it('decodes \\uHHHH sequences', async () => {
      expect(base.testDecodeEscapedString('\\u0048\\u0065')).toBe('He');
    });

    it('decodes \\u{HHHH} sequences', async () => {
      expect(base.testDecodeEscapedString('\\u{1F600}')).toBe('\u{1F600}');
    });

    it('decodes control sequences', async () => {
      expect(base.testDecodeEscapedString('\\n')).toBe('\n');
      expect(base.testDecodeEscapedString('\\r')).toBe('\r');
      expect(base.testDecodeEscapedString('\\t')).toBe('\t');
      expect(base.testDecodeEscapedString('\\v')).toBe('\v');
      expect(base.testDecodeEscapedString('\\f')).toBe('\f');
      expect(base.testDecodeEscapedString('\\0')).toBe('\0');
    });

    it('decodes escaped quotes and backslashes', async () => {
      expect(base.testDecodeEscapedString('\\"')).toBe('"');
      expect(base.testDecodeEscapedString("\\\'")).toBe("'");
      expect(base.testDecodeEscapedString('\\\\')).toBe('\\');
    });
  });

  describe('isValidIdentifier', () => {
    it('accepts valid identifier syntax', async () => {
      expect(base.testIsValidIdentifier('foo')).toBe(true);
      expect(base.testIsValidIdentifier('_bar')).toBe(true);
      expect(base.testIsValidIdentifier('$baz')).toBe(true);
      expect(base.testIsValidIdentifier('a1')).toBe(true);
      expect(base.testIsValidIdentifier('class')).toBe(true);
    });

    it('rejects invalid identifier syntax', async () => {
      expect(base.testIsValidIdentifier('')).toBe(false);
      expect(base.testIsValidIdentifier('1foo')).toBe(false);
      expect(base.testIsValidIdentifier('foo-bar')).toBe(false);
    });
  });

  describe('parseTestInputs', () => {
    it('stringifies values and returns string array', async () => {
      expect(base.testParseTestInputs([1, 'a', true])).toEqual(['1', 'a', 'true']);
    });

    it('throws on empty arrays', async () => {
      expect(() => base.testParseTestInputs([])).toThrow('testInputs cannot be empty');
    });

    it('throws when input is not an array', async () => {
      expect(() => base.testParseTestInputs('nope' as any)).toThrow(
        'testInputs must be an array of strings',
      );
    });
  });
});
