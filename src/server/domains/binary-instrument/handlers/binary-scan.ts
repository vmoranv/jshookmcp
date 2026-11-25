/**
 * Binary scan handlers: string extraction, DEX magic scanning.
 */

import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BINARY_STRINGS_MAX_RESULTS_DEFAULT,
  BINARY_STRINGS_MAX_RESULTS_LIMIT,
  BINARY_STRINGS_MIN_LENGTH_CEILING,
  BINARY_STRINGS_MIN_LENGTH_DEFAULT,
  BINARY_STRINGS_MIN_LENGTH_FLOOR,
  BINARY_STRINGS_PRINTABLE_ASCII_MAX,
  BINARY_STRINGS_PRINTABLE_ASCII_MIN,
} from '@src/constants';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import { findArm64Xrefs } from '@modules/binary-instrument/arm64-xrefs';
import { getSafeOutputRoots } from '@utils/outputPaths';
import { resolveSafeOutputPath, writeOutputFile } from '@utils/safeOutput';
import {
  readRequiredString,
  readOptionalString,
  readOptionalNumber,
  readOptionalBoolean,
  jsonResponse,
} from './shared';

export class BinaryScanHandlers {
  async handleBinaryStringsExtract(args: Record<string, unknown>): Promise<unknown> {
    const filePath = readRequiredString(args, 'filePath');
    const minLength = Math.max(
      BINARY_STRINGS_MIN_LENGTH_FLOOR,
      Math.min(
        readOptionalNumber(args, 'minLength') ?? BINARY_STRINGS_MIN_LENGTH_DEFAULT,
        BINARY_STRINGS_MIN_LENGTH_CEILING,
      ),
    );
    const maxResults = Math.max(
      1,
      Math.min(
        readOptionalNumber(args, 'maxResults') ?? BINARY_STRINGS_MAX_RESULTS_DEFAULT,
        BINARY_STRINGS_MAX_RESULTS_LIMIT,
      ),
    );
    const pattern = readOptionalString(args, 'pattern');
    const regex = pattern ? new RegExp(pattern, 'i') : undefined;
    const data = await readFile(filePath);
    const strings: Array<{ offset: number; encoding: 'ascii' | 'utf16le'; value: string }> = [];
    const addString = (offset: number, encoding: 'ascii' | 'utf16le', value: string) => {
      if (value.length < minLength) return;
      if (regex && !regex.test(value)) return;
      strings.push({ offset, encoding, value });
    };

    let start = -1;
    for (let i = 0; i <= data.length; i++) {
      const byte = i < data.length ? data[i]! : 0;
      const printable =
        byte >= BINARY_STRINGS_PRINTABLE_ASCII_MIN && byte <= BINARY_STRINGS_PRINTABLE_ASCII_MAX;
      if (printable && start < 0) start = i;
      if ((!printable || i === data.length) && start >= 0) {
        addString(start, 'ascii', data.subarray(start, i).toString('utf8'));
        if (strings.length >= maxResults) break;
        start = -1;
      }
    }

    // UTF-16LE runs can start at ANY byte offset, not just even ones: a preceding
    // odd-length ASCII string shifts the terminator by one byte, putting the wide
    // string on an odd phase. Scan both phases; a run is only matched at its true
    // alignment (the wrong phase fails the data[i] printable / data[i+1]===0 test),
    // so no duplicates are produced.
    for (const phase of [0, 1] as const) {
      for (let i = phase; i + minLength * 2 <= data.length && strings.length < maxResults; i += 2) {
        if (data[i + 1] !== 0) continue;
        const startOffset = i;
        let end = i;
        while (
          end + 1 < data.length &&
          data[end + 1] === 0 &&
          data[end]! >= BINARY_STRINGS_PRINTABLE_ASCII_MIN &&
          data[end]! <= BINARY_STRINGS_PRINTABLE_ASCII_MAX
        ) {
          end += 2;
        }
        if (end > startOffset) {
          addString(startOffset, 'utf16le', data.subarray(startOffset, end).toString('utf16le'));
          i = end;
        }
      }
    }

    return jsonResponse({
      success: true,
      filePath,
      size: data.length,
      minLength,
      pattern,
      count: strings.length,
      strings: strings.slice(0, maxResults),
      truncated: strings.length >= maxResults,
    });
  }

  async handleDexScanFile(args: Record<string, unknown>): Promise<unknown> {
    const filePath = readRequiredString(args, 'filePath');
    const outputDir = readOptionalString(args, 'outputDir');
    const config = getReverseEngineeringConfig();
    const dexConfig = config.dex;
    const maxHits = Math.max(
      1,
      Math.min(
        readOptionalNumber(args, 'maxHits') ?? dexConfig.scanDefaultMaxHits,
        dexConfig.scanMaxHits,
      ),
    );
    const extract = readOptionalBoolean(args, 'extract') ?? false;
    const data = await readFile(filePath);
    const allowedRoots = getSafeOutputRoots();
    const safeOutputDir =
      extract && outputDir
        ? await resolveSafeOutputPath(outputDir, {
            allowedRoots,
            allowedRootsDescription: 'project root or system temp directory',
          })
        : undefined;
    if (safeOutputDir) {
      await mkdir(safeOutputDir, { recursive: true });
    }

    const hits: Array<Record<string, unknown>> = [];
    const magics = [
      { kind: 'dex', magic: Buffer.from(config.binaryMagic.dexMagicAscii, 'ascii') },
      { kind: 'cdex', magic: Buffer.from(config.binaryMagic.compactDexMagicAscii, 'ascii') },
    ];
    for (let offset = 0; offset < data.length && hits.length < maxHits; offset++) {
      const found = magics.find(
        (entry) =>
          offset + entry.magic.length <= data.length &&
          data.subarray(offset, offset + entry.magic.length).equals(entry.magic),
      );
      if (!found) continue;
      const version = data
        .subarray(
          offset + found.magic.length,
          Math.min(offset + found.magic.length + 4, data.length),
        )
        .toString('latin1')
        .replaceAll('\u0000', '');
      const fileSize = offset + 36 <= data.length ? data.readUInt32LE(offset + 32) : undefined;
      const plausibleSize =
        fileSize !== undefined &&
        fileSize > 0x70 &&
        fileSize <= data.length - offset &&
        fileSize < dexConfig.scanMaxExtractBytes
          ? fileSize
          : undefined;
      let extractedPath: string | undefined;
      if (safeOutputDir && plausibleSize) {
        extractedPath = join(safeOutputDir, `${found.kind}_${offset.toString(16)}.${found.kind}`);
        await writeOutputFile(extractedPath, data.subarray(offset, offset + plausibleSize), {
          allowedRoots,
          allowedRootsDescription: 'project root or system temp directory',
        });
      }
      hits.push({
        kind: found.kind,
        offset,
        offsetHex: `0x${offset.toString(16)}`,
        version,
        fileSize,
        plausibleSize,
        ...(extractedPath ? { extractedPath } : {}),
      });
      offset += Math.max(0, found.magic.length - 1);
    }

    return jsonResponse({
      success: true,
      filePath,
      size: data.length,
      count: hits.length,
      hits,
      truncated: hits.length >= maxHits,
    });
  }

  /**
   * binary_entropy_profile — compute Shannon entropy across fixed-size chunks
   * of a binary to locate encrypted / packed / compressed sections. High-entropy
   * regions (>=7.0 bits/byte) are likely encrypted or compressed; low-entropy
   * regions (<4.0) are typically code or text. Pure-compute, no external tools.
   */
  async handleBinaryFindXrefs(args: Record<string, unknown>): Promise<unknown> {
    const filePath = readRequiredString(args, 'filePath');
    const rawTarget = readRequiredString(args, 'target');
    const normalized = rawTarget.trim().replace(/^0x/i, '');
    const target = Number.parseInt(normalized, 16);
    if (!Number.isInteger(target) || target < 0) {
      throw new Error('target must be a hexadecimal virtual address (e.g. 0x29e08)');
    }
    const maxResults = Math.max(1, Math.min(readOptionalNumber(args, 'maxResults') ?? 50, 500));
    const data = await readFile(filePath);
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const xrefs = findArm64Xrefs(bytes, target, maxResults);
    return jsonResponse({
      filePath,
      target: `0x${target.toString(16)}`,
      count: xrefs.length,
      xrefs: xrefs.map((x) => ({ at: `0x${x.at.toString(16)}`, kind: x.kind })),
    });
  }

  async handleBinaryEntropyProfile(args: Record<string, unknown>): Promise<unknown> {
    const filePath = readRequiredString(args, 'filePath');
    const chunkSize = Math.max(64, readOptionalNumber(args, 'chunkSize') ?? 256);
    const maxChunks = Math.max(1, readOptionalNumber(args, 'maxChunks') ?? 2000);
    const data = await readFile(filePath);

    const totalChunks = Math.ceil(data.length / chunkSize);
    const analyzeChunks = Math.min(totalChunks, maxChunks);

    interface ChunkEntropy {
      index: number;
      offset: number;
      offsetHex: string;
      entropy: number;
      classification: 'low' | 'medium' | 'high';
    }

    const chunks: ChunkEntropy[] = [];
    let minEntropy = 8;
    let maxEntropy = 0;
    let sumEntropy = 0;

    for (let c = 0; c < analyzeChunks; c++) {
      const start = c * chunkSize;
      const end = Math.min(start + chunkSize, data.length);
      const entropy = shannonEntropy(data.subarray(start, end));
      const classification: ChunkEntropy['classification'] =
        entropy >= 7.0 ? 'high' : entropy >= 4.0 ? 'medium' : 'low';
      chunks.push({
        index: c,
        offset: start,
        offsetHex: `0x${start.toString(16)}`,
        entropy: Number(entropy.toFixed(3)),
        classification,
      });
      if (entropy < minEntropy) minEntropy = entropy;
      if (entropy > maxEntropy) maxEntropy = entropy;
      sumEntropy += entropy;
    }

    const avgEntropy = analyzeChunks > 0 ? sumEntropy / analyzeChunks : 0;
    const highEntropyChunks = chunks.filter((c) => c.classification === 'high');

    return jsonResponse({
      success: true,
      filePath,
      size: data.length,
      chunkSize,
      chunksAnalyzed: analyzeChunks,
      totalChunks,
      truncated: totalChunks > analyzeChunks,
      stats: {
        minEntropy: Number(minEntropy.toFixed(3)),
        maxEntropy: Number(maxEntropy.toFixed(3)),
        avgEntropy: Number(avgEntropy.toFixed(3)),
      },
      highEntropyRegionCount: highEntropyChunks.length,
      highEntropyRegions: highEntropyChunks.slice(0, 50),
      note:
        highEntropyChunks.length > 0
          ? `${highEntropyChunks.length} high-entropy regions (>=7.0 bits/byte) detected — likely encrypted, packed, or compressed. Cross-reference offsets with section headers.`
          : 'No high-entropy regions detected. The binary does not appear to contain encrypted/packed sections at the requested chunk size.',
    });
  }
}

/** Shannon entropy of a byte buffer in bits/byte (0..8). */
function shannonEntropy(buf: Buffer): number {
  if (buf.length === 0) return 0;
  const counts = Array.from({ length: 256 }, () => 0);
  for (let i = 0; i < buf.length; i++) {
    counts[buf[i]!]!++;
  }
  let entropy = 0;
  const len = buf.length;
  for (let i = 0; i < 256; i++) {
    const c = counts[i]!;
    if (c === 0) continue;
    const p = c / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}
