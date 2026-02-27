import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import type { CodeCollector } from '../../../../modules/collector/CodeCollector.js';
import { ExternalToolRunner } from '../../../../modules/external/ExternalToolRunner.js';
import { logger } from '../../../../utils/logger.js';
import {
  toTextResponse,
  toErrorResponse,
  getCollectorState,
  parseStringArg,
  isRecord,
  toStringArray,
  toDisplayPath,
  getDefaultSearchPaths,
  walkDirectory,
  resolveOutputDirectory,
  resolveSafeOutputPath,
  readJsonFileSafe,
  extractAppIdFromPath,
  type MiniappPkgScanItem,
  type MiniappPkgEntry,
  type ParsedMiniappPkg,
} from './platform-utils.js';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function parseMiniappPkgBuffer(buffer: Buffer): ParsedMiniappPkg {
  if (buffer.length < 18) {
    throw new Error('Invalid miniapp package: file too small');
  }

  const magic = buffer.readUInt8(0);
  if (magic !== 0xbe) {
    throw new Error(
      `Invalid miniapp package magic: expected 0xBE, got 0x${magic.toString(16)}`
    );
  }

  const info = buffer.readUInt32BE(1);
  const indexInfoLength = buffer.readUInt32BE(5);
  const dataLength = buffer.readUInt32BE(9);
  const lastIdent = buffer.readUInt8(13);

  const indexStart = 14;
  const indexEnd = indexStart + indexInfoLength;
  if (indexEnd > buffer.length) {
    throw new Error('Invalid miniapp package: index section out of range');
  }

  let cursor = indexStart;
  if (cursor + 4 > indexEnd) {
    throw new Error('Invalid miniapp package: missing file count in index');
  }

  const fileCount = buffer.readUInt32BE(cursor);
  cursor += 4;

  const entries: MiniappPkgEntry[] = [];
  for (let i = 0; i < fileCount; i += 1) {
    if (cursor + 4 > indexEnd) {
      throw new Error(
        `Invalid miniapp package index at entry ${i}: missing nameLen`
      );
    }

    const nameLen = buffer.readUInt32BE(cursor);
    cursor += 4;

    if (nameLen <= 0 || cursor + nameLen > indexEnd) {
      throw new Error(
        `Invalid miniapp package index at entry ${i}: invalid nameLen`
      );
    }

    const name = buffer.subarray(cursor, cursor + nameLen).toString('utf-8');
    cursor += nameLen;

    if (cursor + 8 > indexEnd) {
      throw new Error(
        `Invalid miniapp package index at entry ${i}: missing offset/size`
      );
    }

    const offset = buffer.readUInt32BE(cursor);
    cursor += 4;
    const size = buffer.readUInt32BE(cursor);
    cursor += 4;

    entries.push({ name, offset, size });
  }

  return {
    magic,
    info,
    indexInfoLength,
    dataLength,
    lastIdent,
    dataOffset: indexEnd,
    entries,
  };
}

async function tryExternalUnpack(
  runner: ExternalToolRunner,
  inputPath: string,
  outputDir: string
): Promise<{ used: boolean; command?: string; stderr?: string }> {
  const probes = await runner.probeAll();
  const miniappPkgProbe = probes['miniapp.unpacker'];

  if (!miniappPkgProbe?.available) {
    return {
      used: false,
      stderr: miniappPkgProbe?.reason ?? '外部解包工具 is unavailable',
    };
  }

  const attempts: string[][] = [
    ['unpack', inputPath, '-o', outputDir],
    ['unpack', '-o', outputDir, inputPath],
    ['-o', outputDir, inputPath],
    [inputPath, outputDir],
  ];

  let lastError = '外部解包工具 failed for all argument patterns';

  for (const attempt of attempts) {
    const result = await runner.run({
      tool: 'miniapp.unpacker',
      args: attempt,
      timeoutMs: 180_000,
      cwd: dirname(inputPath),
    });

    if (result.ok) {
      return {
        used: true,
        command: `unveilr ${attempt.join(' ')}`,
      };
    }

    lastError = result.stderr?.trim() || `exitCode=${String(result.exitCode)}`;
  }

  return { used: false, stderr: lastError };
}

// ---------------------------------------------------------------------------
// Public handler class
// ---------------------------------------------------------------------------

export class MiniappHandlers {
  private runner: ExternalToolRunner;
  private collector: CodeCollector;

  constructor(runner: ExternalToolRunner, collector: CodeCollector) {
    this.runner = runner;
    this.collector = collector;
  }

  async handleMiniappPkgScan(args: Record<string, unknown>) {
    try {
      const searchPath = parseStringArg(args, 'searchPath');
      const candidateRoots = searchPath
        ? [resolve(searchPath)]
        : getDefaultSearchPaths();

      const searchedRoots: string[] = [];
      const skippedRoots: string[] = [];

      for (const root of candidateRoots) {
        try {
          const rootStats = await stat(root);
          if (rootStats.isDirectory()) {
            searchedRoots.push(root);
          } else {
            skippedRoots.push(root);
          }
        } catch {
          skippedRoots.push(root);
        }
      }

      const foundFiles: MiniappPkgScanItem[] = [];

      for (const root of searchedRoots) {
        await walkDirectory(root, async (absolutePath, fileStats) => {
          const ext = extname(absolutePath).toLowerCase();
          if (ext !== '.wxapkg' && ext !== '.ttpkg' && ext !== '.bdpkg') {
            return;
          }

          foundFiles.push({
            path: absolutePath.replace(/\\/g, '/'),
            size: Number(fileStats.size),
            appId: extractAppIdFromPath(absolutePath),
            lastModified: fileStats.mtime.toISOString(),
          });
        });
      }

      foundFiles.sort(
        (left, right) =>
          new Date(right.lastModified).getTime() -
          new Date(left.lastModified).getTime()
      );

      return toTextResponse({
        success: true,
        searchedRoots: searchedRoots.map((item) => item.replace(/\\/g, '/')),
        skippedRoots: skippedRoots.map((item) => item.replace(/\\/g, '/')),
        count: foundFiles.length,
        files: foundFiles,
        collectorState: getCollectorState(this.collector),
      });
    } catch (error) {
      return toErrorResponse('miniapp_pkg_scan', error);
    }
  }

  async handleMiniappPkgUnpack(args: Record<string, unknown>) {
    try {
      const inputPath = parseStringArg(args, 'inputPath', true);
      const outputDirArg = parseStringArg(args, 'outputDir');

      if (!inputPath) {
        throw new Error('inputPath is required');
      }

      const absoluteInputPath = resolve(inputPath);
      const inputStats = await stat(absoluteInputPath);

      if (!inputStats.isFile()) {
        throw new Error('inputPath must be a file');
      }

      const outputIdentity =
        extractAppIdFromPath(absoluteInputPath) ??
        basename(absoluteInputPath, extname(absoluteInputPath));

      const outputDirectory = await resolveOutputDirectory(
        'miniapp-unpack',
        outputIdentity,
        outputDirArg
      );

      await mkdir(outputDirectory.absolutePath, { recursive: true });

      const externalAttempt = await tryExternalUnpack(
        this.runner,
        absoluteInputPath,
        outputDirectory.absolutePath
      );

      if (externalAttempt.used) {
        let extractedByCli = 0;
        await walkDirectory(
          outputDirectory.absolutePath,
          async (_absolutePath, _fileStats) => {
            extractedByCli += 1;
          }
        );

        if (extractedByCli > 0) {
          return toTextResponse({
            success: true,
            usedExternalCli: true,
            cliCommand: externalAttempt.command ?? null,
            outputDir: outputDirectory.displayPath,
            extractedFiles: extractedByCli,
            appId: extractAppIdFromPath(absoluteInputPath),
            collectorState: getCollectorState(this.collector),
          });
        }

        logger.warn(
          '外部解包工具 succeeded but produced no output, fallback to parser',
          {
            inputPath: absoluteInputPath,
            outputDir: outputDirectory.absolutePath,
          }
        );
      }

      const pkgBuffer = await readFile(absoluteInputPath);
      const parsed = parseMiniappPkgBuffer(pkgBuffer);

      const failedFiles: Array<{ path: string; reason: string }> = [];
      let extractedFiles = 0;
      let totalBytesExtracted = 0;

      for (const [index, entry] of parsed.entries.entries()) {
        const logicalPath =
          entry.name.trim().length > 0 ? entry.name : `file-${index}.bin`;

        try {
          let start = entry.offset;
          let end = start + entry.size;

          if (start < 0 || end > pkgBuffer.length) {
            const fallbackStart = parsed.dataOffset + entry.offset;
            const fallbackEnd = fallbackStart + entry.size;
            if (fallbackStart >= 0 && fallbackEnd <= pkgBuffer.length) {
              start = fallbackStart;
              end = fallbackEnd;
            } else {
              throw new Error('entry offset out of range');
            }
          }

          const data = pkgBuffer.subarray(start, end);
          const outputFilePath = resolveSafeOutputPath(
            outputDirectory.absolutePath,
            logicalPath
          );

          await mkdir(dirname(outputFilePath), { recursive: true });
          await writeFile(outputFilePath, data);

          extractedFiles += 1;
          totalBytesExtracted += data.length;
        } catch (error) {
          failedFiles.push({
            path: logicalPath,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return toTextResponse({
        success: extractedFiles > 0,
        usedExternalCli: false,
        cliError: externalAttempt.stderr ?? null,
        outputDir: outputDirectory.displayPath,
        appId: extractAppIdFromPath(absoluteInputPath),
        header: {
          magic: parsed.magic,
          info: parsed.info,
          indexInfoLength: parsed.indexInfoLength,
          dataLength: parsed.dataLength,
          lastIdent: parsed.lastIdent,
        },
        fileCount: parsed.entries.length,
        extractedFiles,
        totalBytesExtracted,
        failedFiles,
        collectorState: getCollectorState(this.collector),
      });
    } catch (error) {
      return toErrorResponse('miniapp_pkg_unpack', error);
    }
  }

  async handleMiniappPkgAnalyze(args: Record<string, unknown>) {
    try {
      const unpackedDir = parseStringArg(args, 'unpackedDir', true);
      if (!unpackedDir) {
        throw new Error('unpackedDir is required');
      }

      const absoluteUnpackedDir = resolve(unpackedDir);
      const unpackedStats = await stat(absoluteUnpackedDir);

      if (!unpackedStats.isDirectory()) {
        throw new Error('unpackedDir must be a directory');
      }

      const pages = new Set<string>();
      const components = new Set<string>();
      const jsFiles: string[] = [];
      let totalSize = 0;

      let appJsonPath: string | undefined;
      let appConfigPath: string | undefined;
      let pageFramePath: string | undefined;

      await walkDirectory(
        absoluteUnpackedDir,
        async (absolutePath, fileStats) => {
          totalSize += Number(fileStats.size);

          const relPath = relative(absoluteUnpackedDir, absolutePath).replace(
            /\\/g,
            '/'
          );
          const lowerName = basename(absolutePath).toLowerCase();
          const lowerExt = extname(absolutePath).toLowerCase();

          if (lowerName === 'app.json' && !appJsonPath) {
            appJsonPath = absolutePath;
          } else if (lowerName === 'app-config.json' && !appConfigPath) {
            appConfigPath = absolutePath;
          } else if (lowerName === 'page-frame.html' && !pageFramePath) {
            pageFramePath = absolutePath;
          }

          if (lowerExt === '.js') {
            jsFiles.push(relPath);
          }

          if (
            relPath.includes('/components/') &&
            ['.js', '.wxml', '.json', '.wxss'].includes(lowerExt)
          ) {
            components.add(relPath);
          }
        }
      );

      const subPackages: Array<{ root: string; pages: string[] }> = [];
      let appId: string | null = null;

      if (appJsonPath) {
        const appJson = await readJsonFileSafe(appJsonPath);
        if (appJson) {
          for (const page of toStringArray(appJson.pages)) {
            pages.add(page);
          }

          const subPackagesRaw = appJson.subPackages ?? appJson.subpackages;
          if (Array.isArray(subPackagesRaw)) {
            for (const item of subPackagesRaw) {
              if (!isRecord(item)) {
                continue;
              }

              const root =
                typeof item.root === 'string' ? item.root.trim() : '';
              const packagePages = toStringArray(item.pages);
              subPackages.push({
                root,
                pages: packagePages,
              });

              for (const page of packagePages) {
                if (root.length > 0) {
                  pages.add(`${root}/${page}`);
                } else {
                  pages.add(page);
                }
              }
            }
          }

          const usingComponents = appJson.usingComponents;
          if (isRecord(usingComponents)) {
            for (const componentPath of Object.values(usingComponents)) {
              if (typeof componentPath === 'string' && componentPath.trim()) {
                components.add(componentPath.trim());
              }
            }
          }

          const appIdFromAppJson =
            typeof appJson.appId === 'string'
              ? appJson.appId
              : typeof appJson.appid === 'string'
              ? appJson.appid
              : null;

          if (appIdFromAppJson && appIdFromAppJson.trim().length > 0) {
            appId = appIdFromAppJson.trim();
          }
        }
      }

      if (appConfigPath) {
        const appConfig = await readJsonFileSafe(appConfigPath);
        if (appConfig) {
          const appIdFromConfig =
            typeof appConfig.appId === 'string'
              ? appConfig.appId
              : typeof appConfig.appid === 'string'
              ? appConfig.appid
              : null;

          if (appIdFromConfig && appIdFromConfig.trim().length > 0 && !appId) {
            appId = appIdFromConfig.trim();
          }

          for (const page of toStringArray(appConfig.pages)) {
            pages.add(page);
          }
        }
      }

      if (!appId) {
        appId = extractAppIdFromPath(absoluteUnpackedDir);
      }

      return toTextResponse({
        success: true,
        unpackedDir: absoluteUnpackedDir.replace(/\\/g, '/'),
        pages: Array.from(pages).sort(),
        subPackages,
        components: Array.from(components).sort(),
        jsFiles: jsFiles.sort(),
        totalSize,
        appId,
        discovered: {
          appJsonPath: appJsonPath ? toDisplayPath(appJsonPath) : null,
          appConfigPath: appConfigPath ? toDisplayPath(appConfigPath) : null,
          pageFramePath: pageFramePath ? toDisplayPath(pageFramePath) : null,
        },
        collectorState: getCollectorState(this.collector),
      });
    } catch (error) {
      return toErrorResponse('miniapp_pkg_analyze', error);
    }
  }
}
