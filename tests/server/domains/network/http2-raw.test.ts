import { describe, expect, it } from 'vitest';

import { buildHttp2Frame } from '@server/domains/network/http2-raw';

describe('network http2-raw frame builder', () => {
  it('builds a minimal DATA frame with payload', async () => {
    const result = buildHttp2Frame({ frameType: 'DATA', streamId: 1, payloadHex: '48454c4c4f' });
    expect(result.frameType).toBe('DATA');
    expect(result.typeCode).toBe(0x0);
    expect(result.streamId).toBe(1);
    expect(result.payloadHex).toBe('48454c4c4f');
    expect(result.payloadBytes).toBe(5);
    expect(result.frameHeaderHex.length).toBe(18);
    expect(result.frameHex.startsWith(result.frameHeaderHex)).toBe(true);
  });

  it('builds a DATA frame with text payload', async () => {
    const result = buildHttp2Frame({ frameType: 'DATA', streamId: 1, payloadText: 'abc' });
    expect(result.payloadHex).toBe(Buffer.from('abc').toString('hex'));
    expect(result.streamId).toBe(1);
  });

  it('builds an empty DATA frame when no payload is provided', async () => {
    const result = buildHttp2Frame({ frameType: 'DATA', streamId: 1 });
    expect(result.payloadBytes).toBe(0);
    expect(result.payloadHex).toBe('');
  });

  it('builds a SETTINGS frame with entries', async () => {
    const result = buildHttp2Frame({
      frameType: 'SETTINGS',
      settings: [
        { id: 1, value: 4096 },
        { id: 3, value: 128 },
      ],
    });
    expect(result.typeCode).toBe(0x4);
    expect(result.payloadBytes).toBe(12);
  });

  it('builds a SETTINGS ack frame with no payload', async () => {
    const result = buildHttp2Frame({ frameType: 'SETTINGS', ack: true });
    expect(result.typeCode).toBe(0x4);
    expect(result.flags).toBe(1);
    expect(result.payloadBytes).toBe(0);
  });

  it('throws when SETTINGS ack includes settings', async () => {
    expect(() =>
      buildHttp2Frame({
        frameType: 'SETTINGS',
        ack: true,
        settings: [{ id: 1, value: 100 }],
      }),
    ).toThrow('SETTINGS ack frames must not include settings payload');
  });

  it('builds a PING frame with opaque data', async () => {
    const result = buildHttp2Frame({
      frameType: 'PING',
      pingOpaqueDataHex: '0102030405060708',
    });
    expect(result.typeCode).toBe(0x6);
    expect(result.payloadBytes).toBe(8);
  });

  it('builds a PING frame with zero-filled opaque data when omitted', async () => {
    const result = buildHttp2Frame({ frameType: 'PING' });
    expect(result.payloadBytes).toBe(8);
    expect(result.payloadHex).toBe('0000000000000000');
  });

  it('builds a PING ack frame', async () => {
    const result = buildHttp2Frame({
      frameType: 'PING',
      ack: true,
      pingOpaqueDataHex: 'aabbccdd11223344',
    });
    expect(result.flags).toBe(1);
  });

  it('throws when PING opaque data is not 8 bytes', async () => {
    expect(() => buildHttp2Frame({ frameType: 'PING', pingOpaqueDataHex: '0102' })).toThrow(
      'PING frames require exactly 8 bytes of opaque data',
    );
  });

  it('builds a WINDOW_UPDATE frame', async () => {
    const result = buildHttp2Frame({
      frameType: 'WINDOW_UPDATE',
      streamId: 0,
      windowSizeIncrement: 65535,
    });
    expect(result.typeCode).toBe(0x8);
    expect(result.payloadBytes).toBe(4);
  });

  it('throws when WINDOW_UPDATE omits windowSizeIncrement', async () => {
    expect(() => buildHttp2Frame({ frameType: 'WINDOW_UPDATE' })).toThrow(
      'windowSizeIncrement is required',
    );
  });

  it('builds a RST_STREAM frame with error code', async () => {
    const result = buildHttp2Frame({
      frameType: 'RST_STREAM',
      streamId: 3,
      errorCode: 2,
    });
    expect(result.typeCode).toBe(0x3);
    expect(result.payloadBytes).toBe(4);
    expect(result.streamId).toBe(3);
  });

  it('builds a RST_STREAM frame with default error code 0', async () => {
    const result = buildHttp2Frame({ frameType: 'RST_STREAM', streamId: 1 });
    expect(result.payloadHex).toBe('00000000');
  });

  it('builds a GOAWAY frame with lastStreamId and errorCode', async () => {
    const result = buildHttp2Frame({
      frameType: 'GOAWAY',
      lastStreamId: 7,
      errorCode: 11,
    });
    expect(result.typeCode).toBe(0x7);
    expect(result.payloadBytes).toBe(8);
  });

  it('builds a GOAWAY frame with debug data text', async () => {
    const result = buildHttp2Frame({
      frameType: 'GOAWAY',
      lastStreamId: 0,
      errorCode: 0,
      debugDataText: 'test',
    });
    expect(result.payloadBytes).toBe(8 + 4);
  });

  it('builds a GOAWAY frame with ascii debug data', async () => {
    const result = buildHttp2Frame({
      frameType: 'GOAWAY',
      debugDataText: 'ok',
      debugDataEncoding: 'ascii',
    });
    expect(result.payloadBytes).toBe(8 + 2);
  });

  it('builds a RAW frame with explicit type code', async () => {
    const result = buildHttp2Frame({
      frameType: 'RAW',
      frameTypeCode: 0xff,
      payloadHex: 'ab',
    });
    expect(result.typeCode).toBe(0xff);
    expect(result.payloadBytes).toBe(1);
  });

  it('throws when RAW frame omits frameTypeCode', async () => {
    expect(() => buildHttp2Frame({ frameType: 'RAW' })).toThrow(
      'frameTypeCode is required when frameType is RAW',
    );
  });

  // Stream validation
  it('throws when SETTINGS uses non-zero streamId', async () => {
    expect(() => buildHttp2Frame({ frameType: 'SETTINGS', streamId: 1 })).toThrow(
      'SETTINGS frames must use streamId 0',
    );
  });

  it('throws when PING uses non-zero streamId', async () => {
    expect(() => buildHttp2Frame({ frameType: 'PING', streamId: 5 })).toThrow(
      'PING frames must use streamId 0',
    );
  });

  it('throws when GOAWAY uses non-zero streamId', async () => {
    expect(() => buildHttp2Frame({ frameType: 'GOAWAY', streamId: 1 })).toThrow(
      'GOAWAY frames must use streamId 0',
    );
  });

  it('throws when DATA uses streamId 0', async () => {
    expect(() => buildHttp2Frame({ frameType: 'DATA', streamId: 0 })).toThrow(
      'DATA frames must use a non-zero streamId',
    );
  });

  it('throws when RST_STREAM uses streamId 0', async () => {
    expect(() => buildHttp2Frame({ frameType: 'RST_STREAM', streamId: 0 })).toThrow(
      'RST_STREAM frames must use a non-zero streamId',
    );
  });

  // Range validation
  it('throws when streamId exceeds max', async () => {
    expect(() => buildHttp2Frame({ frameType: 'DATA', streamId: 0x8000_0000 })).toThrow(
      'streamId must be an integer',
    );
  });

  it('throws when flags exceed byte range', async () => {
    expect(() => buildHttp2Frame({ frameType: 'DATA', streamId: 1, flags: 256 })).toThrow(
      'flags must be an integer',
    );
  });

  it('throws when windowSizeIncrement is zero', async () => {
    expect(() => buildHttp2Frame({ frameType: 'WINDOW_UPDATE', windowSizeIncrement: 0 })).toThrow(
      'windowSizeIncrement must be an integer',
    );
  });

  it('throws when errorCode exceeds uint32', async () => {
    expect(() => buildHttp2Frame({ frameType: 'RST_STREAM', streamId: 1, errorCode: -1 })).toThrow(
      'errorCode must be an integer',
    );
  });

  it('throws when lastStreamId exceeds max for GOAWAY', async () => {
    expect(() => buildHttp2Frame({ frameType: 'GOAWAY', lastStreamId: 0x8000_0000 })).toThrow(
      'lastStreamId must be an integer',
    );
  });

  it('throws when frameTypeCode exceeds byte range for RAW', async () => {
    expect(() => buildHttp2Frame({ frameType: 'RAW', frameTypeCode: 256 })).toThrow(
      'frameTypeCode must be an integer',
    );
  });

  it('throws when settings id exceeds max', async () => {
    expect(() =>
      buildHttp2Frame({
        frameType: 'SETTINGS',
        settings: [{ id: 0x1_0000, value: 1 }],
      }),
    ).toThrow('settings[0].id must be an integer');
  });

  it('throws when settings value exceeds uint32', async () => {
    expect(() =>
      buildHttp2Frame({
        frameType: 'SETTINGS',
        settings: [{ id: 1, value: -1 }],
      }),
    ).toThrow('settings[0].value must be an integer');
  });

  it('throws for mutually exclusive payloadHex and payloadText', async () => {
    expect(() =>
      buildHttp2Frame({
        frameType: 'DATA',
        streamId: 1,
        payloadHex: 'ab',
        payloadText: 'ab',
      }),
    ).toThrow('payloadHex and payloadText are mutually exclusive');
  });

  it('throws for invalid hex in payloadHex', async () => {
    expect(() => buildHttp2Frame({ frameType: 'DATA', streamId: 1, payloadHex: 'ZZ' })).toThrow(
      'even-length hexadecimal string',
    );
  });

  it('throws for odd-length hex in payloadHex', async () => {
    expect(() => buildHttp2Frame({ frameType: 'DATA', streamId: 1, payloadHex: 'abc' })).toThrow(
      'even-length hexadecimal string',
    );
  });

  it('throws for invalid hex in pingOpaqueDataHex', async () => {
    expect(() =>
      buildHttp2Frame({ frameType: 'PING', pingOpaqueDataHex: 'ZZZZZZZZZZZZZZZZ' }),
    ).toThrow('even-length hexadecimal string');
  });

  it('throws when payload exceeds max frame size', async () => {
    const bigPayload = 'ab'.repeat(0x0100_0000);
    expect(() =>
      buildHttp2Frame({ frameType: 'DATA', streamId: 1, payloadHex: bigPayload }),
    ).toThrow('payload exceeds the HTTP/2 maximum frame size');
  });

  it('uses custom flags when provided', async () => {
    const result = buildHttp2Frame({
      frameType: 'DATA',
      streamId: 1,
      flags: 0x01,
      payloadText: 'x',
    });
    expect(result.flags).toBe(0x01);
  });

  it('uses ascii encoding for DATA payloadText', async () => {
    const result = buildHttp2Frame({
      frameType: 'DATA',
      streamId: 1,
      payloadText: 'A',
      payloadEncoding: 'ascii',
    });
    expect(result.payloadHex).toBe('41');
  });

  it('produces correct 9-byte header for a small frame', async () => {
    const result = buildHttp2Frame({
      frameType: 'DATA',
      streamId: 1,
      payloadHex: '48454c4c4f',
    });
    const header = Buffer.from(result.frameHeaderHex, 'hex');
    expect(header.length).toBe(9);
    const lengthField = ((header[0]! << 16) | (header[1]! << 8) | header[2]!) >>> 0;
    expect(lengthField).toBe(5);
    expect(header[3]).toBe(0x0);
  });
});
