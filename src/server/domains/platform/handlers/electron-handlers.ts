import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { CodeCollector } from '../../../../modules/collector/CodeCollector.js';
import { logger } from '../../../../utils/logger.js';
import {
  toTextResponse,
  toErrorResponse,
  getCollectorState,
  parseStringArg,
  parseBooleanArg,
  isRecord,
  toDisplayPath,
  pathExists,
  walkDirectory,
  resolveOutputDirectory,
  resolveSafeOutputPath,
  readJsonFileSafe,
  sanitizeArchiveRelativePath,
  type AsarFileEntry,
  type ParsedAsar,
} from './platform-utils.js';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function flattenAsarEntries(headerNode: Record<string, unknown>): AsarFileEntry[] {
  if (!isRecord(headerNode.files)) {
    return [];
  }

  const files: AsarFileEntry[] = [];

  const walk = (nodes: Record<string, unknown>, prefix: string): void => {
    for (const [name, rawNode] of Object.entries(nodes)) {
      if (!isRecord(rawNode)) {
        continue;
      }

      const pathPart = prefix.length > 0 ? `${prefix}/${name}` : name;

      if (isRecord(rawNode.files)) {
        walk(rawNode.files, pathPart);
        continue;
      }

      const sizeRaw = rawNode.size;
      const offsetRaw = rawNode.offset;
      const unpacked = rawNode.unpacked === true;

      const size =
        typeof sizeRaw === 'number' && Number.isFinite(sizeRaw) && sizeRaw >= 0
          ? sizeRaw
          : 0;

      let offset = 0;
      if (typeof offsetRaw === 'number' || typeof offsetRaw === 'string') {
        const parsedOffset = Number(offsetRaw);
        if (Number.isFinite(parsedOffset) && parsedOffset >= 0) {
          offset = parsedOffset;
        }
      }

      files.push({
        path: sanitizeArchiveRelativePath(pathPart),
        size,
        offset,
        unpacked,
      });
    }
  };

  walk(headerNode.files, '');
  return files;
}

function isAsarDataOffsetValid(
  files: AsarFileEntry[],
  dataOffset: number,
  totalSize: number
): boolean {
  const samples = files.filter((entry) => !entry.unpacked).slice(0, 32);

  for (const file of samples) {
    const start = dataOffset + file.offset;
    const end = start + file.size;
    if (start < 0 || end < start || end > totalSize) {
      return false;
    }
  }

  return true;
}

function parseAsarBuffer(asarBuffer: Buffer): ParsedAsar {
  if (asarBuffer.length < 16) {
    throw new Error('Invalid ASAR: file too small');
  }

  const headerSize = asarBuffer.readUInt32LE(0);
  const headerStringSize = asarBuffer.readUInt32LE(4);
  const headerContentSize = asarBuffer.readUInt32LE(8);
  const padding = asarBuffer.readUInt32LE(12);

  const headerStart = 16;
  const lengthCandidates = Array.from(
    new Set([
      headerContentSize,
      headerStringSize,
      headerSize - 8,
      headerSize,
    ])
  ).filter((value) => value > 0 && headerStart + value <= asarBuffer.length);

  let headerObject: Record<string, unknown> | null = null;
  let headerLength = 0;

  for (const candidateLength of lengthCandidates) {
    const headerText = asarBuffer
      .subarray(headerStart, headerStart + candidateLength)
      .toString('utf-8')
      .replace(/\0+$/g, '')
      .trim();

    if (headerText.length === 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(headerText) as unknown;
      if (isRecord(parsed)) {
        headerObject = parsed;
        headerLength = candidateLength;
        break;
      }
    } catch {
      // try next candidate
    }
  }

  if (!headerObject) {
    throw new Error('Invalid ASAR: cannot parse header JSON');
  }

  const rootNode = isRecord(headerObject.files)
    ? headerObject
    : { files: headerObject };

  const files = flattenAsarEntries(rootNode);

  const offsetCandidates = Array.from(
    new Set([
      headerStart + headerLength + padding,
      8 + headerSize,
      headerStart + headerContentSize + padding,
      headerStart + headerStringSize + padding,
    ])
  ).filter((value) => value >= 0 && value <= asarBuffer.length);

  let dataOffset = offsetCandidates[0] ?? headerStart + headerLength;
  for (const candidate of offsetCandidates) {
    if (isAsarDataOffsetValid(files, candidate, asarBuffer.length)) {
      dataOffset = candidate;
      break;
    }
  }

  return {
    files,
    dataOffset,
    headerSize,
    headerStringSize,
    headerContentSize,
    padding,
  };
}

function readAsarEntryBuffer(
  asarBuffer: Buffer,
  parsedAsar: ParsedAsar,
  entryPath: string
): Buffer | undefined {
  const normalizedEntryPath = sanitizeArchiveRelativePath(entryPath);
  if (normalizedEntryPath.length === 0) {
    return undefined;
  }

  const matchedEntry =
    parsedAsar.files.find((entry) => entry.path === normalizedEntryPath) ??
    parsedAsar.files.find((entry) =>
      entry.path.endsWith(`/${normalizedEntryPath}`)
    );

  if (!matchedEntry || matchedEntry.unpacked) {
    return undefined;
  }

  const start = parsedAsar.dataOffset + matchedEntry.offset;
  const end = start + matchedEntry.size;

  if (start < 0 || end > asarBuffer.length || end < start) {
    return undefined;
  }

  return asarBuffer.subarray(start, end);
}

function readAsarEntryText(
  asarBuffer: Buffer,
  parsedAsar: ParsedAsar,
  entryPath: string
): string | undefined {
  const data = readAsarEntryBuffer(asarBuffer, parsedAsar, entryPath);
  return data ? data.toString('utf-8') : undefined;
}

function parseBrowserWindowHints(sourceText: string): {
  preloadScripts: string[];
  devToolsEnabled: boolean | null;
} {
  const preloadScripts = new Set<string>();
  const preloadPattern =
    /preload\s*:\s*(?:path\.(?:join|resolve)\([^)]*?['"`]([^'"`]+)['"`][^)]*\)|['"`]([^'"`]+)['"`])/g;

  let preloadMatch: RegExpExecArray | null = preloadPattern.exec(sourceText);
  while (preloadMatch) {
    const preloadValue = preloadMatch[1] ?? preloadMatch[2];
    if (preloadValue) {
      preloadScripts.add(preloadValue.trim());
    }
    preloadMatch = preloadPattern.exec(sourceText);
  }

  const explicitDevToolsMatch = sourceText.match(/devTools\s*:\s*(true|false)/);
  let devToolsEnabled: boolean | null = null;

  if (explicitDevToolsMatch?.[1]) {
    devToolsEnabled = explicitDevToolsMatch[1] === 'true';
  }

  if (/\.openDevTools\s*\(/.test(sourceText)) {
    devToolsEnabled = true;
  }

  return {
    preloadScripts: Array.from(preloadScripts),
    devToolsEnabled,
  };
}

async function findFilesystemPreloadScripts(rootDir: string): Promise<string[]> {
  const matches = new Set<string>();

  await walkDirectory(rootDir, async (absolutePath, _fileStats) => {
    const lowerName = basename(absolutePath).toLowerCase();
    const lowerExt = extname(absolutePath).toLowerCase();
    if (lowerExt === '.js' && lowerName.includes('preload')) {
      matches.add(toDisplayPath(absolutePath));
    }
  });

  return Array.from(matches).sort().slice(0, 100);
}

// ---------------------------------------------------------------------------
// Public handler class
// ---------------------------------------------------------------------------

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
            reason:
              'Entry is marked as unpacked and not stored inside app.asar',
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
          const outputPath = resolveSafeOutputPath(
            outputDirectory.absolutePath,
            entry.path
          );

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
      const scanRoot = appStats.isDirectory()
        ? absoluteAppPath
        : dirname(absoluteAppPath);

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
          (entry) =>
            entry.path === 'package.json' ||
            entry.path.endsWith('/package.json')
        );

        if (packageEntry) {
          const packageText = readAsarEntryText(
            asarBuffer,
            parsedAsar,
            packageEntry.path
          );

          if (packageText) {
            try {
              const parsed = JSON.parse(packageText) as unknown;
              if (isRecord(parsed)) {
                packageJson = parsed;
                packageJsonPath = packageEntry.path;
                packageSource = 'asar';
              }
            } catch (error) {
              logger.warn(
                'electron_inspect_app invalid package.json in asar',
                {
                  packagePath: packageEntry.path,
                  error:
                    error instanceof Error ? error.message : String(error),
                }
              );
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
          error:
            'Cannot locate package.json in app directory or app.asar',
          appPath: absoluteAppPath.replace(/\\/g, '/'),
          scanRoot: scanRoot.replace(/\\/g, '/'),
          asarPath: asarPath ? asarPath.replace(/\\/g, '/') : null,
          collectorState: getCollectorState(this.collector),
        });
      }

      const mainEntry =
        typeof packageJson.main === 'string' &&
        packageJson.main.trim().length > 0
          ? packageJson.main.trim()
          : 'index.js';

      const version =
        typeof packageJson.version === 'string'
          ? packageJson.version
          : null;

      const dependenciesRaw = packageJson.dependencies;
      const dependencies = isRecord(dependenciesRaw)
        ? Object.keys(dependenciesRaw).sort()
        : [];

      let mainScriptSource = '';
      let mainScriptPath = '';

      if (packageSource === 'asar' && parsedAsar && asarBuffer) {
        const packageBase =
          packageJsonPath.length > 0 ? dirname(packageJsonPath) : '';
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
            const fallbackText = readAsarEntryText(
              asarBuffer,
              parsedAsar,
              fallbackEntry.path
            );
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
              logger.warn(
                'electron_inspect_app failed to read main script',
                {
                  absoluteMainPath,
                  error:
                    error instanceof Error ? error.message : String(error),
                }
              );
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
        parsedHints.devToolsEnabled !== null
          ? parsedHints.devToolsEnabled
          : true;

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
          packageSource === 'filesystem'
            ? toDisplayPath(packageJsonPath)
            : packageJsonPath,
        mainScriptPath:
          mainScriptPath.length > 0
            ? packageSource === 'filesystem'
              ? toDisplayPath(mainScriptPath)
              : mainScriptPath
            : null,
        asarPath: asarPath ? toDisplayPath(asarPath) : null,
        browserWindowDetected:
          mainScriptSource.length > 0
            ? mainScriptSource.includes('BrowserWindow')
            : false,
        collectorState: getCollectorState(this.collector),
      });
    } catch (error) {
      return toErrorResponse('electron_inspect_app', error);
    }
  }
}
