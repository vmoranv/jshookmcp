import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import {
  findFilesystemPreloadScripts,
  parseAsarBuffer,
  parseBrowserWindowHints,
  readAsarEntryText,
} from '@server/domains/platform/handlers/electron-asar-helpers';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { CodeCollector } from '@server/domains/shared/modules';
import { logger } from '@utils/logger';
import {
  toTextResponse,
  toErrorResponse,
  getCollectorState,
  parseStringArg,
  parseBooleanArg,
  isRecord,
  toDisplayPath,
  pathExists,
  resolveOutputDirectory,
  resolveSafeOutputPath,
  readJsonFileSafe,
  sanitizeArchiveRelativePath,
  type ParsedAsar,
} from '@server/domains/platform/handlers/platform-utils';

// ── Private helpers ──

// ── Public handler class ──

export class ElectronHandlers {
  private collector: CodeCollector;

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  async handleAsarExtract(args: Record<string, unknown>) {
    try {
      const inputPath = parseStringArg(args, 'inputPath', true);
      const outputDirArg = parseStringArg(args, 'outputDir');
      const listOnly = parseBooleanArg(args, 'listOnly', false);

      if (!inputPath) {
        throw new Error('inputPath is required');
      }

      const absoluteInputPath = resolve(inputPath);
      const inputStats = await stat(absoluteInputPath);
      if (!inputStats.isFile()) {
        throw new Error('inputPath must be a file');
      }

      const asarBuffer = await readFile(absoluteInputPath);
      const parsedAsar = parseAsarBuffer(asarBuffer);

      const files = parsedAsar.files.map((entry) => ({
        path: entry.path,
        size: entry.size,
        offset: entry.offset,
      }));

      const totalSize = files.reduce((sum, entry) => sum + entry.size, 0);

      if (listOnly) {
        return toTextResponse({
          success: true,
          files,
          totalFiles: files.length,
          totalSize,
          dataOffset: parsedAsar.dataOffset,
          header: {
            headerSize: parsedAsar.headerSize,
            headerStringSize: parsedAsar.headerStringSize,
            headerContentSize: parsedAsar.headerContentSize,
            padding: parsedAsar.padding,
          },
          collectorState: getCollectorState(this.collector),
        });
      }

      const outputDirectory = await resolveOutputDirectory(
        'asar-extract',
        basename(absoluteInputPath, extname(absoluteInputPath)),
        outputDirArg
      );

      let extractedFiles = 0;
      const failedFiles: Array<{ path: string; reason: string }> = [];

      for (const entry of parsedAsar.files) {
        if (entry.unpacked) {
          failedFiles.push({
            path: entry.path,
            reason: 'Entry is marked as unpacked and not stored inside app.asar',
          });
          continue;
        }

        const start = parsedAsar.dataOffset + entry.offset;
        const end = start + entry.size;

        if (start < 0 || end > asarBuffer.length || end < start) {
          failedFiles.push({
            path: entry.path,
            reason: 'Entry data range is out of bounds',
          });
          continue;
        }

        try {
          const data = asarBuffer.subarray(start, end);
          const outputPath = resolveSafeOutputPath(outputDirectory.absolutePath, entry.path);

          await mkdir(dirname(outputPath), { recursive: true });
          await writeFile(outputPath, data);
          extractedFiles += 1;
        } catch (error) {
          failedFiles.push({
            path: entry.path,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return toTextResponse({
        success: extractedFiles > 0,
        files,
        totalFiles: files.length,
        totalSize,
        extractedFiles,
        failedFiles,
        outputDir: outputDirectory.displayPath,
        dataOffset: parsedAsar.dataOffset,
        header: {
          headerSize: parsedAsar.headerSize,
          headerStringSize: parsedAsar.headerStringSize,
          headerContentSize: parsedAsar.headerContentSize,
          padding: parsedAsar.padding,
        },
        collectorState: getCollectorState(this.collector),
      });
    } catch (error) {
      return toErrorResponse('asar_extract', error);
    }
  }

  async handleElectronInspectApp(args: Record<string, unknown>) {
    try {
      const appPath = parseStringArg(args, 'appPath', true);
      if (!appPath) {
        throw new Error('appPath is required');
      }

      const absoluteAppPath = resolve(appPath);
      const appStats = await stat(absoluteAppPath);
      const scanRoot = appStats.isDirectory() ? absoluteAppPath : dirname(absoluteAppPath);

      const asarCandidates = [
        join(scanRoot, 'resources', 'app.asar'),
        join(scanRoot, 'Contents', 'Resources', 'app.asar'),
        join(scanRoot, 'app.asar'),
      ];

      let asarPath: string | null = null;
      for (const candidate of asarCandidates) {
        if (!(await pathExists(candidate))) {
          continue;
        }
        const candidateStats = await stat(candidate);
        if (candidateStats.isFile()) {
          asarPath = candidate;
          break;
        }
      }

      let asarBuffer: Buffer | null = null;
      let parsedAsar: ParsedAsar | null = null;

      if (asarPath) {
        try {
          asarBuffer = await readFile(asarPath);
          parsedAsar = parseAsarBuffer(asarBuffer);
        } catch (error) {
          logger.warn('electron_inspect_app failed to parse asar', {
            asarPath,
            error: error instanceof Error ? error.message : String(error),
          });
          asarBuffer = null;
          parsedAsar = null;
        }
      }

      let packageJson: Record<string, unknown> | null = null;
      let packageJsonPath = '';
      let packageSource: 'filesystem' | 'asar' | 'none' = 'none';

      if (parsedAsar && asarBuffer) {
        const packageEntry = parsedAsar.files.find(
          (entry) => entry.path === 'package.json' || entry.path.endsWith('/package.json')
        );

        if (packageEntry) {
          const packageText = readAsarEntryText(asarBuffer, parsedAsar, packageEntry.path);

          if (packageText) {
            try {
              const parsed = JSON.parse(packageText) as unknown;
              if (isRecord(parsed)) {
                packageJson = parsed;
                packageJsonPath = packageEntry.path;
                packageSource = 'asar';
              }
            } catch (error) {
              logger.warn('electron_inspect_app invalid package.json in asar', {
                packagePath: packageEntry.path,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }

      if (!packageJson) {
        const packageCandidates = [
          join(scanRoot, 'package.json'),
          join(scanRoot, 'app', 'package.json'),
          join(scanRoot, 'resources', 'app', 'package.json'),
          join(scanRoot, 'Contents', 'Resources', 'app', 'package.json'),
        ];

        for (const candidate of packageCandidates) {
          const candidateJson = await readJsonFileSafe(candidate);
          if (candidateJson) {
            packageJson = candidateJson;
            packageJsonPath = candidate;
            packageSource = 'filesystem';
            break;
          }
        }
      }

      if (!packageJson) {
        return toTextResponse({
          success: false,
          tool: 'electron_inspect_app',
          error: 'Cannot locate package.json in app directory or app.asar',
          appPath: absoluteAppPath.replace(/\\/g, '/'),
          scanRoot: scanRoot.replace(/\\/g, '/'),
          asarPath: asarPath ? asarPath.replace(/\\/g, '/') : null,
          collectorState: getCollectorState(this.collector),
        });
      }

      const mainEntry =
        typeof packageJson.main === 'string' && packageJson.main.trim().length > 0
          ? packageJson.main.trim()
          : 'index.js';

      const version = typeof packageJson.version === 'string' ? packageJson.version : null;

      const dependenciesRaw = packageJson.dependencies;
      const dependencies = isRecord(dependenciesRaw) ? Object.keys(dependenciesRaw).sort() : [];

      let mainScriptSource = '';
      let mainScriptPath = '';

      if (packageSource === 'asar' && parsedAsar && asarBuffer) {
        const packageBase = packageJsonPath.length > 0 ? dirname(packageJsonPath) : '';
        const candidateMainPaths = Array.from(
          new Set([
            sanitizeArchiveRelativePath(join(packageBase, mainEntry)),
            sanitizeArchiveRelativePath(mainEntry),
            sanitizeArchiveRelativePath(basename(mainEntry)),
          ])
        ).filter((value) => value.length > 0);

        for (const candidate of candidateMainPaths) {
          const text = readAsarEntryText(asarBuffer, parsedAsar, candidate);
          if (typeof text === 'string') {
            mainScriptSource = text;
            mainScriptPath = candidate;
            break;
          }
        }

        if (mainScriptSource.length === 0) {
          const fallbackEntry = parsedAsar.files.find(
            (entry) => basename(entry.path) === basename(mainEntry)
          );
          if (fallbackEntry) {
            const fallbackText = readAsarEntryText(asarBuffer, parsedAsar, fallbackEntry.path);
            if (typeof fallbackText === 'string') {
              mainScriptSource = fallbackText;
              mainScriptPath = fallbackEntry.path;
            }
          }
        }
      } else if (packageSource === 'filesystem') {
        const packageDir = dirname(packageJsonPath);
        const absoluteMainPath = resolve(packageDir, mainEntry);

        if (await pathExists(absoluteMainPath)) {
          const mainStats = await stat(absoluteMainPath);
          if (mainStats.isFile()) {
            try {
              mainScriptSource = await readFile(absoluteMainPath, 'utf-8');
              mainScriptPath = absoluteMainPath;
            } catch (error) {
              logger.warn('electron_inspect_app failed to read main script', {
                absoluteMainPath,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }

      const parsedHints =
        mainScriptSource.length > 0
          ? parseBrowserWindowHints(mainScriptSource)
          : { preloadScripts: [], devToolsEnabled: null };

      const preloadScripts = new Set<string>(parsedHints.preloadScripts);

      if (preloadScripts.size === 0 && parsedAsar) {
        for (const entry of parsedAsar.files) {
          const lowerPath = entry.path.toLowerCase();
          if (lowerPath.includes('preload') && extname(lowerPath) === '.js') {
            preloadScripts.add(entry.path);
          }
        }
      }

      if (preloadScripts.size === 0) {
        const filesystemPreloads = await findFilesystemPreloadScripts(scanRoot);
        for (const preload of filesystemPreloads) {
          preloadScripts.add(preload);
        }
      }

      const devToolsEnabled =
        parsedHints.devToolsEnabled !== null ? parsedHints.devToolsEnabled : true;

      return toTextResponse({
        success: true,
        appPath: absoluteAppPath.replace(/\\/g, '/'),
        scanRoot: scanRoot.replace(/\\/g, '/'),
        mainEntry,
        version,
        preloadScripts: Array.from(preloadScripts).sort(),
        dependencies,
        devToolsEnabled,
        packageSource,
        packagePath:
          packageSource === 'filesystem' ? toDisplayPath(packageJsonPath) : packageJsonPath,
        mainScriptPath:
          mainScriptPath.length > 0
            ? packageSource === 'filesystem'
              ? toDisplayPath(mainScriptPath)
              : mainScriptPath
            : null,
        asarPath: asarPath ? toDisplayPath(asarPath) : null,
        browserWindowDetected:
          mainScriptSource.length > 0 ? mainScriptSource.includes('BrowserWindow') : false,
        collectorState: getCollectorState(this.collector),
      });
    } catch (error) {
      return toErrorResponse('electron_inspect_app', error);
    }
  }

  /**
   * asar_search — regex search inside ASAR archive files.
   * Pattern is agent-provided, no hardcoded defaults.
   */
  async handleAsarSearch(args: Record<string, unknown>) {
    try {
      const inputPath = parseStringArg(args, 'inputPath', true);
      const searchPattern = parseStringArg(args, 'pattern', true);
      if (!inputPath) throw new Error('inputPath is required');
      if (!searchPattern) throw new Error('pattern is required');

      const fileGlob = parseStringArg(args, 'fileGlob') || '*.js';
      const maxResults =
        typeof args.maxResults === 'number' && args.maxResults > 0
          ? args.maxResults
          : 100;

      const searchAbsPath = resolve(inputPath);
      if (!(await pathExists(searchAbsPath))) {
        return toTextResponse({
          success: false,
          tool: 'asar_search',
          error: `File does not exist: ${inputPath}`,
        });
      }

      const searchAsarBuf = await readFile(searchAbsPath);
      const searchParsed = parseAsarBuffer(searchAsarBuf);

      // Determine which extensions to include from fileGlob
      const globExt = fileGlob.startsWith('*.') ? fileGlob.slice(1) : null;

      const matchingFiles = searchParsed.files.filter((entry) => {
        if (entry.unpacked || entry.size <= 0) return false;
        if (globExt) {
          return extname(entry.path).toLowerCase() === globExt.toLowerCase();
        }
        return true;
      });

      let regex: RegExp;
      try {
        regex = new RegExp(searchPattern, 'gi');
      } catch {
        return toTextResponse({
          success: false,
          tool: 'asar_search',
          error: `Invalid regex pattern: ${searchPattern}`,
        });
      }

      const matches: Array<{
        filePath: string;
        matchCount: number;
        matchLines: Array<{ lineNumber: number; text: string }>;
      }> = [];
      let totalMatches = 0;
      let filesScanned = 0;

      for (const entry of matchingFiles) {
        if (totalMatches >= maxResults) break;

        const start = searchParsed.dataOffset + entry.offset;
        const end = start + entry.size;
        if (start < 0 || end > searchAsarBuf.length || end < start) continue;

        // Skip very large files (>512KB)
        if (entry.size > 512_000) continue;

        const content = searchAsarBuf.subarray(start, end).toString('utf-8');
        filesScanned++;

        // Reset regex state
        regex.lastIndex = 0;

        const lines = content.split('\n');
        const fileMatches: Array<{ lineNumber: number; text: string }> = [];

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          if (totalMatches >= maxResults) break;
          const line = lines[lineIdx];
          if (!line) continue;
          regex.lastIndex = 0;
          if (regex.test(line)) {
            fileMatches.push({
              lineNumber: lineIdx + 1,
              text: line.slice(0, 200),
            });
            totalMatches++;
          }
        }

        if (fileMatches.length > 0) {
          matches.push({
            filePath: entry.path,
            matchCount: fileMatches.length,
            matchLines: fileMatches,
          });
        }
      }

      return toTextResponse({
        success: true,
        tool: 'asar_search',
        matches,
        totalMatches,
        filesScanned,
        pattern: searchPattern,
      });
    } catch (error) {
      return toErrorResponse('asar_search', error);
    }
  }
}
