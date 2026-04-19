/**
 * Encoding domain — composition facade.
 *
 * All utility functions extracted to ./handlers/shared.ts.
 * Handler methods call those functions directly instead of inheriting from a base class.
 */

import type { CodeCollector } from '@server/domains/shared/modules';
import { parseProtobufMessage } from '@server/domains/encoding/encoding-protobuf';
import { decodeMsgPack } from '@server/domains/encoding/encoding-msgpack';
import { argString, argNumber, argEnum } from '@server/domains/shared/parse-args';
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
  decodeUrl,
  encodeUrlBytes,
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
export {
  MAGIC_SIGNATURES,
  DETECT_SOURCE_SET,
  ENTROPY_SOURCE_SET,
  DECODE_ENCODING_SET,
  OUTPUT_FORMAT_SET,
  INPUT_FORMAT_SET,
  OUTPUT_ENCODING_SET,
} from './handlers/shared';

export class EncodingToolHandlers {
  protected collector: CodeCollector;

  constructor(collector: CodeCollector) {
    this.collector = collector;
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
        buffer = await resolveRequestBodyFromActivePage(this.collector, requestId);
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

      const rawBuffer =
        encoding === 'base64'
          ? decodeBase64String(data)
          : encoding === 'hex'
            ? decodeHexString(data)
            : decodeBinaryAuto(data);

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

      const output =
        outputEncoding === 'base64'
          ? buffer.toString('base64')
          : outputEncoding === 'hex'
            ? buffer.toString('hex')
            : encodeUrlBytes(buffer);

      return ok({ success: true, inputFormat, outputEncoding, byteLength: buffer.length, output });
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
      const parsed = parseProtobufMessage(buffer, 0, maxDepth);

      return ok({
        success: parsed.error === undefined,
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
