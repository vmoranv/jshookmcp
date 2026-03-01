import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import type {
  DecodeEncoding,
  OutputFormat,
} from './handlers.impl.core.runtime.shared.js';

export class EncodingToolHandlersFormat {
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
        .map((value) =>
          value >= 0x20 && value <= 0x7e ? String.fromCharCode(value) : '.'
        )
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
      result:
        jsonValue ??
        {
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
}