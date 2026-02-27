import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'node:path';
import { homedir } from 'node:os';
import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import { ExternalToolRunner } from '../../../modules/external/ExternalToolRunner.js';
import { ToolRegistry } from '../../../modules/external/ToolRegistry.js';
import { resolveArtifactPath } from '../../../utils/artifacts.js';
import { logger } from '../../../utils/logger.js';

type FsStats = Awaited<ReturnType<typeof stat>>;

interface MiniappPkgScanItem {
  path: string;
  size: number;
  appId: string | null;
  lastModified: string;
}

interface MiniappPkgEntry {
  name: string;
  offset: number;
  size: number;
}

interface ParsedMiniappPkg {
  magic: number;
  info: number;
  indexInfoLength: number;
  dataLength: number;
  lastIdent: number;
  dataOffset: number;
  entries: MiniappPkgEntry[];
}

interface AsarFileEntry {
  path: string;
  size: number;
  offset: number;
  unpacked: boolean;
}

interface ParsedAsar {
  files: AsarFileEntry[];
  dataOffset: number;
  headerSize: number;
  headerStringSize: number;
  headerContentSize: number;
  padding: number;
}

export class PlatformToolHandlers {
  private runner: ExternalToolRunner;
  private registry: ToolRegistry;
  private collector: CodeCollector;

  constructor(collector: CodeCollector) {
    this.collector = collector;
    this.registry = new ToolRegistry();
    this.runner = new ExternalToolRunner(this.registry);
  }

  private toTextResponse(payload: Record<string, unknown>) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  private toErrorResponse(
    tool: string,
    error: unknown,
    extra: Record<string, unknown> = {}
  ) {
    return this.toTextResponse({
      success: false,
      tool,
      error: error instanceof Error ? error.message : String(error),
      ...extra,
    });
  }

  private getCollectorState(): string {
    void this.collector;
    return 'attached';
  }

  private parseStringArg(
    args: Record<string, unknown>,
    key: string,
    required = false
  ): string | undefined {
    const value = args[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
    if (required) {
      throw new Error(`${key} must be a non-empty string`);
    }
    return undefined;
  }

  private parseBooleanArg(
    args: Record<string, unknown>,
    key: string,
    defaultValue: boolean
  ): boolean {
    const value = args[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
      if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    }
    return defaultValue;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const output: string[] = [];
    for (const item of value) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed.length > 0) {
          output.push(trimmed);
        }
      }
    }
    return output;
  }

  private toDisplayPath(absolutePath: string): string {
    const relPath = relative(process.cwd(), absolutePath).replace(/\\/g, '/');
    if (relPath.length === 0) {
      return '.';
    }
    return relPath.startsWith('..')
      ? absolutePath.replace(/\\/g, '/')
      : relPath;
  }

  private async pathExists(targetPath: string): Promise<boolean> {
    try {
      await stat(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private getDefaultSearchPaths(): string[] {
    const userProfile = process.env.USERPROFILE ?? homedir();
    const appData =
      process.env.APPDATA ?? join(userProfile, 'AppData', 'Roaming');

    // Scan common miniapp platform cache directories
    // Paths are platform-generic; actual subdirectories vary by vendor
    const candidates = [
      join(userProfile, 'Documents'),
      join(appData),
    ];

    // Walk one level to find known miniapp cache subdirectory patterns
    const knownSubPatterns = ['Applet', 'XPlugin', 'MiniApp'];
    const resolvedPaths: string[] = [];

    for (const base of candidates) {
      for (const sub of knownSubPatterns) {
        resolvedPaths.push(resolve(base, sub));
      }
    }

    return Array.from(new Set(resolvedPaths));
  }

  private extractAppIdFromPath(filePath: string): string | null {
    const normalizedPath = filePath.replace(/\\/g, '/');

    const pathPatterns = [
      /\/([a-zA-Z]{2,4}[a-zA-Z0-9]{6,})\//,  // Generic miniapp ID pattern (2-4 letter prefix + alphanumeric)
      /\/Applet\/([^/]+)\//i,                   // Generic applet directory
    ];

    for (const pattern of pathPatterns) {
      const match = normalizedPath.match(pattern);
      if (match?.[1]) {
        return match[1];
      }
    }

    const base = basename(filePath, extname(filePath));
    const fileMatch = base.match(/([a-zA-Z]{2,4}[a-zA-Z0-9]{6,})/);
    if (fileMatch?.[1]) {
      return fileMatch[1];
    }

    return null;
  }

  private sanitizeArchiveRelativePath(rawPath: string): string {
    const normalizedPath = normalize(rawPath.replace(/\\/g, '/')).replace(
      /\\/g,
      '/'
    );
    const segments = normalizedPath
      .split('/')
      .filter(
        (segment) =>
          segment.length > 0 && segment !== '.' && segment !== '..'
      );

    return segments.join('/');
  }

  private resolveSafeOutputPath(rootDir: string, rawRelativePath: string): string {
    const sanitized = this.sanitizeArchiveRelativePath(rawRelativePath);
    const fallbackName = basename(rawRelativePath) || 'unnamed.bin';
    const safeRelative = sanitized.length > 0 ? sanitized : fallbackName;
    const outputPath = resolve(rootDir, safeRelative);

    const normalizedRoot = resolve(rootDir);
    if (
      outputPath !== normalizedRoot &&
      !outputPath.startsWith(`${normalizedRoot}${sep}`)
    ) {
      throw new Error(`Path traversal blocked: ${rawRelativePath}`);
    }

    return outputPath;
  }

  private async walkDirectory(
    rootDir: string,
    onFile: (absolutePath: string, fileStats: FsStats) => Promise<void>
  ): Promise<void> {
    const stack: string[] = [resolve(rootDir)];

    while (stack.length > 0) {
      const currentDir = stack.pop();
      if (!currentDir) {
        continue;
      }

      let entries: import('node:fs').Dirent[];
      try {
        entries = await readdir(currentDir, { withFileTypes: true }) as unknown as import('node:fs').Dirent[];
      } catch (error) {
        logger.debug('walkDirectory skip unreadable directory', {
          currentDir,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      for (const entry of entries) {
        const absolutePath = join(currentDir, String(entry.name));

        if (entry.isDirectory()) {
          stack.push(absolutePath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        try {
          const fileStats = await stat(absolutePath);
          await onFile(absolutePath, fileStats);
        } catch (error) {
          logger.warn('walkDirectory skip unreadable file', {
            absolutePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  private async resolveOutputDirectory(
    toolName: string,
    target: string,
    requestedDir?: string
  ): Promise<{ absolutePath: string; displayPath: string }> {
    if (requestedDir) {
      const absolutePath = resolve(requestedDir);
      await mkdir(absolutePath, { recursive: true });
      return { absolutePath, displayPath: this.toDisplayPath(absolutePath) };
    }

    const { absolutePath: markerPath, displayPath: markerDisplayPath } =
      await resolveArtifactPath({
        category: 'tmp',
        toolName,
        target,
        ext: 'tmpdir',
      });

    const generatedDir = markerPath.replace(/\.tmpdir$/i, '');
    await mkdir(generatedDir, { recursive: true });

    return {
      absolutePath: generatedDir,
      displayPath: markerDisplayPath.replace(/\.tmpdir$/i, ''),
    };
  }

  private parseMiniappPkgBuffer(buffer: Buffer): ParsedMiniappPkg {
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
        throw new Error(`Invalid miniapp package index at entry ${i}: missing nameLen`);
      }

      const nameLen = buffer.readUInt32BE(cursor);
      cursor += 4;

      if (nameLen <= 0 || cursor + nameLen > indexEnd) {
        throw new Error(`Invalid miniapp package index at entry ${i}: invalid nameLen`);
      }

      const name = buffer.subarray(cursor, cursor + nameLen).toString('utf-8');
      cursor += nameLen;

      if (cursor + 8 > indexEnd) {
        throw new Error(`Invalid miniapp package index at entry ${i}: missing offset/size`);
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

  private async tryExternalUnpack(
    inputPath: string,
    outputDir: string
  ): Promise<{ used: boolean; command?: string; stderr?: string }> {
    const probes = await this.runner.probeAll();
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
      const result = await this.runner.run({
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

  private flattenAsarEntries(headerNode: Record<string, unknown>): AsarFileEntry[] {
    if (!this.isRecord(headerNode.files)) {
      return [];
    }

    const files: AsarFileEntry[] = [];

    const walk = (nodes: Record<string, unknown>, prefix: string): void => {
      for (const [name, rawNode] of Object.entries(nodes)) {
        if (!this.isRecord(rawNode)) {
          continue;
        }

        const pathPart = prefix.length > 0 ? `${prefix}/${name}` : name;

        if (this.isRecord(rawNode.files)) {
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
          path: this.sanitizeArchiveRelativePath(pathPart),
          size,
          offset,
          unpacked,
        });
      }
    };

    walk(headerNode.files, '');
    return files;
  }

  private isAsarDataOffsetValid(
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

  private parseAsarBuffer(asarBuffer: Buffer): ParsedAsar {
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
    ).filter(
      (value) => value > 0 && headerStart + value <= asarBuffer.length
    );

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
        if (this.isRecord(parsed)) {
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

    const rootNode = this.isRecord(headerObject.files)
      ? headerObject
      : { files: headerObject };

    const files = this.flattenAsarEntries(rootNode);

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
      if (this.isAsarDataOffsetValid(files, candidate, asarBuffer.length)) {
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

  private readAsarEntryBuffer(
    asarBuffer: Buffer,
    parsedAsar: ParsedAsar,
    entryPath: string
  ): Buffer | undefined {
    const normalizedEntryPath = this.sanitizeArchiveRelativePath(entryPath);
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

  private readAsarEntryText(
    asarBuffer: Buffer,
    parsedAsar: ParsedAsar,
    entryPath: string
  ): string | undefined {
    const data = this.readAsarEntryBuffer(asarBuffer, parsedAsar, entryPath);
    return data ? data.toString('utf-8') : undefined;
  }

  private parseBrowserWindowHints(sourceText: string): {
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

  private async findFilesystemPreloadScripts(rootDir: string): Promise<string[]> {
    const matches = new Set<string>();

    await this.walkDirectory(rootDir, async (absolutePath, _fileStats) => {
      const lowerName = basename(absolutePath).toLowerCase();
      const lowerExt = extname(absolutePath).toLowerCase();
      if (lowerExt === '.js' && lowerName.includes('preload')) {
        matches.add(this.toDisplayPath(absolutePath));
      }
    });

    return Array.from(matches).sort().slice(0, 100);
  }

  private async readJsonFileSafe(
    filePath: string
  ): Promise<Record<string, unknown> | null> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      return this.isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async handleMiniappPkgScan(args: Record<string, unknown>) {
    try {
      const searchPath = this.parseStringArg(args, 'searchPath');
      const candidateRoots = searchPath
        ? [resolve(searchPath)]
        : this.getDefaultSearchPaths();

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
        await this.walkDirectory(root, async (absolutePath, fileStats) => {
          const ext = extname(absolutePath).toLowerCase();
          if (ext !== '.wxapkg' && ext !== '.ttpkg' && ext !== '.bdpkg') {
            return;
          }

          foundFiles.push({
            path: absolutePath.replace(/\\/g, '/'),
            size: Number(fileStats.size),
            appId: this.extractAppIdFromPath(absolutePath),
            lastModified: fileStats.mtime.toISOString(),
          });
        });
      }

      foundFiles.sort(
        (left, right) =>
          new Date(right.lastModified).getTime() -
          new Date(left.lastModified).getTime()
      );

      return this.toTextResponse({
        success: true,
        searchedRoots: searchedRoots.map((item) => item.replace(/\\/g, '/')),
        skippedRoots: skippedRoots.map((item) => item.replace(/\\/g, '/')),
        count: foundFiles.length,
        files: foundFiles,
        collectorState: this.getCollectorState(),
      });
    } catch (error) {
      return this.toErrorResponse('miniapp_pkg_scan', error);
    }
  }

  async handleMiniappPkgUnpack(args: Record<string, unknown>) {
    try {
      const inputPath = this.parseStringArg(args, 'inputPath', true);
      const outputDirArg = this.parseStringArg(args, 'outputDir');

      if (!inputPath) {
        throw new Error('inputPath is required');
      }

      const absoluteInputPath = resolve(inputPath);
      const inputStats = await stat(absoluteInputPath);

      if (!inputStats.isFile()) {
        throw new Error('inputPath must be a file');
      }

      const outputIdentity =
        this.extractAppIdFromPath(absoluteInputPath) ??
        basename(absoluteInputPath, extname(absoluteInputPath));

      const outputDirectory = await this.resolveOutputDirectory(
        'miniapp-unpack',
        outputIdentity,
        outputDirArg
      );

      await mkdir(outputDirectory.absolutePath, { recursive: true });

      const externalAttempt = await this.tryExternalUnpack(
        absoluteInputPath,
        outputDirectory.absolutePath
      );

      if (externalAttempt.used) {
        let extractedByCli = 0;
        await this.walkDirectory(
          outputDirectory.absolutePath,
          async (_absolutePath, _fileStats) => {
            extractedByCli += 1;
          }
        );

        if (extractedByCli > 0) {
          return this.toTextResponse({
            success: true,
            usedExternalCli: true,
            cliCommand: externalAttempt.command ?? null,
            outputDir: outputDirectory.displayPath,
            extractedFiles: extractedByCli,
            appId: this.extractAppIdFromPath(absoluteInputPath),
            collectorState: this.getCollectorState(),
          });
        }

        logger.warn('外部解包工具 succeeded but produced no output, fallback to parser', {
          inputPath: absoluteInputPath,
          outputDir: outputDirectory.absolutePath,
        });
      }

      const pkgBuffer = await readFile(absoluteInputPath);
      const parsed = this.parseMiniappPkgBuffer(pkgBuffer);

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
          const outputFilePath = this.resolveSafeOutputPath(
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

      return this.toTextResponse({
        success: extractedFiles > 0,
        usedExternalCli: false,
        cliError: externalAttempt.stderr ?? null,
        outputDir: outputDirectory.displayPath,
        appId: this.extractAppIdFromPath(absoluteInputPath),
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
        collectorState: this.getCollectorState(),
      });
    } catch (error) {
      return this.toErrorResponse('miniapp_pkg_unpack', error);
    }
  }

  async handleMiniappPkgAnalyze(args: Record<string, unknown>) {
    try {
      const unpackedDir = this.parseStringArg(args, 'unpackedDir', true);
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

      await this.walkDirectory(
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
        const appJson = await this.readJsonFileSafe(appJsonPath);
        if (appJson) {
          for (const page of this.toStringArray(appJson.pages)) {
            pages.add(page);
          }

          const subPackagesRaw =
            appJson.subPackages ?? appJson.subpackages;
          if (Array.isArray(subPackagesRaw)) {
            for (const item of subPackagesRaw) {
              if (!this.isRecord(item)) {
                continue;
              }

              const root =
                typeof item.root === 'string' ? item.root.trim() : '';
              const packagePages = this.toStringArray(item.pages);
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
          if (this.isRecord(usingComponents)) {
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
        const appConfig = await this.readJsonFileSafe(appConfigPath);
        if (appConfig) {
          const appIdFromConfig =
            typeof appConfig.appId === 'string'
              ? appConfig.appId
              : typeof appConfig.appid === 'string'
              ? appConfig.appid
              : null;

          if (
            appIdFromConfig &&
            appIdFromConfig.trim().length > 0 &&
            !appId
          ) {
            appId = appIdFromConfig.trim();
          }

          for (const page of this.toStringArray(appConfig.pages)) {
            pages.add(page);
          }
        }
      }

      if (!appId) {
        appId = this.extractAppIdFromPath(absoluteUnpackedDir);
      }

      return this.toTextResponse({
        success: true,
        unpackedDir: absoluteUnpackedDir.replace(/\\/g, '/'),
        pages: Array.from(pages).sort(),
        subPackages,
        components: Array.from(components).sort(),
        jsFiles: jsFiles.sort(),
        totalSize,
        appId,
        discovered: {
          appJsonPath: appJsonPath
            ? this.toDisplayPath(appJsonPath)
            : null,
          appConfigPath: appConfigPath
            ? this.toDisplayPath(appConfigPath)
            : null,
          pageFramePath: pageFramePath
            ? this.toDisplayPath(pageFramePath)
            : null,
        },
        collectorState: this.getCollectorState(),
      });
    } catch (error) {
      return this.toErrorResponse('miniapp_pkg_analyze', error);
    }
  }

  async handleAsarExtract(args: Record<string, unknown>) {
    try {
      const inputPath = this.parseStringArg(args, 'inputPath', true);
      const outputDirArg = this.parseStringArg(args, 'outputDir');
      const listOnly = this.parseBooleanArg(args, 'listOnly', false);

      if (!inputPath) {
        throw new Error('inputPath is required');
      }

      const absoluteInputPath = resolve(inputPath);
      const inputStats = await stat(absoluteInputPath);
      if (!inputStats.isFile()) {
        throw new Error('inputPath must be a file');
      }

      const asarBuffer = await readFile(absoluteInputPath);
      const parsedAsar = this.parseAsarBuffer(asarBuffer);

      const files = parsedAsar.files.map((entry) => ({
        path: entry.path,
        size: entry.size,
        offset: entry.offset,
      }));

      const totalSize = files.reduce((sum, entry) => sum + entry.size, 0);

      if (listOnly) {
        return this.toTextResponse({
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
          collectorState: this.getCollectorState(),
        });
      }

      const outputDirectory = await this.resolveOutputDirectory(
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
          const outputPath = this.resolveSafeOutputPath(
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

      return this.toTextResponse({
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
        collectorState: this.getCollectorState(),
      });
    } catch (error) {
      return this.toErrorResponse('asar_extract', error);
    }
  }

  async handleElectronInspectApp(args: Record<string, unknown>) {
    try {
      const appPath = this.parseStringArg(args, 'appPath', true);
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
        if (!(await this.pathExists(candidate))) {
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
          parsedAsar = this.parseAsarBuffer(asarBuffer);
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
          const packageText = this.readAsarEntryText(
            asarBuffer,
            parsedAsar,
            packageEntry.path
          );

          if (packageText) {
            try {
              const parsed = JSON.parse(packageText) as unknown;
              if (this.isRecord(parsed)) {
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
          const candidateJson = await this.readJsonFileSafe(candidate);
          if (candidateJson) {
            packageJson = candidateJson;
            packageJsonPath = candidate;
            packageSource = 'filesystem';
            break;
          }
        }
      }

      if (!packageJson) {
        return this.toTextResponse({
          success: false,
          tool: 'electron_inspect_app',
          error: 'Cannot locate package.json in app directory or app.asar',
          appPath: absoluteAppPath.replace(/\\/g, '/'),
          scanRoot: scanRoot.replace(/\\/g, '/'),
          asarPath: asarPath ? asarPath.replace(/\\/g, '/') : null,
          collectorState: this.getCollectorState(),
        });
      }

      const mainEntry =
        typeof packageJson.main === 'string' && packageJson.main.trim().length > 0
          ? packageJson.main.trim()
          : 'index.js';

      const version =
        typeof packageJson.version === 'string'
          ? packageJson.version
          : null;

      const dependenciesRaw = packageJson.dependencies;
      const dependencies = this.isRecord(dependenciesRaw)
        ? Object.keys(dependenciesRaw).sort()
        : [];

      let mainScriptSource = '';
      let mainScriptPath = '';

      if (packageSource === 'asar' && parsedAsar && asarBuffer) {
        const packageBase =
          packageJsonPath.length > 0 ? dirname(packageJsonPath) : '';
        const candidateMainPaths = Array.from(
          new Set([
            this.sanitizeArchiveRelativePath(join(packageBase, mainEntry)),
            this.sanitizeArchiveRelativePath(mainEntry),
            this.sanitizeArchiveRelativePath(basename(mainEntry)),
          ])
        ).filter((value) => value.length > 0);

        for (const candidate of candidateMainPaths) {
          const text = this.readAsarEntryText(asarBuffer, parsedAsar, candidate);
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
            const fallbackText = this.readAsarEntryText(
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

        if (await this.pathExists(absoluteMainPath)) {
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
          ? this.parseBrowserWindowHints(mainScriptSource)
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
        const filesystemPreloads = await this.findFilesystemPreloadScripts(scanRoot);
        for (const preload of filesystemPreloads) {
          preloadScripts.add(preload);
        }
      }

      const devToolsEnabled =
        parsedHints.devToolsEnabled !== null
          ? parsedHints.devToolsEnabled
          : true;

      return this.toTextResponse({
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
            ? this.toDisplayPath(packageJsonPath)
            : packageJsonPath,
        mainScriptPath:
          mainScriptPath.length > 0
            ? packageSource === 'filesystem'
              ? this.toDisplayPath(mainScriptPath)
              : mainScriptPath
            : null,
        asarPath: asarPath ? this.toDisplayPath(asarPath) : null,
        browserWindowDetected:
          mainScriptSource.length > 0
            ? mainScriptSource.includes('BrowserWindow')
            : false,
        collectorState: this.getCollectorState(),
      });
    } catch (error) {
      return this.toErrorResponse('electron_inspect_app', error);
    }
  }

  async handleFridaBridge(args: Record<string, unknown>) {
    const action = this.parseStringArg(args, 'action', true) ?? 'guide';

    if (action === 'check_env') {
      return this.checkExternalCommand('frida', ['--version'], 'frida');
    }

    if (action === 'generate_script') {
      const target = this.parseStringArg(args, 'target') ?? '<process_name>';
      const hookType = this.parseStringArg(args, 'hookType') ?? 'intercept';
      const functionName = this.parseStringArg(args, 'functionName') ?? '<target_function>';
      const script = this.generateFridaTemplate(hookType, functionName);

      return this.toTextResponse({
        success: true,
        target,
        hookType,
        functionName,
        script,
        usage: `frida -p <PID> -l script.js  // or: frida -n "${target}" -l script.js`,
        tip: 'Save the script to a .js file, then use the frida CLI to inject it.',
      });
    }

    // action === 'guide'
    return this.toTextResponse({
      success: true,
      guide: {
        what: 'Frida is a dynamic instrumentation toolkit for native apps (Android, iOS, Windows, macOS, Linux).',
        install: [
          'pip install frida-tools',
          'npm install frida  // optional Node.js bindings',
        ],
        workflow: [
          '1. Use process_find / process_find_chromium to locate the target process',
          '2. Use frida_bridge(action="generate_script") to generate a hook template',
          '3. Save the script and run: frida -p <PID> -l script.js',
          '4. Use page_evaluate or console_execute to interact with the hooked process',
          '5. Combine with network_enable + network_get_requests for full-chain analysis',
        ],
        links: [
          'https://frida.re/docs/home/',
          'https://frida.re/docs/javascript-api/',
        ],
        integration: 'Frida hooks can call back to this MCP via fetch("http://localhost:<port>/...") for real-time data exchange.',
      },
    });
  }

  async handleJadxBridge(args: Record<string, unknown>) {
    const action = this.parseStringArg(args, 'action', true) ?? 'guide';

    if (action === 'check_env') {
      return this.checkExternalCommand('jadx', ['--version'], 'jadx');
    }

    if (action === 'decompile') {
      const inputPath = this.parseStringArg(args, 'inputPath', true);
      if (!inputPath) {
        throw new Error('inputPath is required for decompile action');
      }

      const absoluteInput = resolve(inputPath);
      const outputDirArg = this.parseStringArg(args, 'outputDir');
      const extraArgs = Array.isArray(args.extraArgs)
        ? (args.extraArgs as string[]).filter((a) => typeof a === 'string')
        : [];

      const outputIdentity = basename(absoluteInput, extname(absoluteInput));
      const outputDirectory = await this.resolveOutputDirectory(
        'jadx-decompile',
        outputIdentity,
        outputDirArg
      );

      const jadxArgs = [
        '-d', outputDirectory.absolutePath,
        ...extraArgs,
        absoluteInput,
      ];

      try {
        const result = await this.runner.run({
          tool: 'platform.jadx',
          args: jadxArgs,
          timeoutMs: 300_000,
        });

        return this.toTextResponse({
          success: result.ok,
          outputDir: outputDirectory.displayPath,
          exitCode: result.exitCode,
          stdout: result.stdout.slice(0, 2000),
          stderr: result.stderr.slice(0, 2000),
          truncated: result.truncated,
          durationMs: result.durationMs,
        });
      } catch (error) {
        return this.toErrorResponse('jadx_bridge', error, {
          hint: 'Ensure jadx is installed: https://github.com/skylot/jadx/releases',
        });
      }
    }

    // action === 'guide'
    return this.toTextResponse({
      success: true,
      guide: {
        what: 'Jadx is a DEX to Java decompiler. Supports APK, DEX, AAR, AAB, and ZIP files.',
        install: [
          'Download from: https://github.com/skylot/jadx/releases',
          'Ensure jadx is in PATH (or provide full path)',
          'Requires Java 11+ runtime',
        ],
        workflow: [
          '1. Use jadx_bridge(action="check_env") to verify jadx installation',
          '2. Use jadx_bridge(action="decompile", inputPath="app.apk") to decompile',
          '3. Use search_in_scripts / collect_code to analyze the decompiled Java source',
          '4. Combine with crypto_extract_standalone for sign/encrypt function extraction',
        ],
        commonArgs: [
          '--deobf            // Enable deobfuscation',
          '--show-bad-code    // Show decompiled code even if errors occur',
          '--no-res           // Skip resource decoding (faster)',
          '--threads-count 4  // Parallel decompilation',
        ],
        links: [
          'https://github.com/skylot/jadx',
          'https://github.com/skylot/jadx/wiki/jadx-CLI-options',
        ],
      },
    });
  }

  private async checkExternalCommand(
    command: string,
    versionArgs: string[],
    label: string
  ) {
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execFileAsync = promisify(execFile);

      const { stdout, stderr } = await execFileAsync(command, versionArgs, {
        timeout: 10_000,
      });
      const version = (stdout || stderr).trim().split('\n')[0] ?? '';

      return this.toTextResponse({
        success: true,
        tool: label,
        available: true,
        version,
      });
    } catch (error) {
      return this.toTextResponse({
        success: true,
        tool: label,
        available: false,
        reason: error instanceof Error ? error.message : String(error),
        installHint: label === 'frida'
          ? 'pip install frida-tools'
          : 'https://github.com/skylot/jadx/releases',
      });
    }
  }

  private generateFridaTemplate(hookType: string, functionName: string): string {
    const templates: Record<string, string> = {
      intercept: [
        `// Frida Interceptor template for: ${functionName}`,
        `Interceptor.attach(Module.getExportByName(null, '${functionName}'), {`,
        `  onEnter(args) {`,
        `    console.log('[+] ${functionName} called');`,
        `    console.log('    arg0:', args[0]);`,
        `    console.log('    arg1:', args[1]);`,
        `  },`,
        `  onLeave(retval) {`,
        `    console.log('[+] ${functionName} returned:', retval);`,
        `  }`,
        `});`,
      ].join('\n'),

      replace: [
        `// Frida Replace template for: ${functionName}`,
        `Interceptor.replace(Module.getExportByName(null, '${functionName}'),`,
        `  new NativeCallback(function() {`,
        `    console.log('[+] ${functionName} replaced');`,
        `    // Add custom logic here`,
        `    return 0;`,
        `  }, 'int', [])`,
        `);`,
      ].join('\n'),

      stalker: [
        `// Frida Stalker template for tracing: ${functionName}`,
        `const targetAddr = Module.getExportByName(null, '${functionName}');`,
        `Interceptor.attach(targetAddr, {`,
        `  onEnter(args) {`,
        `    this.tid = Process.getCurrentThreadId();`,
        `    Stalker.follow(this.tid, {`,
        `      events: { call: true, ret: false, exec: false },`,
        `      onCallSummary(summary) {`,
        `        for (const [addr, count] of Object.entries(summary)) {`,
        `          const sym = DebugSymbol.fromAddress(ptr(addr));`,
        `          if (sym.name) console.log(\`  \${sym.name}: \${count}x\`);`,
        `        }`,
        `      }`,
        `    });`,
        `  },`,
        `  onLeave() {`,
        `    Stalker.unfollow(this.tid);`,
        `  }`,
        `});`,
      ].join('\n'),

      module_export: [
        `// Frida Module Export enumeration`,
        `const exports = Module.enumerateExports('${functionName}');`,
        `console.log(\`[+] Found \${exports.length} exports in ${functionName}\`);`,
        `exports.forEach((exp, i) => {`,
        `  console.log(\`  [\${i}] \${exp.type} \${exp.name} @ \${exp.address}\`);`,
        `});`,
      ].join('\n'),
    };

    return templates[hookType] ?? templates.intercept!;
  }
}
