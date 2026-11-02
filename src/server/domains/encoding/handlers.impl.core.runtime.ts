/**
 * Encoding domain — composition facade.
 *
 * All utility functions extracted to ./handlers/shared.ts.
 * Handler methods call those functions directly instead of inheriting from a base class.
 */

import {
  brotliCompressSync,
  brotliDecompressSync,
  deflateRawSync,
  deflateSync,
  gunzipSync,
  gzipSync,
  inflateRawSync,
  inflateSync,
} from 'node:zlib';
import type { CodeCollector } from '@server/domains/shared/modules/collector';
import { parseProtobufMessage } from '@server/domains/encoding/encoding-protobuf';
import { decodeMsgPack } from '@server/domains/encoding/encoding-msgpack';
import { argString, argNumber, argEnum } from '@server/domains/shared/parse-args';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import {
  DECODE_ENCODING_SET,
  DETECT_SOURCE_SET,
  ENTROPY_SOURCE_SET,
  INPUT_FORMAT_SET,
  OUTPUT_ENCODING_SET,
  OUTPUT_FORMAT_SET,
  ok,
  fail,
  decodeHexString,
  decodeBase64String,
  decodeBinaryAuto,
  looksLikeBase64,
  decodeUrl,
  encodeUrlBytes,
  decodeBase32String,
  encodeBase32Bytes,
  decodeBase58String,
  encodeBase58Bytes,
  decodeAscii85String,
  encodeAscii85Bytes,
  previewHex,
  hexDump,
  renderDecodedOutput,
  resolveBufferBySource,
  resolveRequestBodyFromActivePage,
  detectMagicFormats,
  detectStructuredFormats,
  detectEncodingSignals,
  calculateShannonEntropy,
  calculateByteFrequency,
  calculateBlockEntropies,
  assessEntropy,
  calculateChiSquare,
  calculateSerialCorrelation,
  tryParseJson,
} from './handlers/shared';

// Re-export shared types for backward compat
export type {
  DetectSource,
  EntropySource,
  DecodeEncoding,
  OutputFormat,
  InputFormat,
  OutputEncoding,
  EntropyAssessment,
  MagicSignature,
  ByteFrequencyEntry,
} from './handlers/shared';

type ResponseBodyPayload = {
  body: string;
  base64Encoded: boolean;
};

type ResponseBodyResolver = (requestId: string) => Promise<ResponseBodyPayload | null>;

type ProtobufMessageWithUnknowns = {
  $unknowns?: readonly Uint8Array[];
};

function summarizeUnknownProtobufFields(message: unknown, maxDepth: number) {
  const rawFields = (message as ProtobufMessageWithUnknowns).$unknowns ?? [];
  return rawFields.map((rawField, index) => {
    const raw = Buffer.from(rawField);
    const parsed = parseProtobufMessage(raw, 0, maxDepth);
    return {
      index,
      byteLength: raw.length,
      hex: raw.toString('hex'),
      base64: raw.toString('base64'),
      fields: parsed.fields,
      error: parsed.error ?? null,
    };
  });
}

/**
 * Decompression-bomb guard: decompression syncs abort when the inflated output
 * would exceed this many bytes (zlib/brotli `maxOutputLength`). A 64MB ceiling
 * is generous for legitimate payloads while keeping a malicious stream from
 * exhausting the event-loop heap in one call.
 */
const DECOMPRESS_MAX_OUTPUT_LENGTH = 64 * 1024 * 1024;

function decodeDeclaredPayload(encoding: string, data: string): Buffer {
  switch (encoding) {
    case 'base64':
      return decodeBase64String(data);
    case 'base32':
      return decodeBase32String(data, 'base32');
    case 'base32hex':
      return decodeBase32String(data, 'base32hex');
    case 'base32-crockford':
      return decodeBase32String(data, 'base32-crockford');
    case 'base58':
      return decodeBase58String(data);
    case 'base85':
      return decodeAscii85String(data);
    case 'hex':
      return decodeHexString(data);
    case 'gzip':
      return gunzipSync(decodeBinaryAuto(data), {
        maxOutputLength: DECOMPRESS_MAX_OUTPUT_LENGTH,
      });
    case 'zlib':
      return inflateSync(decodeBinaryAuto(data), {
        maxOutputLength: DECOMPRESS_MAX_OUTPUT_LENGTH,
      });
    case 'deflate':
      return inflateRawSync(decodeBinaryAuto(data), {
        maxOutputLength: DECOMPRESS_MAX_OUTPUT_LENGTH,
      });
    case 'brotli':
      return brotliDecompressSync(decodeBinaryAuto(data), {
        maxOutputLength: DECOMPRESS_MAX_OUTPUT_LENGTH,
      });
    default:
      return decodeBinaryAuto(data);
  }
}

function encodePayload(
  outputEncoding: string,
  buffer: Buffer,
): {
  output: string;
  outputTransport?: string;
  outputByteLength?: number;
} {
  switch (outputEncoding) {
    case 'base64':
      return { output: buffer.toString('base64') };
    case 'base32':
      return { output: encodeBase32Bytes(buffer, 'base32') };
    case 'base32hex':
      return { output: encodeBase32Bytes(buffer, 'base32hex') };
    case 'base32-crockford':
      return { output: encodeBase32Bytes(buffer, 'base32-crockford') };
    case 'base58':
      return { output: encodeBase58Bytes(buffer) };
    case 'base85':
      return { output: encodeAscii85Bytes(buffer) };
    case 'hex':
      return { output: buffer.toString('hex') };
    case 'url':
      return { output: encodeUrlBytes(buffer) };
    case 'gzip': {
      const compressed = gzipSync(buffer);
      return {
        output: compressed.toString('base64'),
        outputTransport: 'base64',
        outputByteLength: compressed.length,
      };
    }
    case 'zlib': {
      const compressed = deflateSync(buffer);
      return {
        output: compressed.toString('base64'),
        outputTransport: 'base64',
        outputByteLength: compressed.length,
      };
    }
    case 'deflate': {
      const compressed = deflateRawSync(buffer);
      return {
        output: compressed.toString('base64'),
        outputTransport: 'base64',
        outputByteLength: compressed.length,
      };
    }
    case 'brotli': {
      const compressed = brotliCompressSync(buffer);
      return {
        output: compressed.toString('base64'),
        outputTransport: 'base64',
        outputByteLength: compressed.length,
      };
    }
    default:
      return { output: encodeUrlBytes(buffer) };
  }
}

export class EncodingToolHandlers {
  protected collector: CodeCollector;
  protected responseBodyResolver?: ResponseBodyResolver;

  constructor(collector: CodeCollector, responseBodyResolver?: ResponseBodyResolver) {
    this.collector = collector;
    this.responseBodyResolver = responseBodyResolver;
  }

  private async resolveCapturedRequestBody(requestId: string): Promise<Buffer | null> {
    if (this.responseBodyResolver) {
      try {
        const payload = await this.responseBodyResolver(requestId);
        if (payload && typeof payload.body === 'string') {
          if (payload.base64Encoded) {
            return Buffer.from(payload.body, 'base64');
          }

          const maybeBase64 = payload.body.trim();
          if (looksLikeBase64(maybeBase64)) {
            return Buffer.from(maybeBase64, 'base64');
          }

          return Buffer.from(payload.body, 'utf8');
        }
      } catch {
        // Fall through to page-captured body resolution.
      }
    }

    return resolveRequestBodyFromActivePage(this.collector, requestId);
  }

  async handleBinaryDetectFormatTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleBinaryDetectFormat(args));
  }

  async handleBinaryDecodeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleBinaryDecode(args));
  }

  async handleBinaryEncodeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleBinaryEncode(args));
  }

  async handleBinaryEntropyAnalysisTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleBinaryEntropyAnalysis(args));
  }

  async handleProtobufDecodeRawTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleProtobufDecodeRaw(args));
  }

  async handleBinaryDetectFormat(args: Record<string, unknown>) {
    try {
      const source = argEnum(args, 'source', DETECT_SOURCE_SET, 'raw');
      const data = argString(args, 'data');
      const filePath = argString(args, 'filePath');
      const requestId = argString(args, 'requestId');

      let buffer: Buffer | null = null;
      let requestBodyUsed = false;

      if (source === 'raw' && requestId) {
        buffer = await this.resolveCapturedRequestBody(requestId);
        requestBodyUsed = buffer !== null;
      }

      if (!buffer) {
        if (source !== 'file' && !data)
          throw new Error(
            'data is required for non-file source when requestId payload is unavailable',
          );
        buffer = await resolveBufferBySource({
          source,
          data,
          filePath,
          maxBytes: source === 'file' ? 512 : undefined,
        });
      }

      const entropy = calculateShannonEntropy(buffer);
      return ok({
        success: true,
        source,
        requestId: requestId ?? null,
        requestBodyUsed,
        byteLength: buffer.length,
        previewHex: previewHex(buffer, 64),
        magicFormats: detectMagicFormats(buffer),
        structuredFormats: detectStructuredFormats(buffer),
        encodingSignals: detectEncodingSignals(source, data, buffer),
        entropy,
        assessment: assessEntropy(entropy, buffer),
        topBytes: calculateByteFrequency(buffer).slice(0, 8),
      });
    } catch (error) {
      return fail('binary_detect_format', error);
    }
  }

  async handleBinaryDecode(args: Record<string, unknown>) {
    try {
      const data = argString(args, 'data', '');
      const encoding = argEnum(args, 'encoding', DECODE_ENCODING_SET);
      const outputFormat = argEnum(args, 'outputFormat', OUTPUT_FORMAT_SET, 'hex');

      if (!data) throw new Error('data is required');
      if (!encoding) throw new Error('encoding is required');

      if (encoding === 'url') {
        const decoded = decodeUrl(data);
        if (outputFormat === 'hex') {
          const raw = Buffer.from(decoded, 'utf8');
          return ok({
            success: true,
            encoding,
            outputFormat,
            byteLength: raw.length,
            result: raw.toString('hex'),
            hexDump: hexDump(raw),
          });
        }
        if (outputFormat === 'utf8')
          return ok({ success: true, encoding, outputFormat, result: decoded });
        const parsed = tryParseJson(decoded);
        return ok({ success: true, encoding, outputFormat, result: parsed ?? { text: decoded } });
      }

      const rawBuffer = decodeDeclaredPayload(encoding, data);

      if (encoding === 'protobuf') {
        const parsed = parseProtobufMessage(rawBuffer, 0, 5);
        return renderDecodedOutput({
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
        return renderDecodedOutput({
          encoding,
          outputFormat,
          buffer: rawBuffer,
          jsonValue: decodeMsgPack(rawBuffer),
        });
      }

      return renderDecodedOutput({ encoding, outputFormat, buffer: rawBuffer });
    } catch (error) {
      return fail('binary_decode', error);
    }
  }

  async handleBinaryEncode(args: Record<string, unknown>) {
    try {
      const data = argString(args, 'data', '');
      const inputFormat = argEnum(args, 'inputFormat', INPUT_FORMAT_SET, 'utf8');
      const outputEncoding = argEnum(args, 'outputEncoding', OUTPUT_ENCODING_SET, 'base64');

      if (!data) throw new Error('data is required');

      let buffer: Buffer;
      if (inputFormat === 'utf8') buffer = Buffer.from(data, 'utf8');
      else if (inputFormat === 'hex') buffer = decodeHexString(data);
      else {
        const parsed = JSON.parse(data) as unknown;
        buffer = Buffer.from(JSON.stringify(parsed), 'utf8');
      }

      const encoded = encodePayload(outputEncoding, buffer);

      return ok({
        success: true,
        inputFormat,
        outputEncoding,
        byteLength: buffer.length,
        ...encoded,
      });
    } catch (error) {
      return fail('binary_encode', error);
    }
  }

  async handleBinaryEntropyAnalysis(args: Record<string, unknown>) {
    try {
      const source = argEnum(args, 'source', ENTROPY_SOURCE_SET, 'raw');
      const data = argString(args, 'data');
      const filePath = argString(args, 'filePath');

      if (source !== 'file' && !data) throw new Error('data is required for non-file source');

      const blockSizeRaw = argNumber(args, 'blockSize', 256);
      const blockSize = Math.max(16, Math.min(8192, Math.trunc(blockSizeRaw || 256)));

      const buffer = await resolveBufferBySource({ source, data, filePath });
      const overallEntropy = calculateShannonEntropy(buffer);

      return ok({
        success: true,
        source,
        byteLength: buffer.length,
        blockSize,
        overallEntropy,
        chiSquare: calculateChiSquare(buffer),
        serialCorrelation: calculateSerialCorrelation(buffer),
        blockEntropies: calculateBlockEntropies(buffer, blockSize),
        byteFrequency: calculateByteFrequency(buffer).slice(0, 20),
        assessment: assessEntropy(overallEntropy, buffer),
      });
    } catch (error) {
      return fail('binary_entropy_analysis', error);
    }
  }

  async handleProtobufDecodeRaw(args: Record<string, unknown>) {
    try {
      const data = argString(args, 'data', '');
      if (!data) throw new Error('data is required');

      const maxDepthRaw = argNumber(args, 'maxDepth', 5);
      const maxDepth = Math.max(1, Math.min(20, Math.trunc(maxDepthRaw || 5)));
      const buffer = decodeBase64String(data);

      // Schema mode: decode with a .proto schema (field numbers -> names/types)
      // via protobufjs. Lazily imported to keep the raw-walk path dependency-free.
      const schemaText = argString(args, 'schemaText', '');
      const schemaPath = argString(args, 'schemaPath', '');
      const messageName = argString(args, 'messageName', '');
      if ((schemaText || schemaPath) && messageName) {
        const protobuf = (await import('protobufjs')).default;
        const root =
          schemaPath && !schemaText
            ? await protobuf.load(schemaPath)
            : (() => {
                const parsed = protobuf.parse(schemaText);
                for (const importedFile of [
                  ...(parsed.imports ?? []),
                  ...(parsed.weakImports ?? []),
                ]) {
                  const commonDefinition = protobuf.common.get(importedFile);
                  if (commonDefinition) {
                    protobuf.Root.fromJSON(commonDefinition, parsed.root);
                  }
                }
                return parsed.root;
              })();
        root.resolveAll();
        const MessageType = root.lookupType(messageName);
        const reader = protobuf.Reader.create(buffer);
        reader.discardUnknown = false;
        const message = MessageType.decode(reader);
        const decoded = MessageType.toObject(message, {
          longs: String,
          bytes: String,
          enums: String,
          defaults: true,
          json: true,
        });
        return ok({
          success: true,
          schema: true,
          messageName,
          byteLength: buffer.length,
          decoded,
          unknownFields: summarizeUnknownProtobufFields(message, maxDepth),
          fields: null,
          error: null,
        });
      }

      const parsed = parseProtobufMessage(buffer, 0, maxDepth);

      return ok({
        success: parsed.error === undefined,
        schema: false,
        byteLength: buffer.length,
        maxDepth,
        parsedBytes: parsed.bytesConsumed,
        fields: parsed.fields,
        error: parsed.error ?? null,
      });
    } catch (error) {
      return fail('protobuf_decode_raw', error);
    }
  }
}
