import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EncodingHandlersBase } from '@server/domains/encoding/handlers.base';

class TestEncodingHandlersBase extends EncodingHandlersBase {
  testPreviewHex(buffer: Buffer, maxBytes: number): string {
    return this.previewHex(buffer, maxBytes);
  }

  testHexDump(buffer: Buffer, bytesPerRow?: number): string {
    return this.hexDump(buffer, bytesPerRow);
  }

  testDecodeHexString(value: string): Buffer {
    return this.decodeHexString(value);
  }

  testDecodeBase64String(value: string): Buffer {
    return this.decodeBase64String(value);
  }

  testDecodeBinaryAuto(value: string): Buffer {
    return this.decodeBinaryAuto(value);
  }

  testLooksLikeBase64(value: string): boolean {
    return this.looksLikeBase64(value);
  }

  testRenderDecodedOutput(params: {
    encoding: any;
    outputFormat: any;
    buffer: Buffer;
    jsonValue?: unknown;
  }) {
    return this.renderDecodedOutput(params);
  }

  testResolveBufferBySource(options: {
    source: any;
    data?: string;
    filePath?: string;
    maxBytes?: number;
  }) {
    return this.resolveBufferBySource(options);
  }

  testResolveRequestBodyFromActivePage(requestId: string) {
    return this.resolveRequestBodyFromActivePage(requestId);
  }

  testDetectMagicFormats(buffer: Buffer): string[] {
    return this.detectMagicFormats(buffer);
  }

  testDetectStructuredFormats(buffer: Buffer): string[] {
    return this.detectStructuredFormats(buffer);
  }

  testDetectEncodingSignals(source: any, data: string | undefined, buffer: Buffer): string[] {
    return this.detectEncodingSignals(source, data, buffer);
  }

  testCalculateShannonEntropy(buffer: Buffer): number {
    return this.calculateShannonEntropy(buffer);
  }

  testCalculateByteFrequency(buffer: Buffer) {
    return this.calculateByteFrequency(buffer);
  }

  testCalculateBlockEntropies(buffer: Buffer, blockSize: number) {
    return this.calculateBlockEntropies(buffer, blockSize);
  }

  testAssessEntropy(entropy: number, buffer: Buffer) {
    return this.assessEntropy(entropy, buffer);
  }

  testPrintableRatio(buffer: Buffer) {
    return this.printableRatio(buffer);
  }
}

describe('EncodingHandlersBase', () => {
  const collector = {
    getActivePage: vi.fn(),
  } as any;

  let handlers: TestEncodingHandlersBase;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new TestEncodingHandlersBase(collector);
  });

  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('decodes hex, base64, and auto-detected binary inputs', () => {
    expect(handlers.testLooksLikeBase64('SGVsbG8=')).toBe(true);
    expect(handlers.testLooksLikeBase64('plain text')).toBe(false);

    expect(handlers.testDecodeHexString('').length).toBe(0);
    expect(handlers.testDecodeBase64String('').length).toBe(0);
    expect(handlers.testDecodeHexString('0x68 65:6c-6c,6f').toString('utf8')).toBe('hello');
    expect(handlers.testDecodeBase64String('SGVsbG8=').toString('utf8')).toBe('Hello');
    expect(handlers.testDecodeBinaryAuto('4869').toString('utf8')).toBe('Hi');
    expect(handlers.testDecodeBinaryAuto('SGk=').toString('utf8')).toBe('Hi');
    expect(handlers.testDecodeBinaryAuto('plain').toString('utf8')).toBe('plain');
    expect(() => handlers.testDecodeHexString('abc')).toThrow('Invalid hex string');
    expect(() => handlers.testDecodeBase64String('abc')).toThrow('Invalid base64 string');
  });

  it('resolves buffers from file, base64, hex, and raw sources', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'jshookmcp-encoding-'));
    const filePath = join(tempDir, 'sample.bin');
    await writeFile(filePath, Buffer.from('file-data', 'utf8'));

    try {
      const fileBuffer = await handlers.testResolveBufferBySource({
        source: 'file',
        filePath,
        maxBytes: 4,
      });
      expect(fileBuffer.toString('utf8')).toBe('file');

      expect(
        (await handlers.testResolveBufferBySource({ source: 'base64', data: 'SGVsbG8=' })).toString(
          'utf8',
        ),
      ).toBe('Hello');
      expect(
        (await handlers.testResolveBufferBySource({ source: 'hex', data: '4869' })).toString(
          'utf8',
        ),
      ).toBe('Hi');
      expect(
        (await handlers.testResolveBufferBySource({ source: 'raw', data: 'plain' })).toString(
          'utf8',
        ),
      ).toBe('plain');
      await expect(handlers.testResolveBufferBySource({ source: 'file' as any })).rejects.toThrow(
        'filePath is required',
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reads captured request bodies from memory and localStorage fallbacks', async () => {
    const evaluate = vi.fn(async (callback: (requestId: string) => unknown, requestId: string) =>
      callback(requestId),
    );

    collector.getActivePage.mockResolvedValueOnce({
      evaluate,
    });

    (globalThis as any).window = {
      __capturedAPIs: [
        {
          requestId: 'req-1',
          responseBody: 'SGVsbG8=',
          base64Encoded: true,
        },
      ],
      localStorage: {
        getItem: vi.fn(() => null),
      },
    };

    const first = await handlers.testResolveRequestBodyFromActivePage('req-1');
    expect(first?.toString('utf8')).toBe('Hello');

    collector.getActivePage.mockResolvedValueOnce({
      evaluate: vi.fn(async (callback: (requestId: string) => unknown, requestId: string) =>
        callback(requestId),
      ),
    });

    (globalThis as any).window = {
      localStorage: {
        getItem: vi.fn((key: string) =>
          key === '__capturedAPIs'
            ? JSON.stringify([
                {
                  requestId: 'req-2',
                  body: 'plain text body',
                  base64Encoded: false,
                },
              ])
            : null,
        ),
      },
    };

    const second = await handlers.testResolveRequestBodyFromActivePage('req-2');
    expect(second?.toString('utf8')).toBe('plain text body');
  });

  it('classifies formats, entropy bands, and decoded output shapes', () => {
    expect(handlers.testDetectMagicFormats(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toContain('png');
    expect(handlers.testDetectStructuredFormats(Buffer.from([0x08]))).toEqual(['protobuf']);
    expect(handlers.testDetectStructuredFormats(Buffer.from([0x90]))).toEqual([
      'messagepack',
      'cbor',
    ]);
    expect(
      handlers.testDetectEncodingSignals('base64', 'SGVsbG8=', Buffer.from('Hello', 'utf8')),
    ).toContain('base64');
    expect(handlers.testDetectEncodingSignals('hex', '4869', Buffer.from('Hi', 'utf8'))).toContain(
      'hex',
    );
    expect(
      handlers.testDetectEncodingSignals('raw', 'a+b%20c', Buffer.from('a b c', 'utf8')),
    ).toContain('url-encoded');
    expect(
      handlers.testDetectEncodingSignals('raw', undefined, Buffer.from([0xef, 0xbb, 0xbf, 0x41])),
    ).toContain('utf8-bom');

    expect(handlers.testPreviewHex(Buffer.from([0, 1, 2, 3]), 2)).toBe('00 01');
    expect(handlers.testHexDump(Buffer.from('AB', 'utf8'), 1)).toContain('00000000');

    expect(handlers.testCalculateShannonEntropy(Buffer.from('AAAA', 'utf8'))).toBe(0);
    expect(handlers.testAssessEntropy(3.0, Buffer.from('hello', 'utf8'))).toBe('plaintext');
    expect(handlers.testAssessEntropy(5.0, Buffer.from([0, 1, 2]))).toBe('encoded');
    expect(handlers.testAssessEntropy(6.5, Buffer.from([0, 1, 2]))).toBe('compressed');
    expect(handlers.testAssessEntropy(7.5, Buffer.from([0, 1, 2]))).toBe('encrypted');
    expect(handlers.testAssessEntropy(7.9, Buffer.from([0, 1, 2]))).toBe('random');

    expect(handlers.testCalculateByteFrequency(Buffer.from('aab', 'utf8'))).toEqual([
      { byte: '0x61', count: 2, ratio: 0.666667 },
      { byte: '0x62', count: 1, ratio: 0.333333 },
    ]);
    expect(handlers.testCalculateBlockEntropies(Buffer.from('abcdef', 'utf8'), 2)).toEqual([
      { index: 0, start: 0, end: 2, entropy: expect.any(Number) },
      { index: 1, start: 2, end: 4, entropy: expect.any(Number) },
      { index: 2, start: 4, end: 6, entropy: expect.any(Number) },
    ]);

    const hexResult = handlers.testRenderDecodedOutput({
      encoding: 'base64',
      outputFormat: 'hex',
      buffer: Buffer.from('Hi', 'utf8'),
    });
    const utf8Result = handlers.testRenderDecodedOutput({
      encoding: 'base64',
      outputFormat: 'utf8',
      buffer: Buffer.from('Hi', 'utf8'),
    });
    const jsonResult = handlers.testRenderDecodedOutput({
      encoding: 'base64',
      outputFormat: 'json',
      buffer: Buffer.from('{"ok":true}', 'utf8'),
    });
    const jsonOverrideResult = handlers.testRenderDecodedOutput({
      encoding: 'base64',
      outputFormat: 'json',
      buffer: Buffer.from('ignored', 'utf8'),
      jsonValue: { override: true },
    });

    const hexBody = JSON.parse(hexResult.content[0]!.text);
    const utf8Body = JSON.parse(utf8Result.content[0]!.text);
    const jsonBody = JSON.parse(jsonResult.content[0]!.text);
    const jsonOverrideBody = JSON.parse(jsonOverrideResult.content[0]!.text);

    expect(hexBody.result).toBe(Buffer.from('Hi', 'utf8').toString('hex'));
    expect(utf8Body.result).toBe('Hi');
    expect(jsonBody.result.parsedJson).toEqual({ ok: true });
    expect(jsonOverrideBody.result).toEqual({ override: true });
    expect(handlers.testPrintableRatio(Buffer.from([0x20, 0x21, 0x0a, 0x00]))).toBe(0.75);
  });
});
