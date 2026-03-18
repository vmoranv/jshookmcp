import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EncodingToolHandlers } from '@server/domains/encoding/handlers';

function parseJson(response: any) {
  return JSON.parse(response.content[0].text);
}

describe('EncodingToolHandlers (handlers.impl.core.runtime)', () => {
  const collector = {
    getActivePage: vi.fn(),
  } as any;

  let handlers: EncodingToolHandlers;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new EncodingToolHandlers(collector);
  });

  /* ---------- handleBinaryDetectFormat ---------- */

  describe('handleBinaryDetectFormat', () => {
    it('returns error for invalid source', async () => {
      const body = parseJson(
        await handlers.handleBinaryDetectFormat({ source: 'invalid', data: 'aa' })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid source');
    });

    it('returns error when data is missing for non-file source', async () => {
      const body = parseJson(await handlers.handleBinaryDetectFormat({ source: 'raw' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('data is required');
    });

    it('detects base64 source and returns analysis', async () => {
      const data = Buffer.from('Hello, World!').toString('base64');
      const body = parseJson(await handlers.handleBinaryDetectFormat({ source: 'base64', data }));
      expect(body.success).toBe(true);
      expect(body.source).toBe('base64');
      expect(body.byteLength).toBeGreaterThan(0);
      expect(body.encodingSignals).toContain('base64');
      expect(typeof body.entropy).toBe('number');
      expect(typeof body.assessment).toBe('string');
      expect(body.previewHex).toBeTruthy();
    });

    it('detects hex source and returns analysis', async () => {
      const data = '48656c6c6f';
      const body = parseJson(await handlers.handleBinaryDetectFormat({ source: 'hex', data }));
      expect(body.success).toBe(true);
      expect(body.source).toBe('hex');
      expect(body.byteLength).toBe(5);
      expect(body.encodingSignals).toContain('hex');
    });

    it('defaults source to raw', async () => {
      const body = parseJson(await handlers.handleBinaryDetectFormat({ data: '48656c6c6f' }));
      expect(body.success).toBe(true);
      expect(body.source).toBe('raw');
    });

    it('detects magic formats for PNG header', async () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const data = pngHeader.toString('base64');
      const body = parseJson(await handlers.handleBinaryDetectFormat({ source: 'base64', data }));
      expect(body.success).toBe(true);
      expect(body.magicFormats).toContain('png');
    });

    it('returns topBytes in frequency analysis', async () => {
      const data = Buffer.from('aaabbc').toString('base64');
      const body = parseJson(await handlers.handleBinaryDetectFormat({ source: 'base64', data }));
      expect(body.success).toBe(true);
      expect(Array.isArray(body.topBytes)).toBe(true);
    });

    it('reports requestBodyUsed as false when no requestId is provided', async () => {
      const body = parseJson(
        await handlers.handleBinaryDetectFormat({
          source: 'base64',
          data: Buffer.from('test').toString('base64'),
        })
      );
      expect(body.requestBodyUsed).toBe(false);
      expect(body.requestId).toBeNull();
    });
  });

  /* ---------- handleBinaryDecode ---------- */

  describe('handleBinaryDecode', () => {
    it('returns error when data is missing', async () => {
      const body = parseJson(await handlers.handleBinaryDecode({ encoding: 'base64' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('data is required');
    });

    it('returns error for invalid encoding', async () => {
      const body = parseJson(
        await handlers.handleBinaryDecode({ data: 'aaa', encoding: 'invalid' })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid encoding');
    });

    it('returns error for invalid outputFormat', async () => {
      const body = parseJson(
        await handlers.handleBinaryDecode({
          data: 'aGVsbG8=',
          encoding: 'base64',
          outputFormat: 'invalid',
        })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid outputFormat');
    });

    it('decodes base64 to hex output', async () => {
      const data = Buffer.from('hello').toString('base64');
      const body = parseJson(
        await handlers.handleBinaryDecode({
          data,
          encoding: 'base64',
          outputFormat: 'hex',
        })
      );
      expect(body.success).toBe(true);
      expect(body.encoding).toBe('base64');
      expect(body.outputFormat).toBe('hex');
      expect(body.result).toBe(Buffer.from('hello').toString('hex'));
    });

    it('decodes base64 to utf8 output', async () => {
      const data = Buffer.from('hello').toString('base64');
      const body = parseJson(
        await handlers.handleBinaryDecode({
          data,
          encoding: 'base64',
          outputFormat: 'utf8',
        })
      );
      expect(body.success).toBe(true);
      expect(body.outputFormat).toBe('utf8');
    });

    it('decodes hex input to hex output', async () => {
      const body = parseJson(
        await handlers.handleBinaryDecode({
          data: '48656c6c6f',
          encoding: 'hex',
          outputFormat: 'hex',
        })
      );
      expect(body.success).toBe(true);
      expect(body.encoding).toBe('hex');
    });

    it('decodes url encoding to utf8', async () => {
      const body = parseJson(
        await handlers.handleBinaryDecode({
          data: 'hello%20world',
          encoding: 'url',
          outputFormat: 'utf8',
        })
      );
      expect(body.success).toBe(true);
      expect(body.encoding).toBe('url');
      expect(body.outputFormat).toBe('utf8');
      expect(body.result).toBe('hello world');
    });

    it('decodes url encoding to hex', async () => {
      const body = parseJson(
        await handlers.handleBinaryDecode({
          data: 'hello',
          encoding: 'url',
          outputFormat: 'hex',
        })
      );
      expect(body.success).toBe(true);
      expect(body.encoding).toBe('url');
      expect(body.outputFormat).toBe('hex');
      expect(body.byteLength).toBeGreaterThan(0);
      expect(typeof body.hexDump).toBe('string');
    });

    it('decodes url encoding to json for JSON content', async () => {
      const body = parseJson(
        await handlers.handleBinaryDecode({
          data: '%7B%22ok%22%3Atrue%7D',
          encoding: 'url',
          outputFormat: 'json',
        })
      );
      expect(body.success).toBe(true);
      expect(body.result).toEqual({ ok: true });
    });

    it('decodes url encoding to json with text fallback for non-JSON', async () => {
      const body = parseJson(
        await handlers.handleBinaryDecode({
          data: 'plain+text',
          encoding: 'url',
          outputFormat: 'json',
        })
      );
      expect(body.success).toBe(true);
      expect(body.result).toEqual({ text: 'plain text' });
    });

    it('defaults outputFormat to hex', async () => {
      const body = parseJson(
        await handlers.handleBinaryDecode({
          data: Buffer.from('hi').toString('base64'),
          encoding: 'base64',
        })
      );
      expect(body.success).toBe(true);
      expect(body.outputFormat).toBe('hex');
    });

    it('decodes protobuf data', async () => {
      // field 1, varint 150 = 0x08 0x96 0x01
      const proto = Buffer.from([0x08, 0x96, 0x01]);
      const data = proto.toString('base64');
      const body = parseJson(
        await handlers.handleBinaryDecode({
          data,
          encoding: 'protobuf',
          outputFormat: 'json',
        })
      );
      expect(body.success).toBe(true);
      expect(body.encoding).toBe('protobuf');
    });
  });

  /* ---------- handleBinaryEncode ---------- */

  describe('handleBinaryEncode', () => {
    it('returns error when data is missing', async () => {
      const body = parseJson(
        await handlers.handleBinaryEncode({ inputFormat: 'utf8', outputEncoding: 'base64' })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('data is required');
    });

    it('returns error for invalid inputFormat', async () => {
      const body = parseJson(
        await handlers.handleBinaryEncode({
          data: 'hello',
          inputFormat: 'invalid',
          outputEncoding: 'base64',
        })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid inputFormat');
    });

    it('returns error for invalid outputEncoding', async () => {
      const body = parseJson(
        await handlers.handleBinaryEncode({
          data: 'hello',
          inputFormat: 'utf8',
          outputEncoding: 'invalid',
        })
      );
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid outputEncoding');
    });

    it('encodes utf8 to base64', async () => {
      const body = parseJson(
        await handlers.handleBinaryEncode({
          data: 'hello',
          inputFormat: 'utf8',
          outputEncoding: 'base64',
        })
      );
      expect(body.success).toBe(true);
      expect(body.inputFormat).toBe('utf8');
      expect(body.outputEncoding).toBe('base64');
      expect(body.output).toBe(Buffer.from('hello').toString('base64'));
      expect(body.byteLength).toBe(5);
    });

    it('encodes utf8 to hex', async () => {
      const body = parseJson(
        await handlers.handleBinaryEncode({
          data: 'hello',
          inputFormat: 'utf8',
          outputEncoding: 'hex',
        })
      );
      expect(body.success).toBe(true);
      expect(body.output).toBe(Buffer.from('hello').toString('hex'));
    });

    it('encodes utf8 to url', async () => {
      const body = parseJson(
        await handlers.handleBinaryEncode({
          data: 'hello world',
          inputFormat: 'utf8',
          outputEncoding: 'url',
        })
      );
      expect(body.success).toBe(true);
      expect(body.output).toContain('hello');
      expect(body.output).toContain('%20');
    });

    it('encodes hex input to base64', async () => {
      const hexData = Buffer.from('hello').toString('hex');
      const body = parseJson(
        await handlers.handleBinaryEncode({
          data: hexData,
          inputFormat: 'hex',
          outputEncoding: 'base64',
        })
      );
      expect(body.success).toBe(true);
      expect(body.output).toBe(Buffer.from('hello').toString('base64'));
    });

    it('encodes json input to base64', async () => {
      const body = parseJson(
        await handlers.handleBinaryEncode({
          data: '{"key":"value"}',
          inputFormat: 'json',
          outputEncoding: 'base64',
        })
      );
      expect(body.success).toBe(true);
      expect(body.inputFormat).toBe('json');
      const decoded = Buffer.from(body.output, 'base64').toString('utf8');
      expect(JSON.parse(decoded)).toEqual({ key: 'value' });
    });

    it('returns error for invalid JSON in json inputFormat', async () => {
      const body = parseJson(
        await handlers.handleBinaryEncode({
          data: 'not-valid-json{',
          inputFormat: 'json',
          outputEncoding: 'base64',
        })
      );
      expect(body.success).toBe(false);
      expect(body.tool).toBe('binary_encode');
    });
  });

  /* ---------- handleBinaryEntropyAnalysis ---------- */

  describe('handleBinaryEntropyAnalysis', () => {
    it('returns error for invalid source', async () => {
      const body = parseJson(await handlers.handleBinaryEntropyAnalysis({ source: 'invalid' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid source');
    });

    it('returns error when data is missing for non-file source', async () => {
      const body = parseJson(await handlers.handleBinaryEntropyAnalysis({ source: 'raw' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('data is required');
    });

    it('defaults source to raw', async () => {
      const body = parseJson(
        await handlers.handleBinaryEntropyAnalysis({ data: 'some data here' })
      );
      expect(body.success).toBe(true);
      expect(body.source).toBe('raw');
    });

    it('analyzes entropy for base64 data', async () => {
      const data = Buffer.from('Hello, World! This is a test string.').toString('base64');
      const body = parseJson(
        await handlers.handleBinaryEntropyAnalysis({ source: 'base64', data })
      );
      expect(body.success).toBe(true);
      expect(body.source).toBe('base64');
      expect(typeof body.overallEntropy).toBe('number');
      expect(body.overallEntropy).toBeGreaterThanOrEqual(0);
      expect(body.overallEntropy).toBeLessThanOrEqual(8);
      expect(typeof body.assessment).toBe('string');
      expect(Array.isArray(body.blockEntropies)).toBe(true);
      expect(Array.isArray(body.byteFrequency)).toBe(true);
      expect(body.byteLength).toBeGreaterThan(0);
    });

    it('analyzes entropy for hex data', async () => {
      const data = '48656c6c6f20576f726c64';
      const body = parseJson(await handlers.handleBinaryEntropyAnalysis({ source: 'hex', data }));
      expect(body.success).toBe(true);
      expect(body.source).toBe('hex');
    });

    it('uses custom blockSize', async () => {
      const data = Buffer.from('a'.repeat(100)).toString('base64');
      const body = parseJson(
        await handlers.handleBinaryEntropyAnalysis({
          source: 'base64',
          data,
          blockSize: 32,
        })
      );
      expect(body.success).toBe(true);
      expect(body.blockSize).toBe(32);
    });

    it('clamps blockSize to minimum 16', async () => {
      const data = Buffer.from('test data').toString('base64');
      const body = parseJson(
        await handlers.handleBinaryEntropyAnalysis({
          source: 'base64',
          data,
          blockSize: 1,
        })
      );
      expect(body.success).toBe(true);
      expect(body.blockSize).toBe(16);
    });

    it('clamps blockSize to maximum 8192', async () => {
      const data = Buffer.from('test data').toString('base64');
      const body = parseJson(
        await handlers.handleBinaryEntropyAnalysis({
          source: 'base64',
          data,
          blockSize: 99999,
        })
      );
      expect(body.success).toBe(true);
      expect(body.blockSize).toBe(8192);
    });

    it('defaults blockSize to 256', async () => {
      const data = Buffer.from('test data').toString('base64');
      const body = parseJson(
        await handlers.handleBinaryEntropyAnalysis({ source: 'base64', data })
      );
      expect(body.success).toBe(true);
      expect(body.blockSize).toBe(256);
    });

    it('returns byteFrequency limited to top 20', async () => {
      // Create data with many distinct byte values
      const bytes = Array.from({ length: 256 }, (_, i) => i);
      const data = Buffer.from(bytes).toString('base64');
      const body = parseJson(
        await handlers.handleBinaryEntropyAnalysis({ source: 'base64', data })
      );
      expect(body.success).toBe(true);
      expect(body.byteFrequency.length).toBeLessThanOrEqual(20);
    });
  });

  /* ---------- handleProtobufDecodeRaw ---------- */

  describe('handleProtobufDecodeRaw', () => {
    it('returns error when data is missing', async () => {
      const body = parseJson(await handlers.handleProtobufDecodeRaw({}));
      expect(body.success).toBe(false);
      expect(body.tool).toBe('protobuf_decode_raw');
      expect(body.error).toContain('data is required');
    });

    it('returns error when data is empty string', async () => {
      const body = parseJson(await handlers.handleProtobufDecodeRaw({ data: '' }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('data is required');
    });

    it('decodes valid protobuf data', async () => {
      // field 1, varint 150 = 0x08 0x96 0x01
      const proto = Buffer.from([0x08, 0x96, 0x01]);
      const data = proto.toString('base64');
      const body = parseJson(await handlers.handleProtobufDecodeRaw({ data }));
      expect(body.success).toBe(true);
      expect(body.byteLength).toBe(3);
      expect(body.parsedBytes).toBe(3);
      expect(body.fields).toHaveLength(1);
      expect(body.fields[0].fieldNumber).toBe(1);
      expect(body.fields[0].wireType).toBe(0);
      expect(body.fields[0].value).toBe(150);
      expect(body.error).toBeNull();
    });

    it('defaults maxDepth to 5', async () => {
      const proto = Buffer.from([0x08, 0x01]);
      const data = proto.toString('base64');
      const body = parseJson(await handlers.handleProtobufDecodeRaw({ data }));
      expect(body.maxDepth).toBe(5);
    });

    it('respects custom maxDepth', async () => {
      const proto = Buffer.from([0x08, 0x01]);
      const data = proto.toString('base64');
      const body = parseJson(await handlers.handleProtobufDecodeRaw({ data, maxDepth: 10 }));
      expect(body.maxDepth).toBe(10);
    });

    it('falls back to default maxDepth of 5 when maxDepth is 0 (falsy)', async () => {
      const proto = Buffer.from([0x08, 0x01]);
      const data = proto.toString('base64');
      const body = parseJson(await handlers.handleProtobufDecodeRaw({ data, maxDepth: 0 }));
      // 0 is falsy so `maxDepthRaw || 5` resolves to 5, then clamped to [1, 20]
      expect(body.maxDepth).toBe(5);
    });

    it('clamps negative maxDepth to minimum 1', async () => {
      const proto = Buffer.from([0x08, 0x01]);
      const data = proto.toString('base64');
      const body = parseJson(await handlers.handleProtobufDecodeRaw({ data, maxDepth: -5 }));
      expect(body.maxDepth).toBe(1);
    });

    it('clamps maxDepth to maximum 20', async () => {
      const proto = Buffer.from([0x08, 0x01]);
      const data = proto.toString('base64');
      const body = parseJson(await handlers.handleProtobufDecodeRaw({ data, maxDepth: 100 }));
      expect(body.maxDepth).toBe(20);
    });

    it('decodes multiple fields', async () => {
      // field 1 varint 1, field 2 varint 2
      const proto = Buffer.from([0x08, 0x01, 0x10, 0x02]);
      const data = proto.toString('base64');
      const body = parseJson(await handlers.handleProtobufDecodeRaw({ data }));
      expect(body.success).toBe(true);
      expect(body.fields).toHaveLength(2);
      expect(body.fields[0].value).toBe(1);
      expect(body.fields[1].value).toBe(2);
    });

    it('reports error for malformed protobuf while returning partial fields', async () => {
      // valid field then unsupported wire type
      const proto = Buffer.from([0x08, 0x01, 0x0b]);
      const data = proto.toString('base64');
      const body = parseJson(await handlers.handleProtobufDecodeRaw({ data }));
      expect(body.success).toBe(false);
      expect(body.fields).toHaveLength(1);
      expect(body.error).toBeTruthy();
    });

    it('returns error for empty base64 data (resolves to empty string)', async () => {
      // Buffer.alloc(0).toString('base64') produces '', which fails the !data check
      const data = Buffer.alloc(0).toString('base64');
      const body = parseJson(await handlers.handleProtobufDecodeRaw({ data }));
      expect(body.success).toBe(false);
      expect(body.error).toContain('data is required');
    });
  });
});
