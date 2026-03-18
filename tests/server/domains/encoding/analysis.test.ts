import { describe, it, expect } from 'vitest';
import { EncodingHandlersBase } from '@server/domains/encoding/handlers.base';

class TestableAnalysis extends EncodingHandlersBase {
  constructor() {
    super(null as any);
  }
  public detectMagicFormats(buffer: Buffer) {
    return super.detectMagicFormats(buffer);
  }
  public detectStructuredFormats(buffer: Buffer) {
    return super.detectStructuredFormats(buffer);
  }
  public detectEncodingSignals(source: any, data: string | undefined, buffer: Buffer) {
    return super.detectEncodingSignals(source, data, buffer);
  }
  public calculateShannonEntropy(buffer: Buffer) {
    return super.calculateShannonEntropy(buffer);
  }
  public calculateByteFrequency(buffer: Buffer) {
    return super.calculateByteFrequency(buffer);
  }
  public calculateBlockEntropies(buffer: Buffer, blockSize: number) {
    return super.calculateBlockEntropies(buffer, blockSize);
  }
  public assessEntropy(entropy: number, buffer: Buffer) {
    return super.assessEntropy(entropy, buffer);
  }
  public printableRatio(buffer: Buffer) {
    return super.printableRatio(buffer);
  }
}

describe('EncodingHandlersBase (analysis utilities)', () => {
  const analysis = new TestableAnalysis();

  describe('detectMagicFormats', () => {
    it.each([
      {
        name: 'png',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        expected: ['png'],
      },
      {
        name: 'jpeg',
        buffer: Buffer.from([0xff, 0xd8, 0xff]),
        expected: ['jpeg'],
      },
      {
        name: 'gif',
        buffer: Buffer.from([0x47, 0x49, 0x46]),
        expected: ['gif'],
      },
      {
        name: 'wasm',
        buffer: Buffer.from([0x00, 0x61, 0x73, 0x6d]),
        expected: ['wasm'],
      },
      {
        name: 'zip/apk',
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        expected: ['zip/apk'],
      },
      {
        name: 'pdf',
        buffer: Buffer.from([0x25, 0x50, 0x44, 0x46]),
        expected: ['pdf'],
      },
    ])('detects $name header', ({ buffer, expected }) => {
      expect(analysis.detectMagicFormats(buffer)).toEqual(expected);
    });

    it('returns empty when no signature matches', () => {
      expect(analysis.detectMagicFormats(Buffer.from([0x13, 0x37, 0x00, 0x01]))).toEqual([]);
    });

    it.each([
      { name: 'empty', buffer: Buffer.alloc(0) },
      { name: 'one byte', buffer: Buffer.from([0x89]) },
      { name: 'two bytes', buffer: Buffer.from([0x89, 0x50]) },
    ])('returns empty when buffer too short ($name)', ({ buffer }) => {
      expect(analysis.detectMagicFormats(buffer)).toEqual([]);
    });
  });

  describe('detectStructuredFormats', () => {
    it.each([{ firstByte: 0x08 }, { firstByte: 0x10 }, { firstByte: 0x18 }, { firstByte: 0x20 }])(
      'detects protobuf when first byte is 0x%#',
      ({ firstByte }) => {
        expect(analysis.detectStructuredFormats(Buffer.from([firstByte, 0x01, 0x02]))).toEqual([
          'protobuf',
        ]);
      }
    );

    it.each([
      { name: '0x80 lower bound', firstByte: 0x80 },
      { name: '0x9f upper bound', firstByte: 0x9f },
      { name: '0xa0 lower bound', firstByte: 0xa0 },
      { name: '0xbf upper bound', firstByte: 0xbf },
    ])('detects messagepack/cbor for $name', ({ firstByte }) => {
      expect(analysis.detectStructuredFormats(Buffer.from([firstByte]))).toEqual([
        'messagepack',
        'cbor',
      ]);
    });

    it('returns empty for empty buffer', () => {
      expect(analysis.detectStructuredFormats(Buffer.alloc(0))).toEqual([]);
    });

    it.each([
      { name: 'below range', firstByte: 0x7f },
      { name: 'above range', firstByte: 0xc0 },
      { name: 'random byte', firstByte: 0x01 },
    ])('returns empty when no structure matches ($name)', ({ firstByte }) => {
      expect(analysis.detectStructuredFormats(Buffer.from([firstByte, 0x00, 0x00]))).toEqual([]);
    });
  });

  describe('detectEncodingSignals', () => {
    it('adds base64 when source=base64', () => {
      expect(analysis.detectEncodingSignals('base64', undefined, Buffer.alloc(0))).toEqual([
        'base64',
      ]);
    });

    it('adds hex when source=hex', () => {
      expect(analysis.detectEncodingSignals('hex', undefined, Buffer.alloc(0))).toEqual(['hex']);
    });

    it('detects base64 from data pattern', () => {
      expect(analysis.detectEncodingSignals('raw', 'SGVsbG8=', Buffer.alloc(0))).toEqual([
        'base64',
      ]);
    });

    it('detects hex from data pattern', () => {
      expect(analysis.detectEncodingSignals('raw', '48656c6c6f', Buffer.alloc(0))).toEqual(['hex']);
    });

    it('detects url-encoded from percent encoding', () => {
      expect(analysis.detectEncodingSignals('raw', 'hello%20world', Buffer.alloc(0))).toEqual([
        'url-encoded',
      ]);
    });

    it('detects url-encoded from plus sign', () => {
      expect(analysis.detectEncodingSignals('raw', 'a+b', Buffer.alloc(0))).toEqual([
        'url-encoded',
      ]);
    });

    it('detects utf8-bom from buffer header', () => {
      expect(
        analysis.detectEncodingSignals('raw', undefined, Buffer.from([0xef, 0xbb, 0xbf, 0x41]))
      ).toEqual(['utf8-bom']);
    });

    it('can detect multiple signals at once (source + bom)', () => {
      expect(
        analysis.detectEncodingSignals('base64', undefined, Buffer.from([0xef, 0xbb, 0xbf, 0x41]))
      ).toEqual(['base64', 'utf8-bom']);
    });

    it('can detect base64 and url-encoded simultaneously (base64 contains +)', () => {
      expect(analysis.detectEncodingSignals('raw', '++++', Buffer.alloc(0))).toEqual([
        'base64',
        'url-encoded',
      ]);
    });

    it('returns empty when there are no signals', () => {
      expect(
        analysis.detectEncodingSignals('raw', 'hello world', Buffer.from('hello world', 'utf8'))
      ).toEqual([]);
    });
  });

  describe('calculateShannonEntropy', () => {
    it('returns 0 for empty buffer', () => {
      expect(analysis.calculateShannonEntropy(Buffer.alloc(0))).toBe(0);
    });

    it('returns 0 for a single repeated byte', () => {
      expect(analysis.calculateShannonEntropy(Buffer.alloc(128, 0x41))).toBe(0);
    });

    it('returns 8 for a uniform distribution over all 256 byte values', () => {
      const bytes = Array.from({ length: 256 }, (_, index) => index);
      expect(analysis.calculateShannonEntropy(Buffer.from(bytes))).toBe(8);
    });

    it('returns 1 for two equally-likely byte values', () => {
      expect(analysis.calculateShannonEntropy(Buffer.from([0x00, 0xff]))).toBe(1);
    });

    it('returns 2 for four equally-likely byte values', () => {
      expect(analysis.calculateShannonEntropy(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBe(2);
    });

    it('handles skewed distributions (3:1)', () => {
      expect(analysis.calculateShannonEntropy(Buffer.from([0x00, 0x00, 0x00, 0x01]))).toBe(
        0.811278
      );
    });

    it('returns 4 for 16 equally-likely byte values', () => {
      const bytes = Array.from({ length: 16 }, (_, index) => index);
      expect(analysis.calculateShannonEntropy(Buffer.from(bytes))).toBe(4);
    });
  });

  describe('calculateByteFrequency', () => {
    it('returns empty array for empty buffer', () => {
      expect(analysis.calculateByteFrequency(Buffer.alloc(0))).toEqual([]);
    });

    it('returns one entry for a single byte', () => {
      expect(analysis.calculateByteFrequency(Buffer.from([0x41]))).toEqual([
        { byte: '0x41', count: 1, ratio: 1 },
      ]);
    });

    it('formats bytes as 0x.. (lowercase, padded)', () => {
      expect(analysis.calculateByteFrequency(Buffer.from([0x0a]))).toEqual([
        { byte: '0x0a', count: 1, ratio: 1 },
      ]);
    });

    it('sorts entries by frequency descending', () => {
      expect(
        analysis.calculateByteFrequency(Buffer.from([0x01, 0x02, 0x02, 0x03, 0x03, 0x03]))
      ).toEqual([
        { byte: '0x03', count: 3, ratio: 0.5 },
        { byte: '0x02', count: 2, ratio: 0.333333 },
        { byte: '0x01', count: 1, ratio: 0.166667 },
      ]);
    });

    it('rounds ratios to 6 decimals', () => {
      expect(analysis.calculateByteFrequency(Buffer.from([0x0a, 0x0a, 0xff]))).toEqual([
        { byte: '0x0a', count: 2, ratio: 0.666667 },
        { byte: '0xff', count: 1, ratio: 0.333333 },
      ]);
    });
  });

  describe('calculateBlockEntropies', () => {
    it('returns empty array for empty buffer', () => {
      expect(analysis.calculateBlockEntropies(Buffer.alloc(0), 16)).toEqual([]);
    });

    it('returns a single block when buffer is smaller than blockSize', () => {
      expect(
        analysis.calculateBlockEntropies(Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]), 32)
      ).toEqual([
        {
          index: 0,
          start: 0,
          end: 5,
          entropy: 0,
        },
      ]);
    });

    it('returns multiple blocks with independent entropies', () => {
      const first = Buffer.alloc(16, 0x41);
      const second = Buffer.from(Array.from({ length: 16 }, (_, index) => index));
      const buffer = Buffer.concat([first, second]);

      expect(analysis.calculateBlockEntropies(buffer, 16)).toEqual([
        { index: 0, start: 0, end: 16, entropy: 0 },
        { index: 1, start: 16, end: 32, entropy: 4 },
      ]);
    });

    it('handles a final partial block', () => {
      const buffer = Buffer.from([0, 1, 2, 3, 0, 1, 2, 3, 0, 0]);
      expect(analysis.calculateBlockEntropies(buffer, 4)).toEqual([
        { index: 0, start: 0, end: 4, entropy: 2 },
        { index: 1, start: 4, end: 8, entropy: 2 },
        { index: 2, start: 8, end: 10, entropy: 0 },
      ]);
    });
  });

  describe('assessEntropy', () => {
    const printable = Buffer.from('Just some printable ASCII text.\n', 'utf8');
    const nonPrintable = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]);
    const printableRatio085 = Buffer.from([
      ...new Array<number>(17).fill(0x41),
      ...new Array<number>(3).fill(0x00),
    ]);
    const printableRatio09 = Buffer.from([
      ...new Array<number>(9).fill(0x41),
      ...new Array<number>(1).fill(0x00),
    ]);

    it('returns plaintext for low entropy + high printable ratio', () => {
      expect(analysis.assessEntropy(3.79, printable)).toBe('plaintext');
    });

    it('does not classify as plaintext at entropy boundary (3.8)', () => {
      expect(analysis.assessEntropy(3.8, printable)).toBe('encoded');
    });

    it('does not classify as plaintext when printable ratio is low', () => {
      expect(analysis.assessEntropy(1.0, nonPrintable)).toBe('encoded');
    });

    it('does not classify as plaintext when printable ratio is exactly 0.85', () => {
      expect(analysis.assessEntropy(1.0, printableRatio085)).toBe('encoded');
    });

    it('classifies as plaintext when printable ratio is just above 0.85', () => {
      expect(analysis.assessEntropy(1.0, printableRatio09)).toBe('plaintext');
    });

    it('classifies encoded for entropy in [3.8, 5.8)', () => {
      expect(analysis.assessEntropy(5.0, nonPrintable)).toBe('encoded');
    });

    it('classifies encoded just below 5.8', () => {
      expect(analysis.assessEntropy(5.799999, nonPrintable)).toBe('encoded');
    });

    it('classifies compressed at 5.8', () => {
      expect(analysis.assessEntropy(5.8, nonPrintable)).toBe('compressed');
    });

    it('classifies compressed for entropy in [5.8, 7.2)', () => {
      expect(analysis.assessEntropy(6.5, nonPrintable)).toBe('compressed');
    });

    it('classifies compressed just below 7.2', () => {
      expect(analysis.assessEntropy(7.199999, nonPrintable)).toBe('compressed');
    });

    it('classifies encrypted at 7.2', () => {
      expect(analysis.assessEntropy(7.2, nonPrintable)).toBe('encrypted');
    });

    it('classifies encrypted for entropy in [7.2, 7.8)', () => {
      expect(analysis.assessEntropy(7.5, nonPrintable)).toBe('encrypted');
    });

    it('classifies encrypted just below 7.8', () => {
      expect(analysis.assessEntropy(7.799999, nonPrintable)).toBe('encrypted');
    });

    it('classifies random at 7.8', () => {
      expect(analysis.assessEntropy(7.8, nonPrintable)).toBe('random');
    });

    it('classifies random for entropy >= 7.8', () => {
      expect(analysis.assessEntropy(8.0, nonPrintable)).toBe('random');
    });
  });

  describe('printableRatio', () => {
    it('returns 1 for empty buffer', () => {
      expect(analysis.printableRatio(Buffer.alloc(0))).toBe(1);
    });

    it('returns 1 for fully printable ASCII bytes', () => {
      expect(analysis.printableRatio(Buffer.from('Hello, world! 123', 'utf8'))).toBe(1);
    });

    it('returns 0 for fully non-printable bytes', () => {
      expect(analysis.printableRatio(Buffer.from([0x00, 0x01, 0x02, 0x7f]))).toBe(0);
    });

    it('counts tabs/newlines/carriage returns as printable', () => {
      expect(analysis.printableRatio(Buffer.from([0x09, 0x0a, 0x0d]))).toBe(1);
    });

    it('computes ratio for mixed printable/non-printable data', () => {
      expect(analysis.printableRatio(Buffer.from([0x09, 0x0a, 0x00]))).toBeCloseTo(2 / 3, 12);
    });

    it('does not treat DEL (0x7f) as printable', () => {
      expect(analysis.printableRatio(Buffer.from([0x7e, 0x7f]))).toBeCloseTo(0.5, 12);
    });
  });
});
