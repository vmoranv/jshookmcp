import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import type { CodeCollector } from '@server/domains/shared/modules';
import {
  MAGIC_SIGNATURES,
  type ByteFrequencyEntry,
  type DecodeEncoding,
  type DetectSource,
  type EntropyAssessment,
  type EntropySource,
  type OutputFormat,
} from '@server/domains/encoding/handlers.impl.core.runtime.shared';

export class EncodingHandlersBase {
  protected collector: CodeCollector;

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  protected isMostlyPrintableText(text: string): boolean {
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

  protected previewHex(buffer: Buffer, maxBytes: number): string {
    const sample = buffer.subarray(0, maxBytes);
    return Array.from(sample.values())
      .map((value) => value.toString(16).padStart(2, '0'))
      .join(' ');
  }

  protected hexDump(buffer: Buffer, bytesPerRow = 16): string {
    const lines: string[] = [];
    for (let offset = 0; offset < buffer.length; offset += bytesPerRow) {
      const row = buffer.subarray(offset, offset + bytesPerRow);
      const hex = Array.from(row.values())
        .map((value) => value.toString(16).padStart(2, '0'))
        .join(' ');
      const ascii = Array.from(row.values())
        .map((value) => (value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.'))
        .join('');
      lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  |${ascii}|`);
    }
    return lines.join('\n');
  }

  protected decodeHexString(value: string): Buffer {
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

  protected decodeBase64String(value: string): Buffer {
    const cleaned = value.trim().replace(/\s+/g, '');
    if (cleaned.length === 0) {
      return Buffer.alloc(0);
    }
    if (!this.looksLikeBase64(cleaned)) {
      throw new Error('Invalid base64 string');
    }
    return Buffer.from(cleaned, 'base64');
  }

  protected decodeBinaryAuto(value: string): Buffer {
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

  protected looksLikeHex(value: string): boolean {
    const cleaned = value
      .trim()
      .replace(/^0x/i, '')
      .replace(/[\s:,-]/g, '');
    return cleaned.length > 0 && cleaned.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(cleaned);
  }

  protected looksLikeBase64(value: string): boolean {
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

  protected looksLikeUrlEncoded(value: string): boolean {
    return /%[0-9a-fA-F]{2}/.test(value) || /\+/.test(value);
  }

  protected decodeUrl(value: string): string {
    return decodeURIComponent(value.replace(/\+/g, '%20'));
  }

  protected encodeUrlBytes(buffer: Buffer): string {
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

  protected toSafeUtf8(buffer: Buffer): string | null {
    const text = buffer.toString('utf8');
    if ((text.match(/\uFFFD/g) ?? []).length > 0) {
      return null;
    }
    return text;
  }

  protected tryParseJson(text: string): unknown | null {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }

  protected renderDecodedOutput(params: {
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
      result: jsonValue ?? {
        parsedJson: maybeJson,
        utf8,
        hex: buffer.toString('hex'),
      },
    });
  }

  protected ok(payload: Record<string, unknown>) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  protected fail(tool: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return this.ok({
      success: false,
      tool,
      error: message,
    });
  }

  protected async resolveBufferBySource(options: {
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

      const resolved = resolve(filePath);
      const real = await realpath(resolved);
      const allowedRoots = [tmpdir(), homedir(), process.cwd()].map((p) =>
        isAbsolute(p) ? p : resolve(p)
      );
      const isAllowed = allowedRoots.some((root) => real.startsWith(root));
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

  protected async resolveRequestBodyFromActivePage(requestId: string): Promise<Buffer | null> {
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

  protected detectMagicFormats(buffer: Buffer): string[] {
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

  protected detectStructuredFormats(buffer: Buffer): string[] {
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
    if ((firstByte >= 0xa0 && firstByte <= 0xbf) || (firstByte >= 0x80 && firstByte <= 0x9f)) {
      formats.add('cbor');
    }

    return Array.from(formats);
  }

  protected detectEncodingSignals(
    source: DetectSource,
    data: string | undefined,
    buffer: Buffer
  ): string[] {
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

  protected calculateShannonEntropy(buffer: Buffer): number {
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

  protected calculateByteFrequency(buffer: Buffer): ByteFrequencyEntry[] {
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

  protected calculateBlockEntropies(
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

  protected assessEntropy(entropy: number, buffer: Buffer): EntropyAssessment {
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

  protected printableRatio(buffer: Buffer): number {
    if (buffer.length === 0) {
      return 1;
    }

    let printable = 0;
    for (const value of buffer.values()) {
      if ((value >= 0x20 && value <= 0x7e) || value === 0x09 || value === 0x0a || value === 0x0d) {
        printable += 1;
      }
    }

    return printable / buffer.length;
  }
}
