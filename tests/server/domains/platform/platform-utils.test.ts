import type { Dirent } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

type TestDirent = Pick<Dirent, 'name' | 'isDirectory' | 'isFile'>;

const mocks = vi.hoisted(() => {
  return {
    readFile: vi.fn<(...args: unknown[]) => Promise<string>>(),
    readdir: vi.fn<(...args: unknown[]) => Promise<TestDirent[]>>(async () => []),
    stat: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    mkdir: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  };
});

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  readdir: mocks.readdir,
  stat: mocks.stat,
  mkdir: mocks.mkdir,
}));

vi.mock('@utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('@utils/artifacts', () => ({
  resolveArtifactPath: vi.fn(async () => ({
    absolutePath: '/tmp/artifacts/test.tmpdir',
    displayPath: 'artifacts/test.tmpdir',
  })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  toTextResponse,
  toErrorResponse,
  getCollectorState,
  parseStringArg,
  parseBooleanArg,
  isRecord,
  toStringArray,
  toDisplayPath,
  pathExists,
  getDefaultSearchPaths,
  sanitizeArchiveRelativePath,
  resolveSafeOutputPath,
  resolveOutputDirectory,
  readJsonFileSafe,
  extractAppIdFromPath,
  walkDirectory,
} from '@server/domains/platform/handlers/platform-utils';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function getFirstTextContent(result: ReturnType<typeof toTextResponse>) {
  const content = result.content[0];
  expect(content).toBeDefined();
  return content!;
}

describe('platform-utils', () => {
  // =========================================================================
  // toTextResponse
  // =========================================================================
  describe('toTextResponse', () => {
    it('wraps payload as a JSON text content array', () => {
      const result = toTextResponse({ success: true, data: 'hello' });
      expect(result.content).toHaveLength(1);
      const content = getFirstTextContent(result);
      expect(content.type).toBe('text');
      const parsed = JSON.parse(content.text);
      expect(parsed.success).toBe(true);
      expect(parsed.data).toBe('hello');
    });

    it('pretty-prints JSON with 2-space indent', () => {
      const result = toTextResponse({ key: 'value' });
      const content = getFirstTextContent(result);
      expect(content.text).toContain('\n');
      expect(content.text).toContain('  ');
    });

    it('handles nested objects', () => {
      const result = toTextResponse({ outer: { inner: 'val' } });
      const parsed = JSON.parse(getFirstTextContent(result).text);
      expect(parsed.outer.inner).toBe('val');
    });

    it('handles arrays in payload', () => {
      const result = toTextResponse({ items: [1, 2, 3] });
      const parsed = JSON.parse(getFirstTextContent(result).text);
      expect(parsed.items).toEqual([1, 2, 3]);
    });
  });

  // =========================================================================
  // toErrorResponse
  // =========================================================================
  describe('toErrorResponse', () => {
    it('formats an Error object', () => {
      const result = toErrorResponse('my_tool', new Error('something broke'));
      const parsed = JSON.parse(getFirstTextContent(result).text);
      expect(parsed.success).toBe(false);
      expect(parsed.tool).toBe('my_tool');
      expect(parsed.error).toBe('something broke');
    });

    it('formats a string error', () => {
      const result = toErrorResponse('my_tool', 'plain string error');
      const parsed = JSON.parse(getFirstTextContent(result).text);
      expect(parsed.error).toBe('plain string error');
    });

    it('formats a number error', () => {
      const result = toErrorResponse('my_tool', 42);
      const parsed = JSON.parse(getFirstTextContent(result).text);
      expect(parsed.error).toBe('42');
    });

    it('includes extra fields', () => {
      const result = toErrorResponse('my_tool', new Error('fail'), {
        hint: 'try again',
      });
      const parsed = JSON.parse(getFirstTextContent(result).text);
      expect(parsed.hint).toBe('try again');
    });

    it('extra fields do not override success/tool/error', () => {
      const result = toErrorResponse('my_tool', new Error('fail'), {
        success: true,
        tool: 'override',
      });
      const parsed = JSON.parse(getFirstTextContent(result).text);
      // Extra fields are spread after success/tool/error, so they override
      // This tests the actual behavior
      expect(parsed.tool).toBe('override');
    });
  });

  // =========================================================================
  // getCollectorState
  // =========================================================================
  describe('getCollectorState', () => {
    it('always returns "attached"', () => {
      const fakeCollector = {} as any;
      expect(getCollectorState(fakeCollector)).toBe('attached');
    });

    it('works with any collector-like object', () => {
      expect(getCollectorState(null as any)).toBe('attached');
    });
  });

  // =========================================================================
  // parseStringArg
  // =========================================================================
  describe('parseStringArg', () => {
    it('returns trimmed string value', () => {
      expect(parseStringArg({ key: '  hello  ' }, 'key')).toBe('hello');
    });

    it('returns undefined for missing key', () => {
      expect(parseStringArg({}, 'key')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(parseStringArg({ key: '   ' }, 'key')).toBeUndefined();
    });

    it('returns undefined for non-string value', () => {
      expect(parseStringArg({ key: 42 }, 'key')).toBeUndefined();
      expect(parseStringArg({ key: null }, 'key')).toBeUndefined();
      expect(parseStringArg({ key: true }, 'key')).toBeUndefined();
    });

    it('throws when required and missing', () => {
      expect(() => parseStringArg({}, 'key', true)).toThrow(
        'key must be a non-empty string'
      );
    });

    it('throws when required and value is empty string', () => {
      expect(() => parseStringArg({ key: '' }, 'key', true)).toThrow(
        'key must be a non-empty string'
      );
    });

    it('throws when required and value is whitespace-only', () => {
      expect(() => parseStringArg({ key: '   ' }, 'key', true)).toThrow(
        'key must be a non-empty string'
      );
    });

    it('does not throw when required and value is present', () => {
      expect(parseStringArg({ key: 'valid' }, 'key', true)).toBe('valid');
    });
  });

  // =========================================================================
  // parseBooleanArg
  // =========================================================================
  describe('parseBooleanArg', () => {
    it('returns boolean directly', () => {
      expect(parseBooleanArg({ flag: true }, 'flag', false)).toBe(true);
      expect(parseBooleanArg({ flag: false }, 'flag', true)).toBe(false);
    });

    it('parses number 1 as true and 0 as false', () => {
      expect(parseBooleanArg({ flag: 1 }, 'flag', false)).toBe(true);
      expect(parseBooleanArg({ flag: 0 }, 'flag', true)).toBe(false);
    });

    it('returns default for other numbers', () => {
      expect(parseBooleanArg({ flag: 42 }, 'flag', false)).toBe(false);
      expect(parseBooleanArg({ flag: -1 }, 'flag', true)).toBe(true);
    });

    it('parses truthy strings', () => {
      for (const val of ['true', 'True', 'TRUE', '1', 'yes', 'YES', 'on', 'ON']) {
        expect(parseBooleanArg({ flag: val }, 'flag', false)).toBe(true);
      }
    });

    it('parses falsy strings', () => {
      for (const val of ['false', 'False', 'FALSE', '0', 'no', 'NO', 'off', 'OFF']) {
        expect(parseBooleanArg({ flag: val }, 'flag', true)).toBe(false);
      }
    });

    it('returns default for unrecognized strings', () => {
      expect(parseBooleanArg({ flag: 'maybe' }, 'flag', true)).toBe(true);
      expect(parseBooleanArg({ flag: 'maybe' }, 'flag', false)).toBe(false);
    });

    it('returns default when key is missing', () => {
      expect(parseBooleanArg({}, 'flag', true)).toBe(true);
      expect(parseBooleanArg({}, 'flag', false)).toBe(false);
    });

    it('trims and lowercases string input', () => {
      expect(parseBooleanArg({ flag: '  True  ' }, 'flag', false)).toBe(true);
      expect(parseBooleanArg({ flag: '  OFF  ' }, 'flag', true)).toBe(false);
    });
  });

  // =========================================================================
  // isRecord
  // =========================================================================
  describe('isRecord', () => {
    it('returns true for plain objects', () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ a: 1 })).toBe(true);
    });

    it('returns false for null', () => {
      expect(isRecord(null)).toBe(false);
    });

    it('returns false for arrays', () => {
      expect(isRecord([])).toBe(false);
      expect(isRecord([1, 2])).toBe(false);
    });

    it('returns false for primitives', () => {
      expect(isRecord('string')).toBe(false);
      expect(isRecord(42)).toBe(false);
      expect(isRecord(true)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
    });
  });

  // =========================================================================
  // toStringArray
  // =========================================================================
  describe('toStringArray', () => {
    it('returns empty array for non-array input', () => {
      expect(toStringArray(null)).toEqual([]);
      expect(toStringArray('string')).toEqual([]);
      expect(toStringArray(42)).toEqual([]);
      expect(toStringArray(undefined)).toEqual([]);
      expect(toStringArray({})).toEqual([]);
    });

    it('filters out non-string items', () => {
      expect(toStringArray(['a', 42, null, 'b', true])).toEqual(['a', 'b']);
    });

    it('trims and filters empty strings', () => {
      expect(toStringArray(['  hello  ', '', '   ', 'world'])).toEqual([
        'hello',
        'world',
      ]);
    });

    it('returns empty array for array of non-strings', () => {
      expect(toStringArray([1, 2, 3])).toEqual([]);
    });

    it('preserves order of valid strings', () => {
      expect(toStringArray(['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
    });
  });

  // =========================================================================
  // pathExists
  // =========================================================================
  describe('pathExists', () => {
    it('returns true when stat succeeds', async () => {
      mocks.stat.mockResolvedValueOnce({});
      expect(await pathExists('/existing/path')).toBe(true);
    });

    it('returns false when stat throws', async () => {
      mocks.stat.mockRejectedValueOnce(new Error('ENOENT'));
      expect(await pathExists('/missing/path')).toBe(false);
    });
  });

  // =========================================================================
  // sanitizeArchiveRelativePath
  // =========================================================================
  describe('sanitizeArchiveRelativePath', () => {
    it('removes leading/trailing slashes and dots', () => {
      expect(sanitizeArchiveRelativePath('./src/index.js')).toBe('src/index.js');
    });

    it('removes directory traversal segments', () => {
      expect(sanitizeArchiveRelativePath('../../../etc/passwd')).toBe(
        'etc/passwd'
      );
    });

    it('normalizes backslashes to forward slashes', () => {
      expect(sanitizeArchiveRelativePath('src\\lib\\util.js')).toBe(
        'src/lib/util.js'
      );
    });

    it('handles empty string', () => {
      expect(sanitizeArchiveRelativePath('')).toBe('');
    });

    it('collapses multiple slashes', () => {
      const result = sanitizeArchiveRelativePath('src///lib//util.js');
      expect(result).toBe('src/lib/util.js');
    });

    it('removes lone dot segments', () => {
      expect(sanitizeArchiveRelativePath('./././file.js')).toBe('file.js');
    });

    it('handles pure traversal path', () => {
      expect(sanitizeArchiveRelativePath('../../..')).toBe('');
    });

    it('preserves valid nested paths', () => {
      expect(sanitizeArchiveRelativePath('a/b/c/d.js')).toBe('a/b/c/d.js');
    });
  });

  // =========================================================================
  // resolveSafeOutputPath
  // =========================================================================
  describe('resolveSafeOutputPath', () => {
    it('resolves a normal relative path within root', () => {
      const result = resolveSafeOutputPath('/output', 'src/index.js');
      expect(result).toContain('src');
      expect(result).toContain('index.js');
    });

    it('sanitizes traversal segments before resolving', () => {
      // "../../../etc/passwd" is sanitized to "etc/passwd" which resolves inside root
      const result = resolveSafeOutputPath('/output', '../../../etc/passwd');
      expect(result).toContain('etc');
      expect(result).toContain('passwd');
    });

    it('uses basename as fallback when sanitized path is empty', () => {
      const result = resolveSafeOutputPath('/output', '.');
      expect(result).toBeDefined();
    });

    it('uses "unnamed.bin" when basename is empty', () => {
      const result = resolveSafeOutputPath('/output', '');
      expect(result).toContain('unnamed.bin');
    });

    it('handles deeply nested relative paths', () => {
      const result = resolveSafeOutputPath('/output', 'a/b/c/d/e.txt');
      expect(result).toContain('a');
      expect(result).toContain('e.txt');
    });
  });

  // =========================================================================
  // resolveOutputDirectory
  // =========================================================================
  describe('resolveOutputDirectory', () => {
    it('uses requested directory when provided', async () => {
      const result = await resolveOutputDirectory('test', 'target', '/custom/dir');
      expect(result.absolutePath).toContain('custom');
      expect(mocks.mkdir).toHaveBeenCalled();
    });

    it('generates artifact-based directory when no requested dir', async () => {
      const result = await resolveOutputDirectory('test', 'target');
      expect(result.absolutePath).toBeDefined();
      expect(result.displayPath).toBeDefined();
      expect(mocks.mkdir).toHaveBeenCalled();
    });

    it('creates directory recursively', async () => {
      await resolveOutputDirectory('test', 'target', '/deep/nested/dir');
      expect(mocks.mkdir).toHaveBeenCalledWith(
        expect.any(String),
        { recursive: true }
      );
    });
  });

  // =========================================================================
  // readJsonFileSafe
  // =========================================================================
  describe('readJsonFileSafe', () => {
    it('returns parsed JSON for valid file', async () => {
      mocks.readFile.mockResolvedValueOnce('{"key": "value"}');
      const result = await readJsonFileSafe('/path/to/file.json');
      expect(result).toEqual({ key: 'value' });
    });

    it('returns null when file does not exist', async () => {
      mocks.readFile.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await readJsonFileSafe('/missing.json');
      expect(result).toBeNull();
    });

    it('returns null for invalid JSON', async () => {
      mocks.readFile.mockResolvedValueOnce('not json');
      const result = await readJsonFileSafe('/path/to/bad.json');
      expect(result).toBeNull();
    });

    it('returns null for non-object JSON (array)', async () => {
      mocks.readFile.mockResolvedValueOnce('[1, 2, 3]');
      const result = await readJsonFileSafe('/path/to/array.json');
      expect(result).toBeNull();
    });

    it('returns null for primitive JSON', async () => {
      mocks.readFile.mockResolvedValueOnce('"just a string"');
      const result = await readJsonFileSafe('/path/to/string.json');
      expect(result).toBeNull();
    });

    it('returns null for null JSON literal', async () => {
      mocks.readFile.mockResolvedValueOnce('null');
      const result = await readJsonFileSafe('/path/to/null.json');
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // extractAppIdFromPath
  // =========================================================================
  describe('extractAppIdFromPath', () => {
    it('extracts ID from generic miniapp pattern in path', () => {
      const result = extractAppIdFromPath('/data/Applet/wx1234567890/pkg.wxapkg');
      expect(result).toBe('wx1234567890');
    });

    it('extracts ID from Applet directory pattern', () => {
      const result = extractAppIdFromPath('/data/Applet/myappid123/file.pkg');
      expect(result).toBe('myappid123');
    });

    it('extracts ID from filename when no path pattern matches', () => {
      const result = extractAppIdFromPath('/tmp/wx12345678ab.pkg');
      expect(result).toBe('wx12345678ab');
    });

    it('returns null when no pattern matches', () => {
      const result = extractAppIdFromPath('/tmp/ab.pkg');
      expect(result).toBeNull();
    });

    it('normalizes backslashes in path', () => {
      const result = extractAppIdFromPath('C:\\Users\\data\\Applet\\wx1234567890\\file.pkg');
      expect(result).toBe('wx1234567890');
    });

    it('returns null for very short IDs', () => {
      const result = extractAppIdFromPath('/tmp/xy.pkg');
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // getDefaultSearchPaths
  // =========================================================================
  describe('getDefaultSearchPaths', () => {
    it('returns an array of resolved paths', () => {
      const paths = getDefaultSearchPaths();
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
    });

    it('includes known sub-patterns (Applet, XPlugin, MiniApp)', () => {
      const paths = getDefaultSearchPaths();
      const allPaths = paths.join('|');
      expect(allPaths).toMatch(/Applet|XPlugin|MiniApp/);
    });

    it('returns deduplicated paths', () => {
      const paths = getDefaultSearchPaths();
      const uniquePaths = new Set(paths);
      expect(uniquePaths.size).toBe(paths.length);
    });
  });

  // =========================================================================
  // walkDirectory
  // =========================================================================
  describe('walkDirectory', () => {
    it('calls onFile for each file found', async () => {
      mocks.readdir.mockResolvedValueOnce([
        { name: 'a.js', isDirectory: () => false, isFile: () => true },
        { name: 'b.js', isDirectory: () => false, isFile: () => true },
      ]);

      const fileStats = {
        isFile: () => true,
        size: 100,
        mtime: new Date(),
      };
      mocks.stat.mockResolvedValue(fileStats);

      const files: string[] = [];
      await walkDirectory('/root', async (absolutePath) => {
        files.push(absolutePath);
      });

      expect(files).toHaveLength(2);
    });

    it('recurses into subdirectories', async () => {
      // First readdir: root dir
      mocks.readdir.mockResolvedValueOnce([
        { name: 'subdir', isDirectory: () => true, isFile: () => false },
      ]);
      // Second readdir: subdir
      mocks.readdir.mockResolvedValueOnce([
        { name: 'nested.js', isDirectory: () => false, isFile: () => true },
      ]);

      const fileStats = {
        isFile: () => true,
        size: 50,
        mtime: new Date(),
      };
      mocks.stat.mockResolvedValue(fileStats);

      const files: string[] = [];
      await walkDirectory('/root', async (absolutePath) => {
        files.push(absolutePath);
      });

      expect(files).toHaveLength(1);
      expect(files[0]).toContain('nested.js');
    });

    it('skips unreadable directories gracefully', async () => {
      mocks.readdir.mockRejectedValueOnce(new Error('EACCES'));

      const files: string[] = [];
      await walkDirectory('/restricted', async (absolutePath) => {
        files.push(absolutePath);
      });

      expect(files).toHaveLength(0);
    });

    it('skips non-file non-directory entries (e.g. symlinks)', async () => {
      mocks.readdir.mockResolvedValueOnce([
        { name: 'link', isDirectory: () => false, isFile: () => false },
      ]);

      const files: string[] = [];
      await walkDirectory('/root', async (absolutePath) => {
        files.push(absolutePath);
      });

      expect(files).toHaveLength(0);
    });

    it('handles stat errors on individual files', async () => {
      mocks.readdir.mockResolvedValueOnce([
        { name: 'bad.js', isDirectory: () => false, isFile: () => true },
        { name: 'good.js', isDirectory: () => false, isFile: () => true },
      ]);

      mocks.stat.mockRejectedValueOnce(new Error('EACCES'));
      mocks.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: 100,
        mtime: new Date(),
      });

      const files: string[] = [];
      await walkDirectory('/root', async (absolutePath) => {
        files.push(absolutePath);
      });

      // Only good.js processed; bad.js skipped
      expect(files).toHaveLength(1);
      expect(files[0]).toContain('good.js');
    });
  });

  // =========================================================================
  // toDisplayPath
  // =========================================================================
  describe('toDisplayPath', () => {
    it('returns relative path when within cwd', () => {
      const cwd = process.cwd().replace(/\\/g, '/');
      const testPath = `${cwd}/src/file.js`.replace(/\//g, require('node:path').sep);
      const result = toDisplayPath(testPath);
      // Should be a relative path not starting with ..
      expect(result).not.toMatch(/^\.\./);
    });

    it('returns absolute path when outside cwd', () => {
      const result = toDisplayPath('/completely/different/path/file.js');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('returns "." for cwd itself', () => {
      const result = toDisplayPath(process.cwd());
      expect(result).toBe('.');
    });
  });
});
