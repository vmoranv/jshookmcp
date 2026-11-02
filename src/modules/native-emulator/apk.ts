/**
 * apk — extract loadable native libraries from a Flutter/Android APK.
 *
 * An APK is a zip; its CPU code lives under lib/<abi>/. The emulator's CPU is
 * AArch64, so only `lib/arm64-v8a/*.so` is loadable. This reads those entries'
 * bytes out of the archive (PackerDetector, by contrast, only inspects entry
 * *names* for hardening fingerprints — it never opens the streams).
 *
 * Uses yauzl in lazy-entry mode, matching the existing apk-packer reader, and
 * caps total extracted bytes so a malicious zip can't exhaust memory.
 */
import {
  open as openZipArchive,
  type Entry as ZipEntry,
  type ZipFile as YauzlZipFile,
} from 'yauzl';
import { Readable } from 'node:stream';

import { ToolError } from '@errors/ToolError';
import { logger } from '@utils/logger';
import { NEMU_APK_MAX_TOTAL_SO_BYTES } from '@src/constants';

const ARM64_SO_RE = /^lib\/arm64-v8a\/(lib[^/]+\.so)$/i;
/** Guard against a zip bomb: refuse to buffer more than this per extracted lib. */
const MAX_SO_BYTES = 256 * 1024 * 1024;
/** One extracted native library: its basename and raw bytes. */
export interface ExtractedLib {
  /** Basename, e.g. "libapp.so" or "libnative-lib.so". */
  name: string;
  bytes: Uint8Array;
}

/**
 * Result of an APK lib extraction, including whether it stopped early.
 */
export interface ExtractArm64LibsResult {
  /** Extracted libraries in archive order (partial when `truncated`). */
  libs: ExtractedLib[];
  /** True when extraction stopped early because the aggregate byte cap was reached. */
  truncated: boolean;
  /** Total bytes buffered across all returned libs. */
  totalBytes: number;
}

/** Options for {@link extractArm64LibsDetailed}. */
export interface ExtractArm64LibsOptions {
  /**
   * Override the aggregate byte cap. Defaults to the runtime-tunable
   * `NEMU_APK_MAX_TOTAL_SO_BYTES` (512 MB).
   */
  maxTotalBytes?: number;
}

/**
 * Extract every `lib/arm64-v8a/*.so` from an APK as raw bytes. Returns them in
 * archive order; callers pick the target (e.g. skip libflutter.so, route
 * libapp.so to the Dart layer, load a third-party/hardening lib here).
 *
 * Kept array-returning for existing callers (nemu_extract_apk_libs /
 * nemu_load_apk_library / DartAotLoader). Use {@link extractArm64LibsDetailed}
 * when you need the `truncated` flag.
 */
export async function extractArm64Libs(apkPath: string): Promise<ExtractedLib[]> {
  const { libs, truncated, totalBytes } = await extractArm64LibsDetailed(apkPath);
  if (truncated) {
    logger.warn(
      `[apk] extractArm64Libs truncated at ${totalBytes} bytes (${libs.length} lib(s) returned before the aggregate cap)`,
    );
  }
  return libs;
}

/**
 * Extract `lib/arm64-v8a/*.so` with an aggregate byte cap so a zip bomb can't
 * exhaust memory: once the running total would exceed `maxTotalBytes`,
 * extraction stops and the already-collected libs are returned with
 * `truncated: true`.
 */
export async function extractArm64LibsDetailed(
  apkPath: string,
  options: ExtractArm64LibsOptions = {},
): Promise<ExtractArm64LibsResult> {
  if (!apkPath || apkPath.length === 0) {
    throw new ToolError('VALIDATION', 'apkPath must be a non-empty string');
  }
  const maxTotalBytes = options.maxTotalBytes ?? NEMU_APK_MAX_TOTAL_SO_BYTES;
  return new Promise<ExtractArm64LibsResult>((resolve, reject) => {
    openZipArchive(apkPath, { lazyEntries: true, autoClose: true }, (err, zipFile) => {
      if (err || !zipFile) {
        reject(
          new ToolError('VALIDATION', `Failed to open APK as ZIP: ${err?.message ?? 'unknown'}`, {
            details: { apkPath },
            cause: err ?? undefined,
          }),
        );
        return;
      }
      const zip = zipFile as YauzlZipFile;
      const collected: ExtractedLib[] = [];
      let totalBytes = 0;
      let truncated = false;

      const onEntry = (entry: ZipEntry): void => {
        const match = ARM64_SO_RE.exec(entry.fileName);
        if (!match) {
          zip.readEntry();
          return;
        }
        const name = match[1] as string;
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            cleanup();
            zip.close();
            reject(
              new ToolError(
                'RUNTIME',
                `Failed to read ${name}: ${streamErr?.message ?? 'unknown'}`,
                {
                  details: { apkPath, name },
                  cause: streamErr ?? undefined,
                },
              ),
            );
            return;
          }
          readStreamCapped(stream, MAX_SO_BYTES).then(
            (bytes) => {
              // Aggregate cap: stop before buffering a lib that would push the
              // running total over the limit (zip-bomb guard).
              if (totalBytes + bytes.length > maxTotalBytes) {
                truncated = true;
                cleanup();
                zip.close();
                resolve({ libs: collected, truncated, totalBytes });
                return;
              }
              totalBytes += bytes.length;
              collected.push({ name, bytes });
              zip.readEntry();
            },
            (readErr: Error) => {
              cleanup();
              zip.close();
              reject(
                new ToolError('RUNTIME', `Reading ${name} failed: ${readErr.message}`, {
                  details: { apkPath, name },
                  cause: readErr,
                }),
              );
            },
          );
        });
      };
      const onEnd = (): void => {
        cleanup();
        resolve({ libs: collected, truncated, totalBytes });
      };
      const onError = (e: Error): void => {
        cleanup();
        zip.close();
        reject(
          new ToolError('RUNTIME', `ZIP read failed: ${e.message}`, {
            details: { apkPath },
            cause: e,
          }),
        );
      };
      function cleanup(): void {
        zip.removeListener('entry', onEntry);
        zip.removeListener('end', onEnd);
        zip.removeListener('error', onError);
      }
      zip.on('entry', onEntry);
      zip.on('end', onEnd);
      zip.on('error', onError);
      zip.readEntry();
    });
  });
}

/** Buffer a readable stream into a Uint8Array, rejecting once it exceeds `cap`. */
function readStreamCapped(stream: Readable, cap: number): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) {
        stream.destroy();
        reject(new Error(`extracted .so exceeds ${cap} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Uint8Array.from(Buffer.concat(chunks))));
    stream.on('error', reject);
  });
}
