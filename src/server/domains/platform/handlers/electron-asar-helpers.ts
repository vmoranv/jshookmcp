import { basename, extname } from 'node:path';
import {
  isRecord,
  sanitizeArchiveRelativePath,
  toDisplayPath,
  walkDirectory,
  type AsarFileEntry,
  type ParsedAsar,
} from '@server/domains/platform/handlers/platform-utils';

function trimTrailingNulls(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

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
        typeof sizeRaw === 'number' && Number.isFinite(sizeRaw) && sizeRaw >= 0 ? sizeRaw : 0;

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
  totalSize: number,
  asarBuffer?: Buffer,
): boolean {
  const samples = files.filter((entry) => !entry.unpacked && entry.size > 0).slice(0, 64);

  for (const file of samples) {
    const start = dataOffset + file.offset;
    const end = start + file.size;
    if (start < 0 || end < start || end > totalSize) {
      return false;
    }
  }

  // Content validation: check that the first file starts with plausible data
  if (asarBuffer && samples.length > 0) {
    const first = samples[0]!;
    const start = dataOffset + first.offset;
    if (start >= 0 && start < asarBuffer.length) {
      const firstByte = asarBuffer[start];
      // Valid file data should not start with JSON structural characters or null
      // (which would indicate we're reading header content, not file data)
      if (firstByte === 0x7b || firstByte === 0x7d || firstByte === 0x22 || firstByte === 0x5b) {
        // Could be a JSON file starting with { } " [ — check if it's inside the header region
        // by verifying the first file's offset + size doesn't overlap with the header
        // Heuristic: if all 3 sample files start with JSON characters, likely in header
        let jsonStartCount = 0;
        for (const file of samples.slice(0, 4)) {
          const s = dataOffset + file.offset;
          if (s < asarBuffer.length) {
            const b = asarBuffer[s];
            if (b === 0x7b || b === 0x7d || b === 0x22 || b === 0x5b || b === 0x3a) {
              jsonStartCount++;
            }
          }
        }
        // If multiple files start with JSON chars at this offset, we're probably in the header
        if (jsonStartCount >= 3) return false;
      }
      // Definitely in header if first byte is null or a structural JSON char that can't start a file
      if (firstByte === 0x00) return false;
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
    new Set([headerContentSize, headerStringSize, headerSize - 8, headerSize]),
  ).filter((value) => value > 0 && headerStart + value <= asarBuffer.length);

  let headerObject: Record<string, unknown> | null = null;
  let headerLength = 0;

  for (const candidateLength of lengthCandidates) {
    const headerText = asarBuffer
      .subarray(headerStart, headerStart + candidateLength)
      .toString('utf-8');
    const normalizedHeaderText = trimTrailingNulls(headerText).trim();

    if (normalizedHeaderText.length === 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(normalizedHeaderText) as unknown;
      if (isRecord(parsed)) {
        headerObject = parsed;
        headerLength = candidateLength;
        break;
      }
    } catch {
      // Some ASAR files have non-null trailing padding after JSON.
      // Fall back to truncating at the last closing brace.
      const lastBrace = normalizedHeaderText.lastIndexOf('}');
      if (lastBrace > 0) {
        try {
          const trimmed = normalizedHeaderText.substring(0, lastBrace + 1);
          const parsed = JSON.parse(trimmed) as unknown;
          if (isRecord(parsed)) {
            headerObject = parsed;
            headerLength = candidateLength;
            break;
          }
        } catch {
          // try next candidate
        }
      }
    }
  }

  if (!headerObject) {
    throw new Error('Invalid ASAR: cannot parse header JSON');
  }

  const rootNode = isRecord(headerObject.files) ? headerObject : { files: headerObject };

  const files = flattenAsarEntries(rootNode);

  const offsetCandidates = Array.from(
    new Set([
      headerStart + headerLength,
      headerStart + headerLength + padding,
      8 + headerSize,
      8 + headerStringSize,
      headerStart + headerContentSize,
      headerStart + headerContentSize + padding,
      headerStart + headerStringSize,
      headerStart + headerStringSize + padding,
    ]),
  ).filter((value) => value >= headerStart && value <= asarBuffer.length);

  let dataOffset = offsetCandidates[0] ?? headerStart + headerLength;
  // Try candidates in order; prefer smaller offsets (data follows header closely)
  const sortedCandidates = offsetCandidates.toSorted((a, b) => a - b);
  for (const candidate of sortedCandidates) {
    if (isAsarDataOffsetValid(files, candidate, asarBuffer.length, asarBuffer)) {
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
  entryPath: string,
): Buffer | undefined {
  const normalizedEntryPath = sanitizeArchiveRelativePath(entryPath);
  if (normalizedEntryPath.length === 0) {
    return undefined;
  }

  const matchedEntry =
    parsedAsar.files.find((entry) => entry.path === normalizedEntryPath) ??
    parsedAsar.files.find((entry) => entry.path.endsWith(`/${normalizedEntryPath}`));

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
  entryPath: string,
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

  return Array.from(matches).toSorted().slice(0, 100);
}
