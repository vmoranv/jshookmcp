import { describe, it, expect, beforeEach } from 'vitest';
import { SourcemapToolHandlersCommon } from '../../../../src/server/domains/sourcemap/handlers.impl.sourcemap-common';

// Expose protected methods for testing
class TestCommon extends SourcemapToolHandlersCommon {
  public testCombineSourceRoot(root: string | undefined, path: string) {
    return this.combineSourceRoot(root, path);
  }
  public testNormalizeSourcePath(path: string, index: number) {
    return this.normalizeSourcePath(path, index);
  }
  public testSanitizePathSegment(seg: string) {
    return this.sanitizePathSegment(seg);
  }
  public testSafeTarget(val: string) {
    return this.safeTarget(val);
  }
  public testHasProtocol(val: string) {
    return this.hasProtocol(val);
  }
  public testParseBooleanArg(val: unknown, def: boolean) {
    return this.parseBooleanArg(val, def);
  }
  public testRequiredStringArg(val: unknown, name: string) {
    return this.requiredStringArg(val, name);
  }
  public testOptionalStringArg(val: unknown) {
    return this.optionalStringArg(val);
  }
  public testAsRecord(val: unknown) {
    return this.asRecord(val);
  }
  public testAsString(val: unknown) {
    return this.asString(val);
  }
  public async testSafeDetach(s: any) {
    return this.safeDetach(s);
  }
  public async testTrySend(s: any, m: string, p?: any) {
    return this.trySend(s, m, p);
  }
  public async testDelay(ms: number) {
    return this.delay(ms);
  }
  public testJson(val: any) {
    return this.json(val);
  }
  public testFail(tool: string, err: any) {
    return this.fail(tool, err);
  }
}

describe('SourcemapToolHandlersCommon', () => {
  let handlers: TestCommon;

  beforeEach(() => {
    handlers = new TestCommon({} as any);
  });

  describe('combineSourceRoot', () => {
    it('returns path if no root', async () => {
      expect(handlers.testCombineSourceRoot(undefined, 'src/a.ts')).toBe('src/a.ts');
    });
    it('returns root if no path', async () => {
      expect(handlers.testCombineSourceRoot('http://root', '')).toBe('http://root');
    });
    it('returns right path if absolute', async () => {
      expect(handlers.testCombineSourceRoot('http://root', '/var/log')).toBe('/var/log');
      expect(handlers.testCombineSourceRoot('http://root', 'http://abs')).toBe('http://abs');
    });
    it('combines url root', async () => {
      expect(handlers.testCombineSourceRoot('http://root.com/sub', 'path')).toBe(
        'http://root.com/sub/path',
      );
      expect(handlers.testCombineSourceRoot('malformed://root', 'path')).toBe(
        'malformed://root/path',
      );
    });
    it('combines regular paths', async () => {
      expect(handlers.testCombineSourceRoot('root/', 'path')).toBe('root/path');
      expect(handlers.testCombineSourceRoot('root/', '/path')).toBe('/path');
    });
  });

  describe('normalizeSourcePath', () => {
    it('handles empty path', async () => {
      expect(handlers.testNormalizeSourcePath('', 0)).toBe('source_1.js');
    });
    it('strips webpack prefix', async () => {
      expect(handlers.testNormalizeSourcePath('webpack://src/a', 0)).toBe('src/a');
    });
    it('handles data-uris', async () => {
      expect(handlers.testNormalizeSourcePath('data:app/json', 0)).toBe('inline/source_1.txt');
    });
    it('handles URLs', async () => {
      expect(handlers.testNormalizeSourcePath('http://foo.com/bar.js', 0)).toBe('foo.com/bar.js');
      expect(handlers.testNormalizeSourcePath('invalid://foo.com', 0)).toBe('foo.com');
    });
    it('strips query strings', async () => {
      expect(handlers.testNormalizeSourcePath('foo.js?q=1#hash', 0)).toBe('foo.js');
    });
    it('strips windows drives', async () => {
      expect(handlers.testNormalizeSourcePath('C:\\foo\\bar', 0)).toBe('_/foo/bar');
    });
    it('sanitizes segments', async () => {
      expect(handlers.testNormalizeSourcePath('foo/../bar/./baz', 0)).toBe('foo/_/bar/_/baz');
      expect(handlers.testNormalizeSourcePath('...', 0)).toBe('...');
    });
  });

  describe('sanitizePathSegment', () => {
    it('replaces bad chars', async () => {
      expect(handlers.testSanitizePathSegment('foo<bar>baz\\qux')).toBe('foo_bar_baz\\qux');
      expect(handlers.testSanitizePathSegment('.')).toBe('_');
      expect(handlers.testSanitizePathSegment('..')).toBe('_');
    });
  });

  describe('safeTarget', () => {
    it('transforms url to safe target', async () => {
      expect(handlers.testSafeTarget('http://foo.com/bar')).toBe('foo_com_bar');
      expect(handlers.testSafeTarget('a_b++')).toBe('a_b');
    });
  });

  describe('arg parsers', () => {
    it('parseBooleanArg', async () => {
      expect(handlers.testParseBooleanArg(true, false)).toBe(true);
      expect(handlers.testParseBooleanArg('true', false)).toBe(false);
    });

    it('requiredStringArg', async () => {
      expect(handlers.testRequiredStringArg('val', 'name')).toBe('val');
      expect(() => handlers.testRequiredStringArg('', 'name')).toThrow('name is required');
      expect(() => handlers.testRequiredStringArg(null, 'name')).toThrow('name is required');
    });

    it('optionalStringArg', async () => {
      expect(handlers.testOptionalStringArg(' val ')).toBe('val');
      expect(handlers.testOptionalStringArg('')).toBe(undefined);
      expect(handlers.testOptionalStringArg(null)).toBe(undefined);
    });

    it('asRecord', async () => {
      expect(handlers.testAsRecord({ a: 1 })).toEqual({ a: 1 });
      expect(handlers.testAsRecord(null)).toEqual({});
      expect(handlers.testAsRecord('str')).toEqual({});
    });

    it('asString', async () => {
      expect(handlers.testAsString('str')).toBe('str');
      expect(handlers.testAsString(123)).toBe(undefined);
    });
  });

  describe('safeDetach', () => {
    it('handles missing detach', async () => {
      await expect(handlers.testSafeDetach({})).resolves.toBeUndefined();
    });
    it('handles explicit detach error', async () => {
      await expect(
        handlers.testSafeDetach({ detach: () => Promise.reject() }),
      ).resolves.toBeUndefined();
    });
    it('calls detach', async () => {
      let called = false;
      await handlers.testSafeDetach({
        detach: () => {
          called = true;
          return Promise.resolve();
        },
      });
      expect(called).toBe(true);
    });
  });

  describe('trySend', () => {
    it('recovers from reject', async () => {
      await expect(
        handlers.testTrySend({ send: () => Promise.reject() }, 'm'),
      ).resolves.toBeUndefined();
    });
    it('sends data', async () => {
      let sent = false;
      await handlers.testTrySend(
        {
          send: () => {
            sent = true;
            return Promise.resolve();
          },
        },
        'm',
      );
      expect(sent).toBe(true);
    });
  });

  describe('delay', () => {
    it('awaits', async () => {
      const wait = handlers.testDelay(1);
      await expect(wait).resolves.toBeUndefined();
    });
  });

  describe('responses', () => {
    it('json formats content', async () => {
      const res = handlers.testJson({ ok: true }) as any;
      expect(res.content[0].type).toBe('text');
      expect(res.content[0].text).toContain('"ok": true');
    });

    it('fail formats error', async () => {
      const res = handlers.testFail('tool', new Error('msg')) as any;
      expect(res.content[0].text).toContain('"tool": "tool"');
      expect(res.content[0].text).toContain('"error": "msg"');

      const res2 = handlers.testFail('tool', 'string msg') as any;
      expect(res2.content[0].text).toContain('"error": "string msg"');
    });
  });
});
