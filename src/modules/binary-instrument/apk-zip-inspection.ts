import {
  open as openZipArchive,
  type Entry as ZipEntry,
  type ZipFile as YauzlZipFile,
} from 'yauzl';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import { parseAxml } from '@modules/axml-parser';

export type ApkManifestDecodeResult =
  | { success: true; format: 'xml'; decodedBy: string; manifest: string }
  | { success: true; format: 'binary-axml'; decodedBy: 'zip-entry'; buffer: Buffer }
  | { success: false; error: string };

export interface DecodeApkManifestOptions {
  decodeBinaryManifest?: () => Promise<string | undefined>;
}

export async function listZipEntries(
  apkPath: string,
): Promise<{ success: true; entries: string[] } | { success: false; error: string }> {
  try {
    const zipFile = await openZipFile(apkPath);
    const entries = await new Promise<string[]>((resolve, reject) => {
      const names: string[] = [];
      let settled = false;

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        zipFile.removeListener('entry', onEntry);
        zipFile.removeListener('end', onEnd);
        zipFile.removeListener('error', onError);
        callback();
      };
      const onEntry = (entry: ZipEntry) => {
        names.push(entry.fileName);
        zipFile.readEntry();
      };
      const onEnd = () => finish(() => resolve(names));
      const onError = (error: Error) => finish(() => reject(error));

      zipFile.on('entry', onEntry);
      zipFile.on('end', onEnd);
      zipFile.on('error', onError);
      zipFile.readEntry();
    });

    return { success: true, entries };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readZipEntryBuffer(
  apkPath: string,
  entryName: string,
): Promise<{ success: true; buffer: Buffer } | { success: false; error: string }> {
  try {
    const zipFile = await openZipFile(apkPath);
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      let settled = false;

      const closeZip = () => {
        try {
          zipFile.close();
        } catch {
          // ignore close errors after early return
        }
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        zipFile.removeListener('entry', onEntry);
        zipFile.removeListener('end', onEnd);
        zipFile.removeListener('error', onError);
        callback();
      };
      const onEntry = (entry: ZipEntry) => {
        if (entry.fileName !== entryName) {
          zipFile.readEntry();
          return;
        }

        zipFile.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            finish(() => reject(error ?? new Error(`Unable to read ZIP entry: ${entryName}`)));
            closeZip();
            return;
          }

          readStreamToBuffer(stream)
            .then((content) => {
              finish(() => resolve(content));
              closeZip();
            })
            .catch((streamError) => {
              finish(() => reject(streamError));
              closeZip();
            });
        });
      };
      const onEnd = () => finish(() => reject(new Error(`ZIP entry not found: ${entryName}`)));
      const onError = (error: Error) => finish(() => reject(error));

      zipFile.on('entry', onEntry);
      zipFile.on('end', onEnd);
      zipFile.on('error', onError);
      zipFile.readEntry();
    });

    return { success: true, buffer };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function decodeApkManifest(
  apkPath: string,
  options: DecodeApkManifestOptions = {},
): Promise<ApkManifestDecodeResult> {
  const manifestResult = await readZipEntryBuffer(apkPath, 'AndroidManifest.xml');
  if (!manifestResult.success) {
    return { success: false, error: manifestResult.error };
  }

  const manifestText = decodeTextEntry(manifestResult.buffer);
  if (manifestText !== null) {
    return {
      success: true,
      format: 'xml',
      decodedBy: 'zip-entry',
      manifest: manifestText,
    };
  }

  // Try JADX CLI if available
  const decodedManifest = await options.decodeBinaryManifest?.();
  if (decodedManifest?.trimStart().startsWith('<')) {
    return {
      success: true,
      format: 'xml',
      decodedBy: 'jadx_cli',
      manifest: decodedManifest,
    };
  }

  // Fallback to built-in AXML parser
  const axmlParsed = parseAxml(manifestResult.buffer);
  if (axmlParsed?.trimStart().startsWith('<')) {
    return {
      success: true,
      format: 'xml',
      decodedBy: 'axml_parser',
      manifest: axmlParsed,
    };
  }

  return {
    success: true,
    format: 'binary-axml',
    decodedBy: 'zip-entry',
    buffer: manifestResult.buffer,
  };
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

function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: string | Buffer) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function decodeTextEntry(buffer: Buffer): string | null {
  if (buffer.length === 0) return '';

  const config = getReverseEngineeringConfig().apk;
  const sample = buffer.subarray(
    0,
    Math.min(buffer.length, config.dexIntakeManifestTextSampleBytes),
  );
  let controlByteCount = 0;
  for (const byte of sample) {
    if (byte === 0) return null;
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) {
      controlByteCount += 1;
    }
  }

  if (controlByteCount > sample.length * config.dexIntakeManifestControlByteRatio) {
    return null;
  }

  const text = buffer.toString('utf8');
  return text.trimStart().startsWith('<') ? text : null;
}
