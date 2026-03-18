import { describe, it, expect, vi, beforeEach } from 'vitest';

type BrowserWindowHints = {
  preloadScripts: string[];
  devToolsEnabled: boolean | null;
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
    parseAsarBuffer: vi.fn(),
    parseBrowserWindowHints: vi.fn(
      (): BrowserWindowHints => ({
        preloadScripts: [],
        devToolsEnabled: null,
      })
    ),
    readAsarEntryText: vi.fn(),
    findFilesystemPreloadScripts: vi.fn(async () => []),
  };
});

vi.mock('node:fs/promises', () => ({
  readFile: mocks.readFile,
  mkdir: mocks.mkdir,
  writeFile: mocks.writeFile,
  stat: mocks.stat,
}));

vi.mock('@server/domains/platform/handlers/electron-asar-helpers', () => ({
  parseAsarBuffer: mocks.parseAsarBuffer,
  parseBrowserWindowHints: mocks.parseBrowserWindowHints,
  readAsarEntryText: mocks.readAsarEntryText,
  findFilesystemPreloadScripts: mocks.findFilesystemPreloadScripts,
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

import { ElectronHandlers } from '@server/domains/platform/handlers/electron-handlers';
import type { CodeCollector } from '@server/domains/shared/modules';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type JsonTextResponse = {
  content: Array<{ text: string }>;
};

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

function makeFileStats(overrides: Partial<{ isFile: boolean; isDirectory: boolean }> = {}) {
  return {
    isFile: () => overrides.isFile ?? true,
    isDirectory: () => overrides.isDirectory ?? false,
    size: 1024,
    mtime: new Date('2025-01-01'),
  };
}

function makeParsedAsar(
  fileEntries: Array<{ path: string; size: number; offset: number; unpacked?: boolean }> = []
) {
  return {
    files: fileEntries.map((e) => ({
      path: e.path,
      size: e.size,
      offset: e.offset,
      unpacked: e.unpacked ?? false,
    })),
    dataOffset: 100,
    headerSize: 50,
    headerStringSize: 40,
    headerContentSize: 38,
    padding: 0,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ElectronHandlers', () => {
  let collector: CodeCollector;
  let handlers: ElectronHandlers;

  beforeEach(() => {
    collector = makeCollector();
    handlers = new ElectronHandlers(collector);
  });

  // =========================================================================
  // handleAsarExtract
  // =========================================================================
  describe('handleAsarExtract', () => {
    it('returns error when inputPath is missing', async () => {
      const result = parsePayload(await handlers.handleAsarExtract({}));
      expect(result.success).toBe(false);
      expect(result.error).toContain('inputPath');
    });

    it('returns error when inputPath is not a file', async () => {
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: false, isDirectory: true }));

      const result = parsePayload(await handlers.handleAsarExtract({ inputPath: '/some/dir' }));

      expect(result.success).toBe(false);
      expect(result.error).toContain('must be a file');
    });

    it('lists files in listOnly mode without extracting', async () => {
      const fakeBuffer = Buffer.alloc(200);
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));
      mocks.readFile.mockResolvedValueOnce(fakeBuffer);
      mocks.parseAsarBuffer.mockReturnValueOnce(
        makeParsedAsar([
          { path: 'index.js', size: 50, offset: 0 },
          { path: 'package.json', size: 30, offset: 50 },
        ])
      );

      const result = parsePayload(
        await handlers.handleAsarExtract({
          inputPath: '/app/resources/app.asar',
          listOnly: true,
        })
      );

      expect(result.success).toBe(true);
      expect(result.totalFiles).toBe(2);
      expect(result.totalSize).toBe(80);
      expect(result.dataOffset).toBe(100);
      expect(result).toHaveProperty('header');
      expect(result.collectorState).toBe('attached');
      expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    it('extracts files to output directory', async () => {
      const fakeBuffer = Buffer.alloc(200);
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));
      mocks.readFile.mockResolvedValueOnce(fakeBuffer);
      mocks.parseAsarBuffer.mockReturnValueOnce(
        makeParsedAsar([{ path: 'main.js', size: 10, offset: 0 }])
      );

      const result = parsePayload(
        await handlers.handleAsarExtract({
          inputPath: '/app/resources/app.asar',
          outputDir: '/tmp/output',
        })
      );

      expect(result.success).toBe(true);
      expect(result.extractedFiles).toBe(1);
      expect(mocks.writeFile).toHaveBeenCalledOnce();
    });

    it('skips unpacked entries and reports them as failed', async () => {
      const fakeBuffer = Buffer.alloc(200);
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));
      mocks.readFile.mockResolvedValueOnce(fakeBuffer);
      mocks.parseAsarBuffer.mockReturnValueOnce(
        makeParsedAsar([
          { path: 'native.node', size: 10, offset: 0, unpacked: true },
          { path: 'index.js', size: 10, offset: 0 },
        ])
      );

      const result = parsePayload(
        await handlers.handleAsarExtract({
          inputPath: '/app/resources/app.asar',
          outputDir: '/tmp/output',
        })
      );

      expect(result.extractedFiles).toBe(1);
      const failedFiles = result.failedFiles as Array<{ path: string; reason: string }>;
      expect(failedFiles).toHaveLength(1);
      const firstFailedFile = failedFiles[0];
      if (!firstFailedFile) {
        throw new Error('Expected one failed file entry');
      }
      expect(firstFailedFile.path).toBe('native.node');
      expect(firstFailedFile.reason).toContain('unpacked');
    });

    it('reports entries with out-of-bounds data ranges', async () => {
      const smallBuffer = Buffer.alloc(50);
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));
      mocks.readFile.mockResolvedValueOnce(smallBuffer);
      mocks.parseAsarBuffer.mockReturnValueOnce(
        makeParsedAsar([{ path: 'huge.js', size: 9999, offset: 0 }])
      );

      const result = parsePayload(
        await handlers.handleAsarExtract({
          inputPath: '/app/resources/app.asar',
          outputDir: '/tmp/output',
        })
      );

      const failedFiles = result.failedFiles as Array<{ path: string; reason: string }>;
      expect(failedFiles).toHaveLength(1);
      const firstFailedFile = failedFiles[0];
      if (!firstFailedFile) {
        throw new Error('Expected one failed file entry');
      }
      expect(firstFailedFile.reason).toContain('out of bounds');
    });

    it('handles file write errors gracefully', async () => {
      const fakeBuffer = Buffer.alloc(200);
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));
      mocks.readFile.mockResolvedValueOnce(fakeBuffer);
      mocks.parseAsarBuffer.mockReturnValueOnce(
        makeParsedAsar([{ path: 'index.js', size: 10, offset: 0 }])
      );
      mocks.writeFile.mockRejectedValueOnce(new Error('EACCES'));

      const result = parsePayload(
        await handlers.handleAsarExtract({
          inputPath: '/app/resources/app.asar',
          outputDir: '/tmp/output',
        })
      );

      expect(result.extractedFiles).toBe(0);
      const failedFiles = result.failedFiles as Array<{ path: string; reason: string }>;
      expect(failedFiles).toHaveLength(1);
      const firstFailedFile = failedFiles[0];
      if (!firstFailedFile) {
        throw new Error('Expected one failed file entry');
      }
      expect(firstFailedFile.reason).toContain('EACCES');
    });
  });

  // =========================================================================
  // handleElectronInspectApp
  // =========================================================================
  describe('handleElectronInspectApp', () => {
    it('returns error when appPath is missing', async () => {
      const result = parsePayload(await handlers.handleElectronInspectApp({}));
      expect(result.success).toBe(false);
      expect(result.error).toContain('appPath');
    });

    it('returns failure when no package.json can be found anywhere', async () => {
      // stat(appPath) -> directory
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isDirectory: true, isFile: false }));
      // pathExists for 3 asar candidates -> all fail
      mocks.stat.mockRejectedValueOnce(new Error('ENOENT'));
      mocks.stat.mockRejectedValueOnce(new Error('ENOENT'));
      mocks.stat.mockRejectedValueOnce(new Error('ENOENT'));
      // readJsonFileSafe for 4 filesystem package.json candidates -> all fail
      mocks.readFile.mockRejectedValueOnce(new Error('ENOENT'));
      mocks.readFile.mockRejectedValueOnce(new Error('ENOENT'));
      mocks.readFile.mockRejectedValueOnce(new Error('ENOENT'));
      mocks.readFile.mockRejectedValueOnce(new Error('ENOENT'));

      const result = parsePayload(await handlers.handleElectronInspectApp({ appPath: '/app' }));

      expect(result.success).toBe(false);
      expect(result.error).toContain('package.json');
    });

    it('inspects an app with package.json found from asar', async () => {
      const fakeBuffer = Buffer.from('fake asar content');
      const fakeParsedAsar = makeParsedAsar([
        { path: 'package.json', size: 50, offset: 0 },
        { path: 'main.js', size: 100, offset: 50 },
      ]);

      // 1. stat(appPath) -> directory
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isDirectory: true, isFile: false }));
      // 2. pathExists for first asar candidate (resources/app.asar) -> found (stat succeeds)
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));
      // 3. stat for the same asar candidate to check isFile -> true
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));
      // readFile for asar
      mocks.readFile.mockResolvedValueOnce(fakeBuffer);
      mocks.parseAsarBuffer.mockReturnValueOnce(fakeParsedAsar);

      // readAsarEntryText for package.json
      mocks.readAsarEntryText.mockReturnValueOnce(
        JSON.stringify({
          name: 'test-app',
          version: '1.0.0',
          main: 'main.js',
          dependencies: { electron: '^25.0.0' },
        })
      );

      // readAsarEntryText for main.js content (first candidate path)
      mocks.readAsarEntryText.mockReturnValueOnce(
        'const { app, BrowserWindow } = require("electron");'
      );

      mocks.parseBrowserWindowHints.mockReturnValueOnce({
        preloadScripts: ['preload.js'],
        devToolsEnabled: true,
      });

      const result = parsePayload(await handlers.handleElectronInspectApp({ appPath: '/app' }));

      expect(result.success).toBe(true);
      expect(result.version).toBe('1.0.0');
      expect(result.mainEntry).toBe('main.js');
      expect(result.packageSource).toBe('asar');
      expect(result.browserWindowDetected).toBe(true);
      expect(result.devToolsEnabled).toBe(true);
      expect(result.dependencies).toEqual(['electron']);
      const preloads = result.preloadScripts as string[];
      expect(preloads).toContain('preload.js');
    });

    it('falls back to filesystem package.json when asar is not found', async () => {
      // 1. stat(appPath) -> file (exe)
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true, isDirectory: false }));
      // 2-4. pathExists for 3 asar candidates -> all fail
      mocks.stat.mockRejectedValueOnce(new Error('ENOENT'));
      mocks.stat.mockRejectedValueOnce(new Error('ENOENT'));
      mocks.stat.mockRejectedValueOnce(new Error('ENOENT'));

      // readJsonFileSafe: first filesystem candidate found (readFile succeeds)
      mocks.readFile.mockResolvedValueOnce(
        JSON.stringify({
          name: 'fs-app',
          version: '2.0.0',
          main: 'index.js',
        })
      );

      // pathExists for main script (stat succeeds)
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));
      // stat for main script to check isFile
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));

      // readFile for main script
      mocks.readFile.mockResolvedValueOnce('console.log("hello");');

      mocks.parseBrowserWindowHints.mockReturnValueOnce({
        preloadScripts: [],
        devToolsEnabled: null,
      });

      // findFilesystemPreloadScripts returns empty
      mocks.findFilesystemPreloadScripts.mockResolvedValueOnce([]);

      const result = parsePayload(
        await handlers.handleElectronInspectApp({ appPath: '/app/myapp.exe' })
      );

      expect(result.success).toBe(true);
      expect(result.version).toBe('2.0.0');
      expect(result.packageSource).toBe('filesystem');
      expect(result.devToolsEnabled).toBe(true);
    });

    it('uses "index.js" as mainEntry when packageJson.main is missing', async () => {
      // stat(appPath) -> directory
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isDirectory: true, isFile: false }));
      // pathExists for 3 asar candidates -> all fail
      mocks.stat.mockRejectedValueOnce(new Error('ENOENT'));
      mocks.stat.mockRejectedValueOnce(new Error('ENOENT'));
      mocks.stat.mockRejectedValueOnce(new Error('ENOENT'));

      // readJsonFileSafe: first candidate found
      mocks.readFile.mockResolvedValueOnce(JSON.stringify({ name: 'no-main-app' }));

      // pathExists for index.js -> not found
      mocks.stat.mockRejectedValueOnce(new Error('ENOENT'));

      mocks.findFilesystemPreloadScripts.mockResolvedValueOnce([]);

      const result = parsePayload(await handlers.handleElectronInspectApp({ appPath: '/app' }));

      expect(result.success).toBe(true);
      expect(result.mainEntry).toBe('index.js');
    });

    it('handles general errors gracefully', async () => {
      mocks.stat.mockRejectedValueOnce(new Error('EPERM'));

      const result = parsePayload(
        await handlers.handleElectronInspectApp({ appPath: '/restricted/app' })
      );

      expect(result.success).toBe(false);
      expect(result.tool).toBe('electron_inspect_app');
      expect(result.error).toContain('EPERM');
    });

    it('discovers preload scripts by scanning asar entries as fallback', async () => {
      const fakeParsedAsar = makeParsedAsar([
        { path: 'package.json', size: 50, offset: 0 },
        { path: 'preload.js', size: 30, offset: 50 },
        { path: 'renderer-preload.js', size: 20, offset: 80 },
        { path: 'main.js', size: 100, offset: 100 },
      ]);
      const fakeBuffer = Buffer.alloc(300);

      // 1. stat(appPath) -> directory
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isDirectory: true, isFile: false }));
      // 2. pathExists for first asar candidate -> found
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));
      // 3. stat to check isFile -> true
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));

      mocks.readFile.mockResolvedValueOnce(fakeBuffer);
      mocks.parseAsarBuffer.mockReturnValueOnce(fakeParsedAsar);

      // readAsarEntryText for package.json
      mocks.readAsarEntryText.mockReturnValueOnce(JSON.stringify({ name: 'app', main: 'main.js' }));
      // readAsarEntryText for main.js
      mocks.readAsarEntryText.mockReturnValueOnce('// main entry');

      // parseBrowserWindowHints returns empty preload list to trigger fallback
      mocks.parseBrowserWindowHints.mockReturnValueOnce({
        preloadScripts: [],
        devToolsEnabled: null,
      });

      const result = parsePayload(await handlers.handleElectronInspectApp({ appPath: '/app' }));

      expect(result.success).toBe(true);
      const preloads = result.preloadScripts as string[];
      expect(preloads).toContain('preload.js');
      expect(preloads).toContain('renderer-preload.js');
    });

    it('returns sorted dependencies list', async () => {
      const fakeParsedAsar = makeParsedAsar([{ path: 'package.json', size: 50, offset: 0 }]);
      const fakeBuffer = Buffer.alloc(200);

      mocks.stat.mockResolvedValueOnce(makeFileStats({ isDirectory: true, isFile: false }));
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));
      mocks.stat.mockResolvedValueOnce(makeFileStats({ isFile: true }));

      mocks.readFile.mockResolvedValueOnce(fakeBuffer);
      mocks.parseAsarBuffer.mockReturnValueOnce(fakeParsedAsar);

      mocks.readAsarEntryText.mockReturnValueOnce(
        JSON.stringify({
          name: 'deps-app',
          main: 'index.js',
          dependencies: { zebra: '1.0', alpha: '2.0', middle: '3.0' },
        })
      );
      // No main script found
      mocks.readAsarEntryText.mockReturnValue(undefined);

      const result = parsePayload(await handlers.handleElectronInspectApp({ appPath: '/app' }));

      expect(result.success).toBe(true);
      expect(result.dependencies).toEqual(['alpha', 'middle', 'zebra']);
    });
  });
});
