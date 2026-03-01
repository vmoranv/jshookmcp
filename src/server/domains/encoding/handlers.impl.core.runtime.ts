import { EncodingToolHandlersParsers } from './handlers.impl.core.runtime.parsers.js';
import {
  DECODE_ENCODING_SET,
  DETECT_SOURCE_SET,
  ENTROPY_SOURCE_SET,
  INPUT_FORMAT_SET,
  OUTPUT_ENCODING_SET,
  OUTPUT_FORMAT_SET,
  type DecodeEncoding,
  type DetectSource,
  type EntropySource,
  type InputFormat,
  type OutputEncoding,
  type OutputFormat,
} from './handlers.impl.core.runtime.shared.js';

export class EncodingToolHandlers extends EncodingToolHandlersParsers {
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
}