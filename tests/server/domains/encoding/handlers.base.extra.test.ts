import { describe, expect, it, vi } from 'vitest';
import { EncodingHandlersBase } from '@server/domains/encoding/handlers.base';

class ExtraEncodingHandlersBase extends EncodingHandlersBase {
  testIsMostlyPrintableText(text: string) {
    return this.isMostlyPrintableText(text);
  }

  testDecodeUrl(value: string) {
    return this.decodeUrl(value);
  }

  testEncodeUrlBytes(buffer: Buffer) {
    return this.encodeUrlBytes(buffer);
  }

  testToSafeUtf8(buffer: Buffer) {
    return this.toSafeUtf8(buffer);
  }

  testTryParseJson(text: string) {
    return this.tryParseJson(text);
  }

  testFail(tool: string, error: unknown) {
    return this.fail(tool, error);
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

  testDetectMagicFormats(buffer: Buffer) {
    return this.detectMagicFormats(buffer);
  }

  testDetectStructuredFormats(buffer: Buffer) {
    return this.detectStructuredFormats(buffer);
  }

  testDetectEncodingSignals(source: any, data: string | undefined, buffer: Buffer) {
    return this.detectEncodingSignals(source, data, buffer);
  }

  testCalculateByteFrequency(buffer: Buffer) {
    return this.calculateByteFrequency(buffer);
  }

  testCalculateBlockEntropies(buffer: Buffer, blockSize: number) {
    return this.calculateBlockEntropies(buffer, blockSize);
  }
}

describe('EncodingHandlersBase extra coverage', () => {
  const collector = {
    getActivePage: vi.fn(),
  } as any;

  it('covers printable heuristics, url helpers, and failure payloads', () => {
    const handlers = new ExtraEncodingHandlersBase(collector);

    expect(handlers.testIsMostlyPrintableText('hello\tworld\n')).toBe(true);
    expect(handlers.testIsMostlyPrintableText('abc\u0001\u0002\u0003')).toBe(false);
    expect(handlers.testDecodeUrl('a+b%20c')).toBe('a b c');
    expect(handlers.testEncodeUrlBytes(Buffer.from('a b~', 'utf8'))).toBe('a%20b~');
    expect(handlers.testToSafeUtf8(Buffer.from('hello', 'utf8'))).toBe('hello');
    expect(handlers.testToSafeUtf8(Buffer.from([0xff, 0xfe, 0xfd]))).toBeNull();
    expect(handlers.testTryParseJson('{"ok":true}')).toEqual({ ok: true });
    expect(handlers.testTryParseJson('{bad json}')).toBeNull();

    const failure = JSON.parse(
      handlers.testFail('encoding_tool', new Error('boom')).content[0]!.text,
    );
    expect(failure).toEqual({
      success: false,
      tool: 'encoding_tool',
      error: 'boom',
    });
  });

  it('covers empty structured detection branches and invalid source payloads', async () => {
    const handlers = new ExtraEncodingHandlersBase(collector);

    expect(handlers.testDetectMagicFormats(Buffer.from([0x00, 0x01]))).toEqual([]);
    expect(handlers.testDetectStructuredFormats(Buffer.alloc(0))).toEqual([]);
    expect(
      handlers.testDetectEncodingSignals('raw', undefined, Buffer.from('plain', 'utf8')),
    ).toEqual([]);
    expect(handlers.testCalculateByteFrequency(Buffer.alloc(0))).toEqual([]);
    expect(handlers.testCalculateBlockEntropies(Buffer.alloc(0), 8)).toEqual([]);

    await expect(handlers.testResolveBufferBySource({ source: 'base64' })).rejects.toThrow(
      'data is required for base64 source',
    );
    await expect(handlers.testResolveBufferBySource({ source: 'hex' })).rejects.toThrow(
      'data is required for hex source',
    );
  });

  it('covers request body fallbacks for nested response payloads and evaluator failures', async () => {
    const handlers = new ExtraEncodingHandlersBase(collector);

    collector.getActivePage.mockResolvedValueOnce({
      evaluate: vi.fn(async (fn: (requestId: string) => unknown, requestId: string) =>
        fn(requestId),
      ),
    });
    (globalThis as any).window = {
      __capturedAPIs: [
        {
          requestId: 'req-nested',
          response: {
            body: Buffer.from('nested-body', 'utf8').toString('base64'),
            base64Encoded: true,
          },
        },
      ],
      localStorage: { getItem: vi.fn(() => null) },
    };

    const nested = await handlers.testResolveRequestBodyFromActivePage('req-nested');
    expect(nested?.toString('utf8')).toBe('nested-body');

    collector.getActivePage.mockResolvedValueOnce({
      evaluate: vi.fn(async () => {
        throw new Error('page closed');
      }),
    });
    await expect(handlers.testResolveRequestBodyFromActivePage('req-closed')).resolves.toBeNull();
  });
});
