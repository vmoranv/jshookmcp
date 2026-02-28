import { readFile, realpath } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';

type DetectSource = 'base64' | 'hex' | 'file' | 'raw';
type EntropySource = 'base64' | 'hex' | 'raw' | 'file';
type DecodeEncoding = 'base64' | 'hex' | 'url' | 'protobuf' | 'msgpack';
type OutputFormat = 'hex' | 'utf8' | 'json';
type InputFormat = 'utf8' | 'hex' | 'json';
type OutputEncoding = 'base64' | 'hex' | 'url';
type EntropyAssessment = 'plaintext' | 'encoded' | 'compressed' | 'encrypted' | 'random';

interface MagicSignature {
  readonly format: string;
  readonly bytes: readonly number[];
}

interface ByteFrequencyEntry {
  byte: string;
  count: number;
  ratio: number;
}

interface ProtobufFieldNode {
  index: number;
  fieldNumber: number;
  wireType: number;
  wireTypeName: string;
  value: unknown;
}

interface ProtobufParseResult {
  fields: ProtobufFieldNode[];
  bytesConsumed: number;
  error?: string;
}

interface MsgPackDecodeResult {
  value: unknown;
  offset: number;
}

const MAGIC_SIGNATURES: ReadonlyArray<MagicSignature> = [
  { format: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { format: 'jpeg', bytes: [0xff, 0xd8, 0xff] },
  { format: 'gif', bytes: [0x47, 0x49, 0x46] },
  { format: 'wasm', bytes: [0x00, 0x61, 0x73, 0x6d] },
  { format: 'zip/apk', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { format: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

const DETECT_SOURCE_SET: ReadonlySet<DetectSource> = new Set(['base64', 'hex', 'file', 'raw']);
const ENTROPY_SOURCE_SET: ReadonlySet<EntropySource> = new Set(['base64', 'hex', 'raw', 'file']);
const DECODE_ENCODING_SET: ReadonlySet<DecodeEncoding> = new Set([
  'base64',
  'hex',
  'url',
  'protobuf',
  'msgpack',
]);
const OUTPUT_FORMAT_SET: ReadonlySet<OutputFormat> = new Set(['hex', 'utf8', 'json']);
const INPUT_FORMAT_SET: ReadonlySet<InputFormat> = new Set(['utf8', 'hex', 'json']);
const OUTPUT_ENCODING_SET: ReadonlySet<OutputEncoding> = new Set(['base64', 'hex', 'url']);

export class EncodingToolHandlers {
  private collector: CodeCollector;

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  async handleBinaryDetectFormat(args: Record<string, unknown>) {
    try {
      const sourceRaw = (args.source as string | undefined) ?? 'raw';
      if (!DETECT_SOURCE_SET.has(sourceRaw as DetectSource)) {
        throw new Error(`Invalid source: ${sourceRaw}`);
      }
      const source = sourceRaw as DetectSource;
      const data = typeof args.data === 'string' ? args.data : undefined;
      const filePath = typeof args.filePath === 'string' ? args.filePath : undefined;
      const requestId = typeof args.requestId === 'string' ? args.requestId : undefined;

      let buffer: Buffer | null = null;
      let requestBodyUsed = false;

      if (source === 'raw' && requestId) {
        buffer = await this.resolveRequestBodyFromActivePage(requestId);
        requestBodyUsed = buffer !== null;
      }

      if (!buffer) {
        if (source !== 'file' && !data) {
          throw new Error('data is required for non-file source when requestId payload is unavailable');
        }

        buffer = await this.resolveBufferBySource({
          source,
          data,
          filePath,
          maxBytes: source === 'file' ? 512 : undefined,
        });
      }

      const entropy = this.calculateShannonEntropy(buffer);
      const magicFormats = this.detectMagicFormats(buffer);
      const encodingSignals = this.detectEncodingSignals(source, data, buffer);
      const structuredFormats = this.detectStructuredFormats(buffer);
      const assessment = this.assessEntropy(entropy, buffer);

      return this.ok({
        success: true,
        source,
        requestId: requestId ?? null,
        requestBodyUsed,
        byteLength: buffer.length,
        previewHex: this.previewHex(buffer, 64),
        magicFormats,
        structuredFormats,
        encodingSignals,
        entropy,
        assessment,
        topBytes: this.calculateByteFrequency(buffer).slice(0, 8),
      });
    } catch (error) {
      return this.fail('binary_detect_format', error);
    }
  }

  async handleBinaryDecode(args: Record<string, unknown>) {
    try {
      const data = typeof args.data === 'string' ? args.data : '';
      const encodingRaw = (args.encoding as string | undefined) ?? '';
      const outputFormatRaw = (args.outputFormat as string | undefined) ?? 'hex';

      if (!data) {
        throw new Error('data is required');
      }
      if (!DECODE_ENCODING_SET.has(encodingRaw as DecodeEncoding)) {
        throw new Error(`Invalid encoding: ${encodingRaw}`);
      }
      if (!OUTPUT_FORMAT_SET.has(outputFormatRaw as OutputFormat)) {
        throw new Error(`Invalid outputFormat: ${outputFormatRaw}`);
      }

      const encoding = encodingRaw as DecodeEncoding;
      const outputFormat = outputFormatRaw as OutputFormat;

      if (encoding === 'url') {
        const decoded = this.decodeUrl(data);
        if (outputFormat === 'hex') {
          const raw = Buffer.from(decoded, 'utf8');
          return this.ok({
            success: true,
            encoding,
            outputFormat,
            byteLength: raw.length,
            result: raw.toString('hex'),
            hexDump: this.hexDump(raw),
          });
        }
        if (outputFormat === 'utf8') {
          return this.ok({
            success: true,
            encoding,
            outputFormat,
            result: decoded,
          });
        }

        const parsed = this.tryParseJson(decoded);
        return this.ok({
          success: true,
          encoding,
          outputFormat,
          result: parsed ?? { text: decoded },
        });
      }

      const rawBuffer =
        encoding === 'base64'
          ? this.decodeBase64String(data)
          : encoding === 'hex'
            ? this.decodeHexString(data)
            : this.decodeBinaryAuto(data);

      if (encoding === 'protobuf') {
        const parsed = this.parseProtobufMessage(rawBuffer, 0, 5);
        return this.renderDecodedOutput({
          encoding,
          outputFormat,
          buffer: rawBuffer,
          jsonValue: {
            fields: parsed.fields,
            bytesConsumed: parsed.bytesConsumed,
            error: parsed.error ?? null,
          },
        });
      }

      if (encoding === 'msgpack') {
        const parsed = this.decodeMsgPack(rawBuffer);
        return this.renderDecodedOutput({
          encoding,
          outputFormat,
          buffer: rawBuffer,
          jsonValue: parsed,
        });
      }

      return this.renderDecodedOutput({
        encoding,
        outputFormat,
        buffer: rawBuffer,
      });
    } catch (error) {
      return this.fail('binary_decode', error);
    }
  }

  async handleBinaryEncode(args: Record<string, unknown>) {
    try {
      const data = typeof args.data === 'string' ? args.data : '';
      const inputFormatRaw = (args.inputFormat as string | undefined) ?? '';
      const outputEncodingRaw = (args.outputEncoding as string | undefined) ?? '';

      if (!data) {
        throw new Error('data is required');
      }
      if (!INPUT_FORMAT_SET.has(inputFormatRaw as InputFormat)) {
        throw new Error(`Invalid inputFormat: ${inputFormatRaw}`);
      }
      if (!OUTPUT_ENCODING_SET.has(outputEncodingRaw as OutputEncoding)) {
        throw new Error(`Invalid outputEncoding: ${outputEncodingRaw}`);
      }

      const inputFormat = inputFormatRaw as InputFormat;
      const outputEncoding = outputEncodingRaw as OutputEncoding;

      let buffer: Buffer;
      if (inputFormat === 'utf8') {
        buffer = Buffer.from(data, 'utf8');
      } else if (inputFormat === 'hex') {
        buffer = this.decodeHexString(data);
      } else {
        const parsed = JSON.parse(data) as unknown;
        buffer = Buffer.from(JSON.stringify(parsed), 'utf8');
      }

      const output =
        outputEncoding === 'base64'
          ? buffer.toString('base64')
          : outputEncoding === 'hex'
            ? buffer.toString('hex')
            : this.encodeUrlBytes(buffer);

      return this.ok({
        success: true,
        inputFormat,
        outputEncoding,
        byteLength: buffer.length,
        output,
      });
    } catch (error) {
      return this.fail('binary_encode', error);
    }
  }

  async handleBinaryEntropyAnalysis(args: Record<string, unknown>) {
    try {
      const sourceRaw = (args.source as string | undefined) ?? 'raw';
      if (!ENTROPY_SOURCE_SET.has(sourceRaw as EntropySource)) {
        throw new Error(`Invalid source: ${sourceRaw}`);
      }
      const source = sourceRaw as EntropySource;
      const data = typeof args.data === 'string' ? args.data : undefined;
      const filePath = typeof args.filePath === 'string' ? args.filePath : undefined;

      if (source !== 'file' && !data) {
        throw new Error('data is required for non-file source');
      }

      const blockSizeRaw = typeof args.blockSize === 'number' ? args.blockSize : 256;
      const blockSize = Math.max(16, Math.min(8192, Math.trunc(blockSizeRaw || 256)));

      const buffer = await this.resolveBufferBySource({
        source,
        data,
        filePath,
      });

      const overallEntropy = this.calculateShannonEntropy(buffer);
      const blockEntropies = this.calculateBlockEntropies(buffer, blockSize);
      const byteFrequency = this.calculateByteFrequency(buffer).slice(0, 20);
      const assessment = this.assessEntropy(overallEntropy, buffer);

      return this.ok({
        success: true,
        source,
        byteLength: buffer.length,
        blockSize,
        overallEntropy,
        blockEntropies,
        byteFrequency,
        assessment,
      });
    } catch (error) {
      return this.fail('binary_entropy_analysis', error);
    }
  }

  async handleProtobufDecodeRaw(args: Record<string, unknown>) {
    try {
      const data = typeof args.data === 'string' ? args.data : '';
      if (!data) {
        throw new Error('data is required');
      }

      const maxDepthRaw = typeof args.maxDepth === 'number' ? args.maxDepth : 5;
      const maxDepth = Math.max(1, Math.min(20, Math.trunc(maxDepthRaw || 5)));
      const buffer = this.decodeBase64String(data);
      const parsed = this.parseProtobufMessage(buffer, 0, maxDepth);

      return this.ok({
        success: parsed.error === undefined,
        byteLength: buffer.length,
        maxDepth,
        parsedBytes: parsed.bytesConsumed,
        fields: parsed.fields,
        error: parsed.error ?? null,
      });
    } catch (error) {
      return this.fail('protobuf_decode_raw', error);
    }
  }

  private renderDecodedOutput(params: {
    encoding: DecodeEncoding;
    outputFormat: OutputFormat;
    buffer: Buffer;
    jsonValue?: unknown;
  }) {
    const { encoding, outputFormat, buffer, jsonValue } = params;

    if (outputFormat === 'hex') {
      return this.ok({
        success: true,
        encoding,
        outputFormat,
        byteLength: buffer.length,
        result: buffer.toString('hex'),
        hexDump: this.hexDump(buffer),
      });
    }

    if (outputFormat === 'utf8') {
      return this.ok({
        success: true,
        encoding,
        outputFormat,
        byteLength: buffer.length,
        result: buffer.toString('utf8'),
      });
    }

    const utf8 = this.toSafeUtf8(buffer);
    const maybeJson = utf8 === null ? null : this.tryParseJson(utf8);

    return this.ok({
      success: true,
      encoding,
      outputFormat,
      byteLength: buffer.length,
      result:
        jsonValue ??
        {
          parsedJson: maybeJson,
          utf8,
          hex: buffer.toString('hex'),
        },
    });
  }

  private async resolveBufferBySource(options: {
    source: DetectSource | EntropySource;
    data?: string;
    filePath?: string;
    maxBytes?: number;
  }): Promise<Buffer> {
    const { source, data, filePath, maxBytes } = options;

    if (source === 'file') {
      if (!filePath) {
        throw new Error('filePath is required when source=file');
      }
      // Path traversal guard: resolve and verify against allowed directories
      const resolved = resolve(filePath);
      const real = await realpath(resolved);
      const allowedRoots = [tmpdir(), homedir(), process.cwd()].map(p =>
        isAbsolute(p) ? p : resolve(p)
      );
      const isAllowed = allowedRoots.some(root => real.startsWith(root));
      if (!isAllowed) {
        throw new Error(`File access denied: path "${filePath}" is outside allowed directories`);
      }
      const fileBuffer = await readFile(real);
      return typeof maxBytes === 'number' ? fileBuffer.subarray(0, maxBytes) : fileBuffer;
    }

    if (source === 'base64') {
      if (!data) {
        throw new Error('data is required for base64 source');
      }
      return this.decodeBase64String(data);
    }

    if (source === 'hex') {
      if (!data) {
        throw new Error('data is required for hex source');
      }
      return this.decodeHexString(data);
    }

    return Buffer.from(data ?? '', 'utf8');
  }

  private async resolveRequestBodyFromActivePage(requestId: string): Promise<Buffer | null> {
    try {
      const page = await this.collector.getActivePage();
      const result = await page.evaluate((targetRequestId: string) => {
        const pickBody = (entry: unknown): { body: string; base64Encoded: boolean } | null => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }

          const record = entry as Record<string, unknown>;
          if (record.requestId !== targetRequestId) {
            return null;
          }

          if (typeof record.responseBody === 'string') {
            return {
              body: record.responseBody,
              base64Encoded: Boolean(record.base64Encoded),
            };
          }

          if (typeof record.body === 'string') {
            return {
              body: record.body,
              base64Encoded: Boolean(record.base64Encoded),
            };
          }

          const response = record.response;
          if (response && typeof response === 'object') {
            const responseRecord = response as Record<string, unknown>;
            if (typeof responseRecord.body === 'string') {
              return {
                body: responseRecord.body,
                base64Encoded: Boolean(responseRecord.base64Encoded),
              };
            }
          }

          return null;
        };

        const searchArray = (payload: unknown): { body: string; base64Encoded: boolean } | null => {
          if (!Array.isArray(payload)) {
            return null;
          }
          for (const item of payload) {
            const found = pickBody(item);
            if (found) {
              return found;
            }
          }
          return null;
        };

        const win = window as unknown as Record<string, unknown>;
        const fromMemory = searchArray(win.__capturedAPIs);
        if (fromMemory) {
          return fromMemory;
        }

        try {
          const raw = window.localStorage.getItem('__capturedAPIs');
          if (!raw) {
            return null;
          }
          const parsed = JSON.parse(raw) as unknown;
          return searchArray(parsed);
        } catch {
          return null;
        }
      }, requestId);

      if (!result || typeof result !== 'object') {
        return null;
      }

      const payload = result as { body?: string; base64Encoded?: boolean };
      if (typeof payload.body !== 'string') {
        return null;
      }

      if (payload.base64Encoded) {
        return Buffer.from(payload.body, 'base64');
      }

      const maybeBase64 = payload.body.trim();
      if (this.looksLikeBase64(maybeBase64)) {
        return Buffer.from(maybeBase64, 'base64');
      }

      return Buffer.from(payload.body, 'utf8');
    } catch {
      return null;
    }
  }

  private detectMagicFormats(buffer: Buffer): string[] {
    const matches: string[] = [];

    for (const signature of MAGIC_SIGNATURES) {
      if (buffer.length < signature.bytes.length) {
        continue;
      }

      let matched = true;
      for (let index = 0; index < signature.bytes.length; index += 1) {
        const actual = buffer[index];
        const expected = signature.bytes[index];
        if (actual === undefined || expected === undefined || actual !== expected) {
          matched = false;
          break;
        }
      }

      if (matched) {
        matches.push(signature.format);
      }
    }

    return matches;
  }

  private detectStructuredFormats(buffer: Buffer): string[] {
    const firstByte = buffer[0];
    if (firstByte === undefined) {
      return [];
    }

    const formats = new Set<string>();

    if ([0x08, 0x10, 0x18, 0x20].includes(firstByte)) {
      formats.add('protobuf');
    }
    if (
      (firstByte >= 0x80 && firstByte <= 0x8f) ||
      (firstByte >= 0x90 && firstByte <= 0x9f) ||
      (firstByte >= 0xa0 && firstByte <= 0xbf)
    ) {
      formats.add('messagepack');
    }
    if (
      (firstByte >= 0xa0 && firstByte <= 0xbf) ||
      (firstByte >= 0x80 && firstByte <= 0x9f)
    ) {
      formats.add('cbor');
    }

    return Array.from(formats);
  }

  private detectEncodingSignals(source: DetectSource, data: string | undefined, buffer: Buffer): string[] {
    const encodings = new Set<string>();

    if (source === 'base64' || (data && this.looksLikeBase64(data.trim()))) {
      encodings.add('base64');
    }
    if (source === 'hex' || (data && this.looksLikeHex(data))) {
      encodings.add('hex');
    }
    if (data && this.looksLikeUrlEncoded(data)) {
      encodings.add('url-encoded');
    }

    if (buffer.length >= 3) {
      const a = buffer[0];
      const b = buffer[1];
      const c = buffer[2];
      if (a === 0xef && b === 0xbb && c === 0xbf) {
        encodings.add('utf8-bom');
      }
    }

    return Array.from(encodings);
  }

  private calculateShannonEntropy(buffer: Buffer): number {
    if (buffer.length === 0) {
      return 0;
    }

    const freq = new Array<number>(256).fill(0);
    for (const value of buffer.values()) {
      freq[value]! += 1;
    }

    let entropy = 0;
    for (const count of freq) {
      if (count === 0) {
        continue;
      }
      const probability = count / buffer.length;
      entropy -= probability * Math.log2(probability);
    }

    return Number(entropy.toFixed(6));
  }

  private calculateByteFrequency(buffer: Buffer): ByteFrequencyEntry[] {
    if (buffer.length === 0) {
      return [];
    }

    const freq = new Array<number>(256).fill(0);
    for (const value of buffer.values()) {
      freq[value]! += 1;
    }

    const entries: ByteFrequencyEntry[] = [];
    for (let value = 0; value < 256; value += 1) {
      const count = freq[value]!;
      if (count === 0) {
        continue;
      }
      entries.push({
        byte: `0x${value.toString(16).padStart(2, '0')}`,
        count: count,
        ratio: Number((count / buffer.length).toFixed(6)),
      });
    }

    entries.sort((left, right) => right.count - left.count);
    return entries;
  }

  private calculateBlockEntropies(
    buffer: Buffer,
    blockSize: number
  ): Array<{ index: number; start: number; end: number; entropy: number }> {
    if (buffer.length === 0) {
      return [];
    }

    const blocks: Array<{ index: number; start: number; end: number; entropy: number }> = [];
    let index = 0;
    for (let start = 0; start < buffer.length; start += blockSize) {
      const end = Math.min(start + blockSize, buffer.length);
      const chunk = buffer.subarray(start, end);
      blocks.push({
        index,
        start,
        end,
        entropy: this.calculateShannonEntropy(chunk),
      });
      index += 1;
    }

    return blocks;
  }

  private assessEntropy(entropy: number, buffer: Buffer): EntropyAssessment {
    const printableRatio = this.printableRatio(buffer);

    if (entropy < 3.8 && printableRatio > 0.85) {
      return 'plaintext';
    }
    if (entropy < 5.8) {
      return 'encoded';
    }
    if (entropy < 7.2) {
      return 'compressed';
    }
    if (entropy < 7.8) {
      return 'encrypted';
    }
    return 'random';
  }

  private printableRatio(buffer: Buffer): number {
    if (buffer.length === 0) {
      return 1;
    }

    let printable = 0;
    for (const value of buffer.values()) {
      if (
        (value >= 0x20 && value <= 0x7e) ||
        value === 0x09 ||
        value === 0x0a ||
        value === 0x0d
      ) {
        printable += 1;
      }
    }

    return printable / buffer.length;
  }

  private isMostlyPrintableText(text: string): boolean {
    if (text.length === 0) {
      return true;
    }

    let printable = 0;
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if ((code >= 0x20 && code <= 0x7e) || code === 0x09 || code === 0x0a || code === 0x0d) {
        printable += 1;
      }
    }
    return printable / text.length >= 0.85;
  }

  private previewHex(buffer: Buffer, maxBytes: number): string {
    const sample = buffer.subarray(0, maxBytes);
    return Array.from(sample.values())
      .map((value) => value.toString(16).padStart(2, '0'))
      .join(' ');
  }

  private hexDump(buffer: Buffer, bytesPerRow = 16): string {
    const lines: string[] = [];
    for (let offset = 0; offset < buffer.length; offset += bytesPerRow) {
      const row = buffer.subarray(offset, offset + bytesPerRow);
      const hex = Array.from(row.values())
        .map((value) => value.toString(16).padStart(2, '0'))
        .join(' ');
      const ascii = Array.from(row.values())
        .map((value) =>
          value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.'
        )
        .join('');
      lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  |${ascii}|`);
    }
    return lines.join('\n');
  }

  private decodeHexString(value: string): Buffer {
    const cleaned = value
      .trim()
      .replace(/^0x/i, '')
      .replace(/[\s:,-]/g, '');

    if (cleaned.length === 0) {
      return Buffer.alloc(0);
    }
    if (cleaned.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(cleaned)) {
      throw new Error('Invalid hex string');
    }

    return Buffer.from(cleaned, 'hex');
  }

  private decodeBase64String(value: string): Buffer {
    const cleaned = value.trim().replace(/\s+/g, '');
    if (cleaned.length === 0) {
      return Buffer.alloc(0);
    }
    if (!this.looksLikeBase64(cleaned)) {
      throw new Error('Invalid base64 string');
    }
    return Buffer.from(cleaned, 'base64');
  }

  private decodeBinaryAuto(value: string): Buffer {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return Buffer.alloc(0);
    }
    if (this.looksLikeHex(trimmed)) {
      return this.decodeHexString(trimmed);
    }
    if (this.looksLikeBase64(trimmed)) {
      return this.decodeBase64String(trimmed);
    }
    return Buffer.from(trimmed, 'utf8');
  }

  private looksLikeHex(value: string): boolean {
    const cleaned = value
      .trim()
      .replace(/^0x/i, '')
      .replace(/[\s:,-]/g, '');
    return cleaned.length > 0 && cleaned.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(cleaned);
  }

  private looksLikeBase64(value: string): boolean {
    const cleaned = value.trim().replace(/\s+/g, '');
    if (cleaned.length === 0 || cleaned.length % 4 !== 0) {
      return false;
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
      return false;
    }

    try {
      const decoded = Buffer.from(cleaned, 'base64');
      const normalizedInput = cleaned.replace(/=+$/, '');
      const normalizedRoundtrip = decoded.toString('base64').replace(/=+$/, '');
      return normalizedInput === normalizedRoundtrip;
    } catch {
      return false;
    }
  }

  private looksLikeUrlEncoded(value: string): boolean {
    return /%[0-9a-fA-F]{2}/.test(value) || /\+/.test(value);
  }

  private decodeUrl(value: string): string {
    return decodeURIComponent(value.replace(/\+/g, '%20'));
  }

  private encodeUrlBytes(buffer: Buffer): string {
    let encoded = '';
    for (const value of buffer.values()) {
      const isAlphaNum =
        (value >= 0x30 && value <= 0x39) ||
        (value >= 0x41 && value <= 0x5a) ||
        (value >= 0x61 && value <= 0x7a);
      const isUnreserved = value === 0x2d || value === 0x2e || value === 0x5f || value === 0x7e;

      if (isAlphaNum || isUnreserved) {
        encoded += String.fromCharCode(value);
      } else {
        encoded += `%${value.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
    return encoded;
  }

  private parseProtobufMessage(buffer: Buffer, depth: number, maxDepth: number): ProtobufParseResult {
    const fields: ProtobufFieldNode[] = [];
    let offset = 0;
    let fieldIndex = 0;

    while (offset < buffer.length) {
      const keyInfo = this.tryParseVarint(buffer, offset);
      if (keyInfo.error) {
        return {
          fields,
          bytesConsumed: offset,
          error: keyInfo.error,
        };
      }

      const keyValue = keyInfo.value as bigint;
      offset = keyInfo.offset as number;

      const fieldNumber = Number(keyValue >> 3n);
      const wireType = Number(keyValue & 0x07n);

      if (fieldNumber <= 0) {
        return {
          fields,
          bytesConsumed: offset,
          error: `Invalid field number ${fieldNumber} at offset ${offset}`,
        };
      }

      if (wireType === 0) {
        const varintInfo = this.tryParseVarint(buffer, offset);
        if (varintInfo.error) {
          return {
            fields,
            bytesConsumed: offset,
            error: varintInfo.error,
          };
        }
        offset = varintInfo.offset as number;
        fields.push({
          index: fieldIndex,
          fieldNumber,
          wireType,
          wireTypeName: this.protobufWireTypeName(wireType),
          value: this.bigIntToSafeValue(varintInfo.value as bigint),
        });
      } else if (wireType === 1) {
        if (offset + 8 > buffer.length) {
          return {
            fields,
            bytesConsumed: offset,
            error: `Unexpected EOF for fixed64 at offset ${offset}`,
          };
        }
        const raw = buffer.subarray(offset, offset + 8);
        const fixed64 = raw.readBigUInt64LE(0);
        offset += 8;
        fields.push({
          index: fieldIndex,
          fieldNumber,
          wireType,
          wireTypeName: this.protobufWireTypeName(wireType),
          value: {
            uint64: this.bigIntToSafeValue(fixed64),
            hex: raw.toString('hex'),
          },
        });
      } else if (wireType === 2) {
        const lengthInfo = this.tryParseVarint(buffer, offset);
        if (lengthInfo.error) {
          return {
            fields,
            bytesConsumed: offset,
            error: lengthInfo.error,
          };
        }

        offset = lengthInfo.offset as number;
        const lengthBigInt = lengthInfo.value as bigint;
        if (lengthBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
          return {
            fields,
            bytesConsumed: offset,
            error: `Length-delimited field is too large at offset ${offset}`,
          };
        }

        const length = Number(lengthBigInt);
        if (length < 0 || offset + length > buffer.length) {
          return {
            fields,
            bytesConsumed: offset,
            error: `Invalid length-delimited field length=${length} at offset ${offset}`,
          };
        }

        const payload = buffer.subarray(offset, offset + length);
        offset += length;

        fields.push({
          index: fieldIndex,
          fieldNumber,
          wireType,
          wireTypeName: this.protobufWireTypeName(wireType),
          value: this.decodeLengthDelimited(payload, depth, maxDepth),
        });
      } else if (wireType === 5) {
        if (offset + 4 > buffer.length) {
          return {
            fields,
            bytesConsumed: offset,
            error: `Unexpected EOF for fixed32 at offset ${offset}`,
          };
        }
        const raw = buffer.subarray(offset, offset + 4);
        const fixed32 = raw.readUInt32LE(0);
        offset += 4;
        fields.push({
          index: fieldIndex,
          fieldNumber,
          wireType,
          wireTypeName: this.protobufWireTypeName(wireType),
          value: {
            uint32: fixed32,
            hex: raw.toString('hex'),
          },
        });
      } else {
        return {
          fields,
          bytesConsumed: offset,
          error: `Unsupported wire type ${wireType} at offset ${offset}`,
        };
      }

      fieldIndex += 1;
    }

    return {
      fields,
      bytesConsumed: offset,
    };
  }

  private decodeLengthDelimited(payload: Buffer, depth: number, maxDepth: number): unknown {
    if (payload.length === 0) {
      return { kind: 'empty', length: 0 };
    }

    if (depth < maxDepth) {
      const nested = this.parseProtobufMessage(payload, depth + 1, maxDepth);
      if (!nested.error && nested.bytesConsumed === payload.length && nested.fields.length > 0) {
        return {
          kind: 'message',
          fields: nested.fields,
        };
      }
    }

    const text = this.toSafeUtf8(payload);
    if (text !== null && this.isMostlyPrintableText(text)) {
      return {
        kind: 'string',
        value: text,
      };
    }

    return {
      kind: 'bytes',
      length: payload.length,
      hex: payload.toString('hex'),
      base64: payload.toString('base64'),
    };
  }

  private tryParseVarint(
    buffer: Buffer,
    startOffset: number
  ): { value?: bigint; offset?: number; error?: string } {
    let result = 0n;
    let shift = 0n;
    let offset = startOffset;

    for (let index = 0; index < 10; index += 1) {
      const current = buffer[offset];
      if (current === undefined) {
        return { error: `Unexpected EOF while parsing varint at offset ${offset}` };
      }

      const byte = BigInt(current);
      result |= (byte & 0x7fn) << shift;
      offset += 1;

      if ((byte & 0x80n) === 0n) {
        return { value: result, offset };
      }

      shift += 7n;
    }

    return { error: `Varint exceeds 10 bytes at offset ${startOffset}` };
  }

  private protobufWireTypeName(wireType: number): string {
    if (wireType === 0) return 'varint';
    if (wireType === 1) return 'fixed64';
    if (wireType === 2) return 'length-delimited';
    if (wireType === 5) return 'fixed32';
    return 'unknown';
  }

  private bigIntToSafeValue(value: bigint): number | string {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    if (value <= max && value >= min) {
      return Number(value);
    }
    return value.toString();
  }

  private decodeMsgPack(buffer: Buffer): unknown {
    const decoded = this.decodeMsgPackValue(buffer, 0, 0);
    if (decoded.offset !== buffer.length) {
      throw new Error(
        `MessagePack decode ended early: consumed ${decoded.offset} of ${buffer.length} bytes`
      );
    }
    return decoded.value;
  }

  private decodeMsgPackValue(buffer: Buffer, startOffset: number, depth: number): MsgPackDecodeResult {
    if (depth > 64) {
      throw new Error('MessagePack decode depth exceeds safety limit');
    }

    const prefix = buffer[startOffset];
    if (prefix === undefined) {
      throw new Error(`Unexpected EOF at offset ${startOffset}`);
    }

    let offset = startOffset + 1;

    if (prefix <= 0x7f) {
      return { value: prefix, offset };
    }
    if (prefix >= 0xe0) {
      return { value: prefix - 0x100, offset };
    }
    if (prefix >= 0xa0 && prefix <= 0xbf) {
      const length = prefix & 0x1f;
      this.ensureRange(buffer, offset, length);
      const value = buffer.subarray(offset, offset + length).toString('utf8');
      return { value, offset: offset + length };
    }
    if (prefix >= 0x90 && prefix <= 0x9f) {
      const length = prefix & 0x0f;
      return this.decodeMsgPackArray(buffer, offset, length, depth + 1);
    }
    if (prefix >= 0x80 && prefix <= 0x8f) {
      const length = prefix & 0x0f;
      return this.decodeMsgPackMap(buffer, offset, length, depth + 1);
    }

    if (prefix === 0xc0) return { value: null, offset };
    if (prefix === 0xc2) return { value: false, offset };
    if (prefix === 0xc3) return { value: true, offset };

    if (prefix === 0xcc) {
      this.ensureRange(buffer, offset, 1);
      const value = buffer.readUInt8(offset);
      return { value, offset: offset + 1 };
    }
    if (prefix === 0xcd) {
      this.ensureRange(buffer, offset, 2);
      const value = buffer.readUInt16BE(offset);
      return { value, offset: offset + 2 };
    }
    if (prefix === 0xce) {
      this.ensureRange(buffer, offset, 4);
      const value = buffer.readUInt32BE(offset);
      return { value, offset: offset + 4 };
    }
    if (prefix === 0xcf) {
      this.ensureRange(buffer, offset, 8);
      const value = buffer.readBigUInt64BE(offset);
      return { value: this.bigIntToSafeValue(value), offset: offset + 8 };
    }

    if (prefix === 0xd0) {
      this.ensureRange(buffer, offset, 1);
      const value = buffer.readInt8(offset);
      return { value, offset: offset + 1 };
    }
    if (prefix === 0xd1) {
      this.ensureRange(buffer, offset, 2);
      const value = buffer.readInt16BE(offset);
      return { value, offset: offset + 2 };
    }
    if (prefix === 0xd2) {
      this.ensureRange(buffer, offset, 4);
      const value = buffer.readInt32BE(offset);
      return { value, offset: offset + 4 };
    }
    if (prefix === 0xd3) {
      this.ensureRange(buffer, offset, 8);
      const value = buffer.readBigInt64BE(offset);
      return { value: this.bigIntToSafeValue(value), offset: offset + 8 };
    }

    if (prefix === 0xca) {
      this.ensureRange(buffer, offset, 4);
      const value = buffer.readFloatBE(offset);
      return { value, offset: offset + 4 };
    }
    if (prefix === 0xcb) {
      this.ensureRange(buffer, offset, 8);
      const value = buffer.readDoubleBE(offset);
      return { value, offset: offset + 8 };
    }

    if (prefix === 0xd9) {
      this.ensureRange(buffer, offset, 1);
      const length = buffer.readUInt8(offset);
      offset += 1;
      this.ensureRange(buffer, offset, length);
      const value = buffer.subarray(offset, offset + length).toString('utf8');
      return { value, offset: offset + length };
    }
    if (prefix === 0xda) {
      this.ensureRange(buffer, offset, 2);
      const length = buffer.readUInt16BE(offset);
      offset += 2;
      this.ensureRange(buffer, offset, length);
      const value = buffer.subarray(offset, offset + length).toString('utf8');
      return { value, offset: offset + length };
    }
    if (prefix === 0xdb) {
      this.ensureRange(buffer, offset, 4);
      const length = buffer.readUInt32BE(offset);
      offset += 4;
      this.ensureRange(buffer, offset, length);
      const value = buffer.subarray(offset, offset + length).toString('utf8');
      return { value, offset: offset + length };
    }

    if (prefix === 0xc4) {
      this.ensureRange(buffer, offset, 1);
      const length = buffer.readUInt8(offset);
      offset += 1;
      this.ensureRange(buffer, offset, length);
      const payload = buffer.subarray(offset, offset + length);
      return {
        value: { type: 'bytes', base64: payload.toString('base64'), hex: payload.toString('hex') },
        offset: offset + length,
      };
    }
    if (prefix === 0xc5) {
      this.ensureRange(buffer, offset, 2);
      const length = buffer.readUInt16BE(offset);
      offset += 2;
      this.ensureRange(buffer, offset, length);
      const payload = buffer.subarray(offset, offset + length);
      return {
        value: { type: 'bytes', base64: payload.toString('base64'), hex: payload.toString('hex') },
        offset: offset + length,
      };
    }
    if (prefix === 0xc6) {
      this.ensureRange(buffer, offset, 4);
      const length = buffer.readUInt32BE(offset);
      offset += 4;
      this.ensureRange(buffer, offset, length);
      const payload = buffer.subarray(offset, offset + length);
      return {
        value: { type: 'bytes', base64: payload.toString('base64'), hex: payload.toString('hex') },
        offset: offset + length,
      };
    }

    if (prefix === 0xdc) {
      this.ensureRange(buffer, offset, 2);
      const length = buffer.readUInt16BE(offset);
      offset += 2;
      return this.decodeMsgPackArray(buffer, offset, length, depth + 1);
    }
    if (prefix === 0xdd) {
      this.ensureRange(buffer, offset, 4);
      const length = buffer.readUInt32BE(offset);
      offset += 4;
      return this.decodeMsgPackArray(buffer, offset, length, depth + 1);
    }

    if (prefix === 0xde) {
      this.ensureRange(buffer, offset, 2);
      const length = buffer.readUInt16BE(offset);
      offset += 2;
      return this.decodeMsgPackMap(buffer, offset, length, depth + 1);
    }
    if (prefix === 0xdf) {
      this.ensureRange(buffer, offset, 4);
      const length = buffer.readUInt32BE(offset);
      offset += 4;
      return this.decodeMsgPackMap(buffer, offset, length, depth + 1);
    }

    if (prefix >= 0xd4 && prefix <= 0xd8) {
      const sizeByPrefix: Record<number, number> = {
        0xd4: 1,
        0xd5: 2,
        0xd6: 4,
        0xd7: 8,
        0xd8: 16,
      };
      const size = sizeByPrefix[prefix]!;
      this.ensureRange(buffer, offset, 1 + size);
      const extType = buffer.readInt8(offset);
      const payload = buffer.subarray(offset + 1, offset + 1 + size);
      return {
        value: {
          type: 'ext',
          extType,
          base64: payload.toString('base64'),
          hex: payload.toString('hex'),
        },
        offset: offset + 1 + size,
      };
    }

    if (prefix === 0xc7 || prefix === 0xc8 || prefix === 0xc9) {
      const lengthBytes = prefix === 0xc7 ? 1 : prefix === 0xc8 ? 2 : 4;
      this.ensureRange(buffer, offset, lengthBytes);

      const length =
        lengthBytes === 1
          ? buffer.readUInt8(offset)
          : lengthBytes === 2
            ? buffer.readUInt16BE(offset)
            : buffer.readUInt32BE(offset);

      offset += lengthBytes;
      this.ensureRange(buffer, offset, 1 + length);

      const extType = buffer.readInt8(offset);
      const payload = buffer.subarray(offset + 1, offset + 1 + length);
      return {
        value: {
          type: 'ext',
          extType,
          base64: payload.toString('base64'),
          hex: payload.toString('hex'),
        },
        offset: offset + 1 + length,
      };
    }

    throw new Error(`Unsupported MessagePack prefix 0x${prefix.toString(16)} at offset ${startOffset}`);
  }

  private decodeMsgPackArray(
    buffer: Buffer,
    startOffset: number,
    length: number,
    depth: number
  ): MsgPackDecodeResult {
    let offset = startOffset;
    const values: unknown[] = [];

    for (let index = 0; index < length; index += 1) {
      const decoded = this.decodeMsgPackValue(buffer, offset, depth);
      values.push(decoded.value);
      offset = decoded.offset;
    }

    return { value: values, offset };
  }

  private decodeMsgPackMap(
    buffer: Buffer,
    startOffset: number,
    length: number,
    depth: number
  ): MsgPackDecodeResult {
    let offset = startOffset;
    const mapValue: Record<string, unknown> = {};

    for (let index = 0; index < length; index += 1) {
      const keyDecoded = this.decodeMsgPackValue(buffer, offset, depth);
      offset = keyDecoded.offset;

      const valueDecoded = this.decodeMsgPackValue(buffer, offset, depth);
      offset = valueDecoded.offset;

      const key = this.msgPackMapKey(keyDecoded.value);
      mapValue[key] = valueDecoded.value;
    }

    return { value: mapValue, offset };
  }

  private msgPackMapKey(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'bigint') return value.toString();
    if (value === null) return 'null';

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private ensureRange(buffer: Buffer, offset: number, length: number): void {
    if (offset < 0 || length < 0 || offset + length > buffer.length) {
      throw new Error(`Unexpected EOF while reading ${length} bytes at offset ${offset}`);
    }
  }

  private toSafeUtf8(buffer: Buffer): string | null {
    const text = buffer.toString('utf8');
    if ((text.match(/\uFFFD/g) ?? []).length > 0) {
      return null;
    }
    return text;
  }

  private tryParseJson(text: string): unknown | null {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  private ok(payload: Record<string, unknown>) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  private fail(tool: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return this.ok({
      success: false,
      tool,
      error: message,
    });
  }
}
