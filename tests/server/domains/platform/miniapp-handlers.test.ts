import { describe, it, expect, vi, beforeEach } from 'vitest';

type MockDirEntry = {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
};

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  return {
    readFile: vi.fn(),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    stat: vi.fn(),
    readdir: vi.fn(async (): Promise<MockDirEntry[]> => []),
    open: vi.fn(),
  };
});

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
  stat: mocks.stat,
  readdir: mocks.readdir,
  open: mocks.open,
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

import { MiniappHandlers } from '@server/domains/platform/handlers/miniapp-handlers';
import type { CodeCollector, ExternalToolRunner } from '@server/domains/shared/modules';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonTextResponse = {
  content: Array<{ text: string }>;
};

type RunnerOverrides = Partial<Pick<ExternalToolRunner, 'run' | 'probeAll'>>;

type RunnerResult = Awaited<ReturnType<ExternalToolRunner['run']>>;
type ProbeAllResult = Awaited<ReturnType<ExternalToolRunner['probeAll']>>;

function parsePayload(response: JsonTextResponse): Record<string, unknown> {
  const text = response.content[0]?.text;
  if (!text) {
    throw new Error('Missing text response payload');
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function makeCollector(): CodeCollector {
  return {
    getActivePage: vi.fn<CodeCollector['getActivePage']>(async () => {
      throw new Error('getActivePage should not be called in this test');
    }),
  } as unknown as CodeCollector;
}

function makeRunner(overrides: RunnerOverrides = {}): ExternalToolRunner {
  const run = vi.fn<ExternalToolRunner['run']>(async () => ({
    ok: false,
    exitCode: 1,
    signal: null,
    stdout: '',
    stderr: 'not available',
    truncated: false,
    durationMs: 100,
  } satisfies RunnerResult));

  const probeAll = vi.fn<ExternalToolRunner['probeAll']>(
    async () =>
      ({
        'miniapp.unpacker': { available: false, reason: 'not installed' },
      }) as unknown as ProbeAllResult
  );

  return {
    run,
    probeAll,
    ...overrides,
  } as unknown as ExternalToolRunner;
}

function makeFileStats(overrides: Partial<{ isFile: boolean; isDirectory: boolean; size: number }> = {}) {
  return {
    isFile: () => overrides.isFile ?? true,
    isDirectory: () => overrides.isDirectory ?? false,
    size: BigInt(overrides.size ?? 1024),
    mtime: new Date('2025-06-15T12:00:00Z'),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MiniappHandlers', () => {
  let runner: ExternalToolRunner;
  let collector: CodeCollector;
  let handlers: MiniappHandlers;

  beforeEach(() => {
    runner = makeRunner();
    collector = makeCollector();
    handlers = new MiniappHandlers(runner, collector);
  });

  // =========================================================================
  // handleMiniappPkgScan
  // =========================================================================
  describe('handleMiniappPkgScan', () => {
    it('returns success with empty results when no pkg files are found', async () => {
      // stat for candidate roots - all fail
      mocks.stat.mockRejectedValue(new Error('ENOENT'));

      const result = parsePayload(await handlers.handleMiniappPkgScan({}));

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      expect(result.files).toEqual([]);
    });

    it('scans a custom searchPath when provided', async () => {
      // stat for the custom path - is directory
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isDirectory: true, isFile: false }));
      // readdir returns empty
      mocks.readdir.mockResolvedValueOnce([]);

      const result = parsePayload(
        await handlers.handleMiniappPkgScan({ searchPath: '/custom/path' })
      );

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      const searchedRoots = result.searchedRoots as string[];
      expect(searchedRoots).toHaveLength(1);
    });

    it('skips roots that are not directories', async () => {
      // stat for candidate root - is a file, not directory
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true, isDirectory: false }));
      // Remaining roots throw
      mocks.stat.mockRejectedValue(new Error('ENOENT'));

      const result = parsePayload(await handlers.handleMiniappPkgScan({}));

      expect(result.success).toBe(true);
      const skippedRoots = result.skippedRoots as string[];
      expect(skippedRoots.length).toBeGreaterThan(0);
    });

    it('catches errors thrown in the stat loop and skips them', async () => {
      // When stat throws synchronously (not as a rejected promise),
      // the for-loop catch handles it and pushes to skippedRoots.
      // The function still returns success: true with empty results.
      mocks.stat.mockRejectedValue(new Error('ENOENT'));

      const result = parsePayload(await handlers.handleMiniappPkgScan({}));

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
      const skippedRoots = result.skippedRoots as string[];
      expect(skippedRoots.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // handleMiniappPkgUnpack
  // =========================================================================
  describe('handleMiniappPkgUnpack', () => {
    it('returns error when inputPath is missing', async () => {
      const result = parsePayload(await handlers.handleMiniappPkgUnpack({}));
      expect(result.success).toBe(false);
      expect(result.error).toContain('inputPath');
    });

    it('returns error when inputPath is not a file', async () => {
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: false, isDirectory: true }));

      const result = parsePayload(
        await handlers.handleMiniappPkgUnpack({ inputPath: '/some/dir' })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be a file');
    });

    it('falls back to internal parser when external tool is unavailable', async () => {
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));

      // Build a minimal valid miniapp pkg buffer
      const header = Buffer.alloc(18);
      header.writeUInt8(0xbe, 0);         // magic
      header.writeUInt32BE(0, 1);          // info
      header.writeUInt32BE(4, 5);          // indexInfoLength (just fileCount field)
      header.writeUInt32BE(0, 9);          // dataLength
      header.writeUInt8(0, 13);            // lastIdent
      header.writeUInt32BE(0, 14);         // fileCount = 0

      mocks.readFile.mockResolvedValueOnce(header);
      // readdir for walkDirectory after external unpack
      mocks.readdir.mockResolvedValue([]);

      const result = parsePayload(
        await handlers.handleMiniappPkgUnpack({
          inputPath: '/path/to/app.pkg',
          outputDir: '/tmp/output',
        })
      );

      // No entries, so extractedFiles is 0 and success is false
      expect(result.usedExternalCli).toBe(false);
      expect(result).toHaveProperty('header');
      expect(result).toHaveProperty('fileCount');
    });

    it('uses external CLI when available and produces output', async () => {
      const customRunner = makeRunner({
        probeAll: vi.fn<ExternalToolRunner['probeAll']>(
          async () =>
            ({
              'miniapp.unpacker': { available: true },
            }) as unknown as ProbeAllResult
        ),
        run: vi.fn<ExternalToolRunner['run']>(async () => ({
          ok: true,
          exitCode: 0,
          signal: null,
          stdout: 'unpacked',
          stderr: '',
          truncated: false,
          durationMs: 500,
        } satisfies RunnerResult)),
      });

      const customHandlers = new MiniappHandlers(customRunner, collector);
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));

      // walkDirectory for counting extracted files
      mocks.readdir.mockResolvedValueOnce([
        { name: 'index.js', isDirectory: () => false, isFile: () => true },
        { name: 'app.json', isDirectory: () => false, isFile: () => true },
      ]);
      // stat for each file in walkDirectory
      mocks.stat.mockResolvedValueOnce(makeFileStats());
      mocks.stat.mockResolvedValueOnce(makeFileStats());

      const result = parsePayload(
        await customHandlers.handleMiniappPkgUnpack({
          inputPath: '/path/to/app.pkg',
          outputDir: '/tmp/output',
        })
      );

      expect(result.success).toBe(true);
      expect(result.usedExternalCli).toBe(true);
      expect(result.extractedFiles).toBe(2);
    });

    it('handles parse errors gracefully', async () => {
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));
      // readdir for walkDirectory after external unpack attempt
      mocks.readdir.mockResolvedValue([]);
      // Provide a buffer that is too small for the parser
      mocks.readFile.mockResolvedValueOnce(Buffer.alloc(5));

      const result = parsePayload(
        await handlers.handleMiniappPkgUnpack({
          inputPath: '/path/to/bad.pkg',
          outputDir: '/tmp/output',
        })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('too small');
    });

    it('handles invalid magic byte in pkg buffer', async () => {
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));
      mocks.readdir.mockResolvedValue([]);

      const badBuffer = Buffer.alloc(20);
      badBuffer.writeUInt8(0x00, 0); // wrong magic (not 0xBE)
      mocks.readFile.mockResolvedValueOnce(badBuffer);

      const result = parsePayload(
        await handlers.handleMiniappPkgUnpack({
          inputPath: '/path/to/notpkg.pkg',
          outputDir: '/tmp/output',
        })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('magic');
    });
  });

  // =========================================================================
  // handleMiniappPkgAnalyze
  // =========================================================================
  describe('handleMiniappPkgAnalyze', () => {
    it('returns error when unpackedDir is missing', async () => {
      const result = parsePayload(await handlers.handleMiniappPkgAnalyze({}));
      expect(result.success).toBe(false);
      expect(result.error).toContain('unpackedDir');
    });

    it('returns error when unpackedDir is not a directory', async () => {
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true, isDirectory: false }));

      const result = parsePayload(
        await handlers.handleMiniappPkgAnalyze({ unpackedDir: '/some/file.txt' })
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be a directory');
    });

    it('analyzes an empty unpacked directory', async () => {
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isDirectory: true, isFile: false }));
      mocks.readdir.mockResolvedValueOnce([]);

      const result = parsePayload(
        await handlers.handleMiniappPkgAnalyze({ unpackedDir: '/unpacked' })
      );

      expect(result.success).toBe(true);
      expect(result.pages).toEqual([]);
      expect(result.components).toEqual([]);
      expect(result.jsFiles).toEqual([]);
      expect(result.totalSize).toBe(0);
    });

    it('discovers app.json and extracts pages', async () => {
      // stat for unpackedDir
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isDirectory: true, isFile: false }));

      // readdir returns app.json and a js file
      mocks.readdir.mockResolvedValueOnce([
        { name: 'app.json', isDirectory: () => false, isFile: () => true },
        { name: 'app.js', isDirectory: () => false, isFile: () => true },
      ]);

      // stat for each file in walkDirectory
      mocks.stat.mockResolvedValueOnce(makeFileStats({ size: 200 }));
      mocks.stat.mockResolvedValueOnce(makeFileStats({ size: 500 }));

      // readJsonFileSafe for app.json
      mocks.readFile.mockResolvedValueOnce(
        JSON.stringify({
          pages: ['pages/index/index', 'pages/home/home'],
          subPackages: [
            {
              root: 'packageA',
              pages: ['pages/detail/detail'],
            },
          ],
          usingComponents: {
            'custom-btn': '/components/btn/btn',
          },
        })
      );

      const result = parsePayload(
        await handlers.handleMiniappPkgAnalyze({ unpackedDir: '/unpacked' })
      );

      expect(result.success).toBe(true);
      const pages = result.pages as string[];
      expect(pages).toContain('pages/index/index');
      expect(pages).toContain('pages/home/home');
      expect(pages).toContain('packageA/pages/detail/detail');
      const components = result.components as string[];
      expect(components).toContain('/components/btn/btn');
    });

    it('handles unexpected errors gracefully', async () => {
      mocks.stat.mockRejectedValueOnce(new Error('EPERM'));

      const result = parsePayload(
        await handlers.handleMiniappPkgAnalyze({ unpackedDir: '/restricted' })
      );

      expect(result.success).toBe(false);
      expect(result.tool).toBe('miniapp_pkg_analyze');
    });

    it('extracts appId from app.json when present', async () => {
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isDirectory: true, isFile: false }));
      mocks.readdir.mockResolvedValueOnce([
        { name: 'app.json', isDirectory: () => false, isFile: () => true },
      ]);
      mocks.stat.mockResolvedValueOnce(makeFileStats({ size: 100 }));
      mocks.readFile.mockResolvedValueOnce(
        JSON.stringify({
          pages: [],
          appId: 'wx1234567890abcd',
        })
      );

      const result = parsePayload(
        await handlers.handleMiniappPkgAnalyze({ unpackedDir: '/unpacked' })
      );

      expect(result.appId).toBe('wx1234567890abcd');
    });

    it('discovers subPackages pages and merges with root prefix', async () => {
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isDirectory: true, isFile: false }));
      mocks.readdir.mockResolvedValueOnce([
        { name: 'app.json', isDirectory: () => false, isFile: () => true },
      ]);
      mocks.stat.mockResolvedValueOnce(makeFileStats({ size: 100 }));
      mocks.readFile.mockResolvedValueOnce(
        JSON.stringify({
          pages: ['pages/main'],
          subpackages: [
            { root: 'sub', pages: ['pages/sub-page'] },
            { root: '', pages: ['pages/root-page'] },
          ],
        })
      );

      const result = parsePayload(
        await handlers.handleMiniappPkgAnalyze({ unpackedDir: '/unpacked' })
      );

      const pages = result.pages as string[];
      expect(pages).toContain('pages/main');
      expect(pages).toContain('sub/pages/sub-page');
      expect(pages).toContain('pages/root-page');
    });
  });
});
