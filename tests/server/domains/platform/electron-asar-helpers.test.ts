import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
vi.mock('@utils/logger', () => ({
  logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
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
  flattenAsarEntries,
  isAsarDataOffsetValid,
  parseAsarBuffer,
  readAsarEntryBuffer,
  readAsarEntryText,
  parseBrowserWindowHints,
} from '@server/domains/platform/handlers/electron-asar-helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid ASAR buffer from a header JSON object.
 * Layout: [headerSize:u32le][headerStringSize:u32le][headerContentSize:u32le][padding:u32le][headerJSON][data...]
 */
function buildAsarBuffer(
  headerObject: Record<string, unknown>,
  fileDataChunks: Buffer[] = [],
): Buffer {
  const headerJson = JSON.stringify(headerObject);
  const headerBuf = Buffer.from(headerJson, 'utf-8');
  const headerLength = headerBuf.length;
  const padding = 0;

  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(headerLength + 8, 0); // headerSize
  prefix.writeUInt32LE(headerLength + 4, 4); // headerStringSize
  prefix.writeUInt32LE(headerLength, 8); // headerContentSize
  prefix.writeUInt32LE(padding, 12); // padding

  const dataBuf = fileDataChunks.length > 0 ? Buffer.concat(fileDataChunks) : Buffer.alloc(0);
  return Buffer.concat([prefix, headerBuf, dataBuf]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('electron-asar-helpers', () => {
  // =========================================================================
  // flattenAsarEntries
  // =========================================================================
  describe('flattenAsarEntries', () => {
    it('returns empty array when no "files" key exists', () => {
      expect(flattenAsarEntries({})).toEqual([]);
    });

    it('returns empty array when "files" is not a record', () => {
      expect(flattenAsarEntries({ files: 'not_a_record' })).toEqual([]);
      expect(flattenAsarEntries({ files: 42 })).toEqual([]);
      expect(flattenAsarEntries({ files: null })).toEqual([]);
    });

    it('flattens a single-level file tree', () => {
      const header = {
        files: {
          'index.js': { size: 100, offset: '0' },
          'package.json': { size: 50, offset: '100' },
        },
      };

      const entries = flattenAsarEntries(header);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.path).toSorted()).toEqual(['index.js', 'package.json']);
    });

    it('flattens nested directory structures', () => {
      const header = {
        files: {
          src: {
            files: {
              'app.js': { size: 200, offset: 0 },
              lib: {
                files: {
                  'util.js': { size: 80, offset: 200 },
                },
              },
            },
          },
          'main.js': { size: 50, offset: 280 },
        },
      };

      const entries = flattenAsarEntries(header);
      expect(entries).toHaveLength(3);
      expect(entries.map((e) => e.path).toSorted()).toEqual([
        'main.js',
        'src/app.js',
        'src/lib/util.js',
      ]);
    });

    it('handles unpacked entries correctly', () => {
      const header = {
        files: {
          'native.node': { size: 500, offset: 0, unpacked: true },
          'index.js': { size: 100, offset: 0, unpacked: false },
        },
      };

      const entries = flattenAsarEntries(header);
      const nativeEntry = entries.find((e) => e.path === 'native.node');
      const jsEntry = entries.find((e) => e.path === 'index.js');
      expect(nativeEntry?.unpacked).toBe(true);
      expect(jsEntry?.unpacked).toBe(false);
    });

    it('defaults size to 0 when not a valid finite number', () => {
      const header = {
        files: {
          'bad.js': { offset: 0, size: 'invalid' },
          'negative.js': { offset: 0, size: -10 },
          'inf.js': { offset: 0, size: Infinity },
        },
      };

      const entries = flattenAsarEntries(header);
      for (const entry of entries) {
        expect(entry.size).toBe(0);
      }
    });

    it('parses offset from string representations', () => {
      const header = {
        files: {
          'file.js': { size: 10, offset: '42' },
        },
      };

      const entries = flattenAsarEntries(header);
      expect(entries[0]!.offset).toBe(42);
    });

    it('defaults offset to 0 for invalid values', () => {
      const header = {
        files: {
          'file.js': { size: 10, offset: 'not_a_number' },
        },
      };

      const entries = flattenAsarEntries(header);
      expect(entries[0]!.offset).toBe(0);
    });

    it('skips non-record entries in files', () => {
      const header = {
        files: {
          'valid.js': { size: 10, offset: 0 },
          badEntry: null,
          anotherBad: 'string',
          numberEntry: 42,
        },
      };

      const entries = flattenAsarEntries(header);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.path).toBe('valid.js');
    });
  });

  // =========================================================================
  // isAsarDataOffsetValid
  // =========================================================================
  describe('isAsarDataOffsetValid', () => {
    it('returns true when all samples are within bounds', () => {
      const files = [
        { path: 'a.js', size: 10, offset: 0, unpacked: false },
        { path: 'b.js', size: 20, offset: 10, unpacked: false },
      ];
      // dataOffset=100, totalSize should be >= 100+10+20=130
      expect(isAsarDataOffsetValid(files, 100, 200)).toBe(true);
    });

    it('returns false when an entry extends beyond total size', () => {
      const files = [{ path: 'a.js', size: 500, offset: 0, unpacked: false }];
      expect(isAsarDataOffsetValid(files, 100, 200)).toBe(false);
    });

    it('returns false when start is negative', () => {
      const files = [{ path: 'a.js', size: 10, offset: 0, unpacked: false }];
      expect(isAsarDataOffsetValid(files, -10, 200)).toBe(false);
    });

    it('skips unpacked entries during validation', () => {
      const files = [
        { path: 'native.node', size: 99999, offset: 0, unpacked: true },
        { path: 'index.js', size: 10, offset: 0, unpacked: false },
      ];
      // Only index.js is checked; native.node is unpacked so skipped
      expect(isAsarDataOffsetValid(files, 50, 100)).toBe(true);
    });

    it('only checks first 32 packed samples', () => {
      const files = Array.from({ length: 50 }, (_, i) => ({
        path: `file${i}.js`,
        size: 1,
        offset: i,
        unpacked: false,
      }));
      // All offsets are small and within bounds
      expect(isAsarDataOffsetValid(files, 0, 1000)).toBe(true);
    });

    it('returns true for empty file list', () => {
      expect(isAsarDataOffsetValid([], 100, 200)).toBe(true);
    });
  });

  // =========================================================================
  // parseAsarBuffer
  // =========================================================================
  describe('parseAsarBuffer', () => {
    it('throws on buffers smaller than 16 bytes', () => {
      const tinyBuf = Buffer.alloc(10);
      expect(() => parseAsarBuffer(tinyBuf)).toThrow('file too small');
    });

    it('throws when header JSON cannot be parsed', () => {
      const buf = Buffer.alloc(32);
      buf.writeUInt32LE(20, 0); // headerSize
      buf.writeUInt32LE(10, 4); // headerStringSize
      buf.writeUInt32LE(8, 8); // headerContentSize
      buf.writeUInt32LE(0, 12); // padding
      // Write invalid JSON at position 16
      buf.write('not json', 16);

      expect(() => parseAsarBuffer(buf)).toThrow('cannot parse header JSON');
    });

    it('parses a valid ASAR buffer with files', () => {
      const header = {
        files: {
          'index.js': { size: 5, offset: '0' },
          'readme.txt': { size: 3, offset: '5' },
        },
      };

      const fileData = Buffer.from('helloabc');
      const asarBuf = buildAsarBuffer(header, [fileData]);
      const parsed = parseAsarBuffer(asarBuf);

      expect(parsed.files).toHaveLength(2);
      expect(parsed.files.map((f) => f.path).toSorted()).toEqual(['index.js', 'readme.txt']);
      expect(parsed.headerSize).toBeGreaterThan(0);
    });

    it('handles header without explicit "files" key (auto-wraps)', () => {
      // Some ASAR implementations put entries directly without a "files" wrapper
      const header = {
        'main.js': { size: 10, offset: 0 },
      };

      const asarBuf = buildAsarBuffer(header, [Buffer.alloc(10)]);
      const parsed = parseAsarBuffer(asarBuf);

      expect(parsed.files).toHaveLength(1);
      expect(parsed.files[0]!.path).toBe('main.js');
    });
  });

  // =========================================================================
  // readAsarEntryBuffer / readAsarEntryText
  // =========================================================================
  describe('readAsarEntryBuffer', () => {
    it('returns undefined for empty entry path', () => {
      const parsedAsar = {
        files: [{ path: 'file.js', size: 5, offset: 0, unpacked: false }],
        dataOffset: 16,
        headerSize: 0,
        headerStringSize: 0,
        headerContentSize: 0,
        padding: 0,
      };

      expect(readAsarEntryBuffer(Buffer.alloc(100), parsedAsar, '')).toBeUndefined();
    });

    it('returns undefined for non-existent entry', () => {
      const parsedAsar = {
        files: [{ path: 'file.js', size: 5, offset: 0, unpacked: false }],
        dataOffset: 16,
        headerSize: 0,
        headerStringSize: 0,
        headerContentSize: 0,
        padding: 0,
      };

      expect(readAsarEntryBuffer(Buffer.alloc(100), parsedAsar, 'missing.js')).toBeUndefined();
    });

    it('returns undefined for unpacked entries', () => {
      const parsedAsar = {
        files: [{ path: 'native.node', size: 5, offset: 0, unpacked: true }],
        dataOffset: 16,
        headerSize: 0,
        headerStringSize: 0,
        headerContentSize: 0,
        padding: 0,
      };

      expect(readAsarEntryBuffer(Buffer.alloc(100), parsedAsar, 'native.node')).toBeUndefined();
    });

    it('returns buffer content for a valid entry', () => {
      const content = 'hello';
      const dataOffset = 20;
      const buf = Buffer.alloc(dataOffset + content.length);
      buf.write(content, dataOffset);

      const parsedAsar = {
        files: [{ path: 'file.txt', size: content.length, offset: 0, unpacked: false }],
        dataOffset,
        headerSize: 0,
        headerStringSize: 0,
        headerContentSize: 0,
        padding: 0,
      };

      const result = readAsarEntryBuffer(buf, parsedAsar, 'file.txt');
      expect(result).toBeDefined();
      expect(result!.toString('utf-8')).toBe('hello');
    });

    it('returns undefined when data range is out of bounds', () => {
      const parsedAsar = {
        files: [{ path: 'big.js', size: 9999, offset: 0, unpacked: false }],
        dataOffset: 16,
        headerSize: 0,
        headerStringSize: 0,
        headerContentSize: 0,
        padding: 0,
      };

      expect(readAsarEntryBuffer(Buffer.alloc(50), parsedAsar, 'big.js')).toBeUndefined();
    });

    it('matches entry by suffix when exact path is not found', () => {
      const content = 'found';
      const dataOffset = 20;
      const buf = Buffer.alloc(dataOffset + content.length);
      buf.write(content, dataOffset);

      const parsedAsar = {
        files: [{ path: 'src/lib/util.js', size: content.length, offset: 0, unpacked: false }],
        dataOffset,
        headerSize: 0,
        headerStringSize: 0,
        headerContentSize: 0,
        padding: 0,
      };

      const result = readAsarEntryBuffer(buf, parsedAsar, 'util.js');
      expect(result).toBeDefined();
      expect(result!.toString('utf-8')).toBe('found');
    });
  });

  describe('readAsarEntryText', () => {
    it('returns string content for a valid entry', () => {
      const content = 'console.log("hi")';
      const dataOffset = 20;
      const buf = Buffer.alloc(dataOffset + content.length);
      buf.write(content, dataOffset);

      const parsedAsar = {
        files: [{ path: 'main.js', size: content.length, offset: 0, unpacked: false }],
        dataOffset,
        headerSize: 0,
        headerStringSize: 0,
        headerContentSize: 0,
        padding: 0,
      };

      expect(readAsarEntryText(buf, parsedAsar, 'main.js')).toBe(content);
    });

    it('returns undefined when entry is not found', () => {
      const parsedAsar = {
        files: [],
        dataOffset: 16,
        headerSize: 0,
        headerStringSize: 0,
        headerContentSize: 0,
        padding: 0,
      };

      expect(readAsarEntryText(Buffer.alloc(100), parsedAsar, 'nothing.js')).toBeUndefined();
    });
  });

  // =========================================================================
  // parseBrowserWindowHints
  // =========================================================================
  describe('parseBrowserWindowHints', () => {
    it('returns empty preloads and null devTools for plain code', () => {
      const result = parseBrowserWindowHints('console.log("hello");');
      expect(result.preloadScripts).toEqual([]);
      expect(result.devToolsEnabled).toBeNull();
    });

    it('detects preload from path.join pattern', () => {
      const src = `new BrowserWindow({
        webPreferences: {
          preload: path.join(__dirname, 'preload.js')
        }
      });`;

      const result = parseBrowserWindowHints(src);
      expect(result.preloadScripts).toContain('preload.js');
    });

    it('detects preload from string literal', () => {
      const src = `webPreferences: { preload: "./preload-main.js" }`;
      const result = parseBrowserWindowHints(src);
      expect(result.preloadScripts).toContain('./preload-main.js');
    });

    it('detects preload from path.resolve pattern', () => {
      const src = `preload: path.resolve(__dirname, 'scripts/preload.js')`;
      const result = parseBrowserWindowHints(src);
      expect(result.preloadScripts).toContain('scripts/preload.js');
    });

    it('detects explicit devTools: true', () => {
      const src = `webPreferences: { devTools: true }`;
      const result = parseBrowserWindowHints(src);
      expect(result.devToolsEnabled).toBe(true);
    });

    it('detects explicit devTools: false', () => {
      const src = `webPreferences: { devTools: false }`;
      const result = parseBrowserWindowHints(src);
      expect(result.devToolsEnabled).toBe(false);
    });

    it('detects .openDevTools() call and sets devTools to true', () => {
      const src = `win.webContents.openDevTools();`;
      const result = parseBrowserWindowHints(src);
      expect(result.devToolsEnabled).toBe(true);
    });

    it('openDevTools overrides explicit devTools: false', () => {
      const src = `
        webPreferences: { devTools: false }
        win.webContents.openDevTools();
      `;
      const result = parseBrowserWindowHints(src);
      // openDevTools() is checked after devTools property, so it overrides
      expect(result.devToolsEnabled).toBe(true);
    });

    it('detects multiple preload scripts', () => {
      const src = `
        preload: path.join(__dirname, 'preloadA.js')
        preload: path.join(__dirname, 'preloadB.js')
      `;
      const result = parseBrowserWindowHints(src);
      expect(result.preloadScripts).toHaveLength(2);
      expect(result.preloadScripts).toContain('preloadA.js');
      expect(result.preloadScripts).toContain('preloadB.js');
    });

    it('deduplicates identical preload paths', () => {
      const src = `
        preload: path.join(__dirname, 'preload.js')
        preload: path.join(app.getAppPath(), 'preload.js')
      `;
      const result = parseBrowserWindowHints(src);
      // Both match the same filename "preload.js"
      expect(result.preloadScripts).toHaveLength(1);
    });
  });
});
