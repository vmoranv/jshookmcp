import { stat } from 'node:fs/promises';
import {
  open as openZipArchive,
  type Entry as ZipEntry,
  type ZipFile as YauzlZipFile,
} from 'yauzl';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import {
  matchApkSurfaceHints,
  type ApkSurfaceHint,
  type ApkSurfaceHintRule,
} from './apk-surface-hints';
import { isDexArtifactPath, summarizeDexBuffer, type DexFileArtifact } from './dex-artifacts';
import { summarizeManifestXml, type ManifestSummary } from './apk-manifest';

export interface ApkDexIntakeOptions {
  apkPath: string;
  maxEntries?: number;
  includeRawManifest?: boolean;
  maxDexFiles?: number;
  maxDexBytes?: number;
  maxTotalDexBytes?: number;
  customSurfaceHints?: ApkSurfaceHintRule[];
}

interface ZipEntrySnapshot {
  name: string;
  buffer?: Buffer;
  sourceSize?: number;
  truncated?: boolean;
}

export interface ApkDexIntakeResult {
  success: true;
  apkPath: string;
  artifact: {
    kind: 'apk-dex-intake';
    file: {
      size?: number;
      readable: boolean;
    };
    zip: {
      entryCount: number;
      entries: string[];
      truncated: boolean;
    };
    manifest:
      | {
          format: 'xml';
          decodedBy: 'zip-entry';
          summary: ManifestSummary;
          rawManifest?: string;
        }
      | {
          format: 'binary-axml' | 'missing';
          decodedBy?: 'zip-entry';
          size?: number;
          error?: string;
        };
    dex: {
      count: number;
      files: DexFileArtifact[];
    };
    nativeLibs: {
      count: number;
      abis: string[];
      libraries: Array<{ path: string; abi: string; name: string }>;
    };
    assetHints: string[];
    protectorHints: ApkSurfaceHint[];
    sdkHints: ApkSurfaceHint[];
    recommendedNextSteps: string[];
  };
}

export async function analyzeApkDexIntake(
  options: ApkDexIntakeOptions,
): Promise<ApkDexIntakeResult> {
  const config = getReverseEngineeringConfig();
  const apkConfig = config.apk;
  const dexConfig = config.dex;
  const maxEntries = clampInt(
    options.maxEntries ?? apkConfig.staticTriageDefaultEntries,
    apkConfig.staticTriageMinEntries,
    apkConfig.staticTriageMaxEntries,
  );
  const maxDexFiles = clampInt(
    options.maxDexFiles ?? apkConfig.dexIntakeDefaultDexFiles,
    1,
    apkConfig.dexIntakeMaxDexFiles,
  );
  const maxDexBytes = clampInt(
    options.maxDexBytes ?? dexConfig.artifactDefaultMaxFileBytes,
    dexConfig.artifactMinReadBytes,
    dexConfig.artifactMaxReadBytes,
  );
  const maxTotalDexBytes = clampInt(
    options.maxTotalDexBytes ?? dexConfig.artifactDefaultMaxTotalBytes,
    dexConfig.artifactMinReadBytes,
    dexConfig.artifactMaxReadBytes,
  );
  const fileStat = await stat(options.apkPath).catch(() => undefined);
  const entries = await readApkEntries(options.apkPath, {
    maxDexFiles,
    maxDexBytes,
    maxTotalDexBytes,
  });
  const entryNames = entries.map((entry) => entry.name);
  const manifestEntry = entries.find((entry) => entry.name === 'AndroidManifest.xml');
  const manifestText = manifestEntry?.buffer ? decodeTextEntry(manifestEntry.buffer) : null;
  const manifest = buildManifestArtifact(
    manifestEntry,
    manifestText,
    options.includeRawManifest ?? false,
  );
  const manifestXml = manifestText ?? '';
  const dexFiles = entries
    .filter((entry) => isDexEntry(entry.name) && entry.buffer)
    .map((entry) => summarizeDexEntry(entry));
  const nativeLibs = entryNames
    .filter((entry) => /^lib\/.+\/[^/]+\.so$/i.test(entry))
    .map((entry) => {
      const parts = entry.split('/');
      return { path: entry, abi: parts[1] ?? '', name: parts[parts.length - 1] ?? '' };
    });
  const assetHints = entryNames
    .filter(
      (entry) =>
        /(^|\/)(assets|unknown)\//i.test(entry) &&
        /\.(jar|dex|dat|bin|json|txt|dve|y)$/i.test(entry),
    )
    .slice(0, apkConfig.staticTriageAssetHintLimit);
  const hintOptions = options.customSurfaceHints
    ? { customSurfaceHints: options.customSurfaceHints }
    : {};
  const surfaceHints = matchApkSurfaceHints(entryNames, manifestXml, hintOptions);

  return {
    success: true,
    apkPath: options.apkPath,
    artifact: {
      kind: 'apk-dex-intake',
      file: {
        size: fileStat?.isFile() ? fileStat.size : undefined,
        readable: fileStat?.isFile() ?? false,
      },
      zip: {
        entryCount: entryNames.length,
        entries: entryNames.slice(0, maxEntries),
        truncated: entryNames.length > maxEntries,
      },
      manifest,
      dex: {
        count: dexFiles.length,
        files: dexFiles,
      },
      nativeLibs: {
        count: nativeLibs.length,
        abis: uniqueStrings(nativeLibs.map((lib) => lib.abi)),
        libraries: nativeLibs.slice(0, apkConfig.staticTriageNativeLibLimit),
      },
      assetHints,
      protectorHints: surfaceHints.protectorHints,
      sdkHints: surfaceHints.sdkHints,
      recommendedNextSteps: recommendedNextSteps(
        surfaceHints.protectorHints.length,
        nativeLibs.length,
      ),
    },
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(Math.floor(value), max));
}

function uniqueStrings(
  values: string[],
  limit = getReverseEngineeringConfig().apk.dexIntakeUniqueLimitDefault,
): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function isDexEntry(entryName: string): boolean {
  return /(^|\/)classes/i.test(entryName) && isDexArtifactPath(entryName);
}

function buildManifestArtifact(
  manifestEntry: ZipEntrySnapshot | undefined,
  manifestText: string | null,
  includeRawManifest: boolean,
): ApkDexIntakeResult['artifact']['manifest'] {
  if (!manifestEntry?.buffer) {
    return { format: 'missing', error: 'AndroidManifest.xml not found' };
  }
  if (manifestText === null) {
    return {
      format: 'binary-axml',
      decodedBy: 'zip-entry',
      size: manifestEntry.buffer.length,
      error: 'Manifest is binary AXML; run apk_manifest_dump for base64 or JADX XML decode.',
    };
  }
  const apkConfig = getReverseEngineeringConfig().apk;
  return {
    format: 'xml',
    decodedBy: 'zip-entry',
    summary: summarizeManifestXml(manifestText, {
      componentLimit: apkConfig.dexIntakeComponentLimit,
      featureLimit: apkConfig.dexIntakeFeatureLimit,
    }),
    ...(includeRawManifest ? { rawManifest: manifestText } : {}),
  };
}

function decodeTextEntry(buffer: Buffer): string | null {
  if (buffer.length === 0) return '';
  const sample = buffer.subarray(
    0,
    Math.min(buffer.length, getReverseEngineeringConfig().apk.dexIntakeManifestTextSampleBytes),
  );
  let controlByteCount = 0;
  for (const byte of sample) {
    if (byte === 0) return null;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) controlByteCount += 1;
  }
  if (
    controlByteCount >
    sample.length * getReverseEngineeringConfig().apk.dexIntakeManifestControlByteRatio
  ) {
    return null;
  }
  const text = buffer.toString('utf8');
  return text.trimStart().startsWith('<') ? text : null;
}

function recommendedNextSteps(protectorCount: number, nativeLibCount: number): string[] {
  return [
    protectorCount > 0
      ? 'Packed/protected APK detected: preserve this intake artifact, then start runtime dumping with adb/frida before static decompilation assumptions.'
      : 'No strong protector hint found: run jadx_decompile_apk then jadx_search_code for startup and crypto paths.',
    nativeLibCount > 0
      ? 'Native libraries present: inspect relevant .so files with apk_native_libs_list, ghidra/unidbg, and native-emulator import diagnostics.'
      : 'Native library surface appears small or absent.',
  ];
}

function summarizeDexEntry(entry: ZipEntrySnapshot): DexFileArtifact {
  const summary = summarizeDexBuffer(entry.name, entry.buffer!);
  return {
    ...summary,
    ...(entry.sourceSize !== undefined && entry.sourceSize !== summary.size
      ? { sourceSize: entry.sourceSize }
      : {}),
    ...(entry.truncated ? { truncated: true } : {}),
  };
}

interface ReadApkEntriesOptions {
  maxDexFiles: number;
  maxDexBytes: number;
  maxTotalDexBytes: number;
}

async function readApkEntries(
  apkPath: string,
  options: ReadApkEntriesOptions,
): Promise<ZipEntrySnapshot[]> {
  const zipFile = await openZipFile(apkPath);
  return new Promise<ZipEntrySnapshot[]>((resolve, reject) => {
    const entries: ZipEntrySnapshot[] = [];
    let dexBuffersRead = 0;
    let totalDexBytesRead = 0;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      zipFile.removeListener('entry', onEntry);
      zipFile.removeListener('end', onEnd);
      zipFile.removeListener('error', onError);
      callback();
    };
    const closeZip = () => {
      try {
        zipFile.close();
      } catch {
        // ignore close errors after early finish
      }
    };
    const onEnd = () => {
      finish(() => {
        closeZip();
        resolve(entries);
      });
    };
    const onError = (error: Error) => {
      finish(() => {
        closeZip();
        reject(error);
      });
    };
    const onEntry = (entry: ZipEntry) => {
      const name = entry.fileName;
      const isDex = isDexEntry(name);
      const rawSourceSize = entry.uncompressedSize;
      const sourceSize =
        typeof rawSourceSize === 'number' && Number.isFinite(rawSourceSize)
          ? Math.max(0, Math.floor(rawSourceSize))
          : undefined;
      const remainingDexBytes = Math.max(0, options.maxTotalDexBytes - totalDexBytesRead);
      const shouldRead =
        name === 'AndroidManifest.xml' ||
        (isDex && dexBuffersRead < options.maxDexFiles && remainingDexBytes > 0);
      if (!shouldRead) {
        entries.push({
          name,
          ...(sourceSize !== undefined ? { sourceSize } : {}),
          ...(isDex && remainingDexBytes <= 0 ? { truncated: true } : {}),
        });
        zipFile.readEntry();
        return;
      }
      if (isDex) dexBuffersRead += 1;
      zipFile.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          finish(() => {
            closeZip();
            reject(error ?? new Error(`Unable to read ZIP entry: ${name}`));
          });
          return;
        }
        const maxBytes = isDex ? Math.min(options.maxDexBytes, remainingDexBytes) : undefined;
        readStreamToBuffer(stream, maxBytes)
          .then((readResult) => {
            if (isDex) totalDexBytesRead += readResult.buffer.length;
            const truncated =
              readResult.truncated ||
              (sourceSize !== undefined && readResult.buffer.length < sourceSize);
            entries.push({
              name,
              buffer: readResult.buffer,
              ...(sourceSize !== undefined ? { sourceSize } : {}),
              ...(truncated ? { truncated: true } : {}),
            });
            zipFile.readEntry();
          })
          .catch((streamError) => {
            finish(() => {
              closeZip();
              reject(streamError);
            });
          });
      });
    };

    zipFile.on('entry', onEntry);
    zipFile.on('end', onEnd);
    zipFile.on('error', onError);
    zipFile.readEntry();
  });
}

function openZipFile(apkPath: string): Promise<YauzlZipFile> {
  return new Promise((resolve, reject) => {
    openZipArchive(
      apkPath,
      {
        autoClose: true,
        lazyEntries: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: false,
      },
      (error, zipFile) => {
        if (error || !zipFile) {
          reject(error ?? new Error(`Unable to open ZIP archive: ${apkPath}`));
          return;
        }
        resolve(zipFile);
      },
    );
  });
}

function readStreamToBuffer(
  stream: NodeJS.ReadableStream,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<{ buffer: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const settle = (result: { buffer: Buffer; truncated: boolean }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    stream.on('data', (chunk: string | Buffer) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (total + buffer.length > maxBytes) {
        const remaining = Math.max(0, maxBytes - total);
        if (remaining > 0) {
          chunks.push(buffer.subarray(0, remaining));
          total += remaining;
        }
        settle({ buffer: Buffer.concat(chunks, total), truncated: true });
        const destroyable = stream as NodeJS.ReadableStream & { destroy?: () => void };
        if (typeof destroyable.destroy === 'function') destroyable.destroy();
        return;
      }
      chunks.push(buffer);
      total += buffer.length;
    });
    stream.on('end', () => settle({ buffer: Buffer.concat(chunks, total), truncated: false }));
    stream.on('error', (error) => {
      if (!settled) reject(error);
    });
  });
}
