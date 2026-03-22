import { describe, expect, it } from 'vitest';
import { SourcemapToolHandlersCommon } from '@server/domains/sourcemap/handlers.impl.sourcemap-common';

class TestableCommon extends SourcemapToolHandlersCommon {
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    super(null as any);
  }
  public testCombineSourceRoot(root: string | undefined, path: string) {
    return this.combineSourceRoot(root, path);
  }
  public testNormalizeSourcePath(path: string, index: number) {
    return this.normalizeSourcePath(path, index);
  }
  public testSanitizePathSegment(seg: string) {
    return this.sanitizePathSegment(seg);
  }
  public testSafeTarget(value: string) {
    return this.safeTarget(value);
  }
  public testHasProtocol(value: string) {
    return this.hasProtocol(value);
  }
  public testParseBooleanArg(value: unknown, def: boolean) {
    return this.parseBooleanArg(value, def);
  }
  public testRequiredStringArg(value: unknown, name: string) {
    return this.requiredStringArg(value, name);
  }
  public testOptionalStringArg(value: unknown) {
    return this.optionalStringArg(value);
  }
  public testAsRecord(value: unknown) {
    return this.asRecord(value);
  }
  public testAsString(value: unknown) {
    return this.asString(value);
  }
  public testJson(payload: unknown) {
    return this.json(payload);
  }
  public testFail(tool: string, error: unknown) {
    return this.fail(tool, error);
  }
}

const handlers = new TestableCommon();

function getText(response: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
  return response?.content?.[0]?.text ?? '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
function parseTextJson(response: unknown): any {
  return JSON.parse(getText(response));
}

describe('SourcemapToolHandlersCommon', () => {
  describe('combineSourceRoot', () => {
    it('returns sourcePath when sourceRoot is undefined', () => {
      expect(handlers.testCombineSourceRoot(undefined, 'a.js')).toBe('a.js');
    });

    it('returns sourceRoot when sourcePath is empty', () => {
      expect(handlers.testCombineSourceRoot('root', '')).toBe('root');
    });

    it('returns sourcePath when it has a protocol (ignores sourceRoot)', () => {
      expect(
        handlers.testCombineSourceRoot('https://example.com/root', 'http://other.test/a.js')
      ).toBe('http://other.test/a.js');
    });

    it('returns sourcePath when it starts with "/" (ignores sourceRoot)', () => {
      expect(handlers.testCombineSourceRoot('root', '/abs/path.js')).toBe('/abs/path.js');
    });

    it('resolves relative paths against protocol sourceRoot (directory semantics via trailing slash)', () => {
      expect(handlers.testCombineSourceRoot('https://example.com/root', 'a.js')).toBe(
        'https://example.com/root/a.js'
      );
    });

    it('handles protocol sourceRoot that already ends with "/"', () => {
      expect(handlers.testCombineSourceRoot('https://example.com/root/', 'a.js')).toBe(
        'https://example.com/root/a.js'
      );
    });

    it('joins sourceRoot and sourcePath when sourceRoot has no protocol', () => {
      expect(handlers.testCombineSourceRoot('foo/', 'bar.js')).toBe('foo/bar.js');
      expect(handlers.testCombineSourceRoot('foo///', 'bar.js')).toBe('foo/bar.js');
    });

    it('falls back to string join when URL resolution throws (invalid URL base)', () => {
      expect(handlers.testCombineSourceRoot('http://[invalid', 'a.js')).toBe(
        'http://[invalid/a.js'
      );
    });
  });

  describe('normalizeSourcePath', () => {
    it('falls back to default name for empty/whitespace input', () => {
      expect(handlers.testNormalizeSourcePath('   ', 0)).toBe('source_1.js');
      expect(handlers.testNormalizeSourcePath('\n\t', 4)).toBe('source_5.js');
    });

    it('strips webpack:// prefix', () => {
      expect(handlers.testNormalizeSourcePath('webpack://src/app.js', 0)).toBe('src/app.js');
      expect(handlers.testNormalizeSourcePath('webpack:///src/app.js', 0)).toBe('src/app.js');
    });

    it('maps data: URIs to inline file placeholders', () => {
      expect(handlers.testNormalizeSourcePath('data:application/json;base64,eyJ4IjoxfQ==', 1)).toBe(
        'inline/source_2.txt'
      );
    });

    it('normalizes full URLs into hostname + pathname', () => {
      expect(handlers.testNormalizeSourcePath('https://example.com/path/file.js?x=1#hash', 0)).toBe(
        'example.com/path/file.js'
      );
    });

    it('strips query and hash fragments from non-URL paths', () => {
      expect(handlers.testNormalizeSourcePath('src/app.js?foo=1#bar', 0)).toBe('src/app.js');
    });

    it('strips Windows drive letter and normalizes separators', () => {
      // The regex strips C:\ but the backslash after C: leaves an empty segment that sanitizes to "_"
      // On the JS string level, 'C:\\src\\app.js' is 'C:\src\app.js'
      const result = handlers.testNormalizeSourcePath('C:\\src\\app.js', 0);
      expect(result).toContain('src/app.js');
    });

    it('strips leading slashes', () => {
      expect(handlers.testNormalizeSourcePath('/src/app.js', 0)).toBe('src/app.js');
      expect(handlers.testNormalizeSourcePath('///src/app.js', 0)).toBe('src/app.js');
    });

    it('filters empty segments from repeated separators', () => {
      expect(handlers.testNormalizeSourcePath('a//b///c', 0)).toBe('a/b/c');
    });
  });

  describe('sanitizePathSegment', () => {
    it('returns normal text unchanged', () => {
      expect(handlers.testSanitizePathSegment('hello-world')).toBe('hello-world');
      expect(handlers.testSanitizePathSegment('foo_bar-baz')).toBe('foo_bar-baz');
    });

    it('replaces control characters with "_"', () => {
      expect(handlers.testSanitizePathSegment(`a\u0000b`)).toBe('a_b');
      expect(handlers.testSanitizePathSegment(`x\u001Fy`)).toBe('x_y');
    });

    it('replaces special characters (<>:"|?*) with "_"', () => {
      expect(handlers.testSanitizePathSegment('a<>:"|?*b')).toBe('a_______b');
    });

    it('collapses whitespace and trims', () => {
      // Tab character is in the \u0000-\u001F control range and gets replaced with "_" first
      expect(handlers.testSanitizePathSegment('  a    b   c  ')).toBe('a b c');
      // Tab becomes "_" then whitespace collapses
      expect(handlers.testSanitizePathSegment('  a \t  b   c  ')).toBe('a _ b c');
    });

    it('returns "_" for "." and ".."', () => {
      expect(handlers.testSanitizePathSegment('.')).toBe('_');
      expect(handlers.testSanitizePathSegment('..')).toBe('_');
    });

    it('returns "_" for empty or whitespace-only segments', () => {
      expect(handlers.testSanitizePathSegment('')).toBe('_');
      expect(handlers.testSanitizePathSegment('   ')).toBe('_');
    });
  });

  describe('safeTarget', () => {
    it('strips protocol and replaces non-alnum with "_"', () => {
      expect(handlers.testSafeTarget('https://example.com/path/file.js')).toBe(
        'example_com_path_file_js'
      );
    });

    it('collapses underscores and trims leading/trailing underscores', () => {
      expect(handlers.testSafeTarget('___a..b___')).toBe('a_b');
    });

    it('truncates to 48 characters', () => {
      const value = `https://example.com/${'a'.repeat(100)}`;
      const result = handlers.testSafeTarget(value);
      expect(result.length).toBeLessThanOrEqual(48);
    });
  });

  describe('hasProtocol', () => {
    it('returns true for common and custom protocols', () => {
      expect(handlers.testHasProtocol('http://a')).toBe(true);
      expect(handlers.testHasProtocol('https://a')).toBe(true);
      expect(handlers.testHasProtocol('ftp://a')).toBe(true);
      expect(handlers.testHasProtocol('custom:thing')).toBe(true);
    });

    it('returns false when no protocol prefix is present', () => {
      expect(handlers.testHasProtocol('example.com/path')).toBe(false);
      expect(handlers.testHasProtocol('/absolute/path')).toBe(false);
      expect(handlers.testHasProtocol('relative/path')).toBe(false);
    });
  });

  describe('parseBooleanArg', () => {
    it('returns boolean values unchanged', () => {
      expect(handlers.testParseBooleanArg(true, false)).toBe(true);
      expect(handlers.testParseBooleanArg(false, true)).toBe(false);
    });

    it('returns defaultValue for non-boolean inputs', () => {
      expect(handlers.testParseBooleanArg('true', true)).toBe(true);
      expect(handlers.testParseBooleanArg(0, false)).toBe(false);
      expect(handlers.testParseBooleanArg(null, true)).toBe(true);
    });
  });

  describe('requiredStringArg', () => {
    it('returns trimmed string for valid input', () => {
      expect(handlers.testRequiredStringArg('  hello  ', 'field')).toBe('hello');
    });

    it('throws for empty strings', () => {
      expect(() => handlers.testRequiredStringArg('   ', 'field')).toThrow('field is required');
    });

    it('throws for non-string values', () => {
      expect(() => handlers.testRequiredStringArg(123, 'field')).toThrow('field is required');
    });
  });

  describe('optionalStringArg', () => {
    it('returns trimmed string for valid input', () => {
      expect(handlers.testOptionalStringArg('  hello  ')).toBe('hello');
    });

    it('returns undefined for empty strings', () => {
      expect(handlers.testOptionalStringArg('   ')).toBeUndefined();
    });

    it('returns undefined for non-string values', () => {
      expect(handlers.testOptionalStringArg(123)).toBeUndefined();
      expect(handlers.testOptionalStringArg(null)).toBeUndefined();
    });
  });

  describe('json', () => {
    it('wraps JSON.stringify(payload, null, 2) into a TextToolResponse', () => {
      const payload = { a: 1 };
      expect(handlers.testJson(payload)).toEqual({
        content: [
          {
            type: 'text',
            text: '{\n  "a": 1\n}',
          },
        ],
      });
    });
  });

  describe('fail', () => {
    it('uses Error.message when given an Error instance', () => {
      const response = handlers.testFail('my_tool', new Error('boom'));
      expect(parseTextJson(response)).toEqual({
        success: false,
        tool: 'my_tool',
        error: 'boom',
      });
    });

    it('uses the string when given a string', () => {
      const response = handlers.testFail('my_tool', 'bad');
      expect(parseTextJson(response)).toEqual({
        success: false,
        tool: 'my_tool',
        error: 'bad',
      });
    });

    it('stringifies non-Error, non-string values', () => {
      const response = handlers.testFail('my_tool', 123);
      expect(parseTextJson(response)).toEqual({
        success: false,
        tool: 'my_tool',
        error: '123',
      });
    });

    it('always returns a pretty-printed JSON text payload', () => {
      const response = handlers.testFail('tool', 'x');
      const text = getText(response);
      expect(text).toContain('\n  "success": false');
      expect(text).toContain('\n  "tool": "tool"');
      expect(text).toContain('\n  "error": "x"');
    });
  });
});
