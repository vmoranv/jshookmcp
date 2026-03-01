import { basename, extname } from 'node:path';
import {
  isRecord,
  sanitizeArchiveRelativePath,
  toDisplayPath,
  walkDirectory,
  type AsarFileEntry,
  type ParsedAsar,
} from './platform-utils.js';
export function flattenAsarEntries(headerNode: Record<string, unknown>): AsarFileEntry[] {
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

export function isAsarDataOffsetValid(
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

export function parseAsarBuffer(asarBuffer: Buffer): ParsedAsar {
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

export function readAsarEntryBuffer(
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

export function readAsarEntryText(
  asarBuffer: Buffer,
  parsedAsar: ParsedAsar,
  entryPath: string
): string | undefined {
  const data = readAsarEntryBuffer(asarBuffer, parsedAsar, entryPath);
  return data ? data.toString('utf-8') : undefined;
}

export function parseBrowserWindowHints(sourceText: string): {
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

export async function findFilesystemPreloadScripts(rootDir: string): Promise<string[]> {
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

