import { describe, expect, it } from 'vitest';

import { buildHttp2Frame, parseHttp2Frame } from '@server/domains/network/http2-raw';

describe('network http2-raw frame parser', () => {
  it('round-trips a DATA frame', async () => {
    const built = buildHttp2Frame({ frameType: 'DATA', streamId: 7, payloadHex: '48454c4c4f' });
    const parsed = parseHttp2Frame(built.frameHex);

    expect(parsed.frameType).toBe('DATA');
    expect(parsed.typeCode).toBe(0x0);
    expect(parsed.streamId).toBe(7);
    expect(parsed.flags).toBe(0);
    expect(parsed.payloadBytes).toBe(5);
    expect(parsed.payloadHex).toBe('48454c4c4f');
  });

  it('round-trips a SETTINGS frame with entries', async () => {
    const built = buildHttp2Frame({
      frameType: 'SETTINGS',
      settings: [
        { id: 1, value: 4096 },
        { id: 3, value: 128 },
      ],
    });
    const parsed = parseHttp2Frame(built.frameHex);

    expect(parsed.frameType).toBe('SETTINGS');
    expect(parsed.typeCode).toBe(0x4);
    expect(parsed.streamId).toBe(0);
    expect(parsed.settings).toEqual([
      { id: 1, value: 4096 },
      { id: 3, value: 128 },
    ]);
  });

  it('round-trips a SETTINGS ACK frame (empty payload)', async () => {
    const built = buildHttp2Frame({ frameType: 'SETTINGS', ack: true });
    const parsed = parseHttp2Frame(built.frameHex);

    expect(parsed.frameType).toBe('SETTINGS');
    expect(parsed.flags & 0x1).toBe(0x1);
    expect(parsed.settings).toEqual([]);
    expect(parsed.payloadBytes).toBe(0);
  });

  it('round-trips a PING frame with opaque data', async () => {
    const opaque = '0123456789abcdef';
    const built = buildHttp2Frame({ frameType: 'PING', pingOpaqueDataHex: opaque });
    const parsed = parseHttp2Frame(built.frameHex);

    expect(parsed.frameType).toBe('PING');
    expect(parsed.typeCode).toBe(0x6);
    expect(parsed.pingOpaqueDataHex).toBe(opaque);
  });

  it('round-trips a WINDOW_UPDATE frame', async () => {
    const built = buildHttp2Frame({ frameType: 'WINDOW_UPDATE', windowSizeIncrement: 65535 });
    const parsed = parseHttp2Frame(built.frameHex);

    expect(parsed.frameType).toBe('WINDOW_UPDATE');
    expect(parsed.typeCode).toBe(0x8);
    expect(parsed.windowSizeIncrement).toBe(65535);
  });

  it('round-trips a RST_STREAM frame', async () => {
    const built = buildHttp2Frame({ frameType: 'RST_STREAM', streamId: 3, errorCode: 1 });
    const parsed = parseHttp2Frame(built.frameHex);

    expect(parsed.frameType).toBe('RST_STREAM');
    expect(parsed.typeCode).toBe(0x3);
    expect(parsed.streamId).toBe(3);
    expect(parsed.errorCode).toBe(1);
  });

  it('round-trips a GOAWAY frame with debug data', async () => {
    const built = buildHttp2Frame({
      frameType: 'GOAWAY',
      lastStreamId: 5,
      errorCode: 11,
      debugDataText: 'bye',
    });
    const parsed = parseHttp2Frame(built.frameHex);

    expect(parsed.frameType).toBe('GOAWAY');
    expect(parsed.typeCode).toBe(0x7);
    expect(parsed.lastStreamId).toBe(5);
    expect(parsed.errorCode).toBe(11);
    expect(parsed.debugDataHex).toBe(Buffer.from('bye').toString('hex'));
  });

  it('treats an unknown type code as RAW', async () => {
    const built = buildHttp2Frame({ frameType: 'RAW', frameTypeCode: 0x21, payloadHex: 'cafe' });
    const parsed = parseHttp2Frame(built.frameHex);

    expect(parsed.frameType).toBe('RAW');
    expect(parsed.typeCode).toBe(0x21);
    expect(parsed.payloadHex).toBe('cafe');
  });

  it('preserves flags from the header', async () => {
    const built = buildHttp2Frame({ frameType: 'DATA', streamId: 1, flags: 0x1, payloadHex: 'ab' });
    const parsed = parseHttp2Frame(built.frameHex);

    expect(parsed.flags).toBe(0x1);
  });

  it('masks the streamId reserved high bit (clears it)', async () => {
    // Force a header where streamId high bit is set; buildHttp2Frame clears it,
    // so craft the header bytes directly to exercise the parser mask.
    const header = Buffer.alloc(9);
    header[0] = 0;
    header[1] = 0;
    header[2] = 0; // length 0
    header[3] = 0x0; // DATA
    header[4] = 0; // flags
    header.writeUInt32BE(0x80000005, 5); // reserved bit set + stream id 5
    const parsed = parseHttp2Frame(header.toString('hex'));

    expect(parsed.streamId).toBe(5);
  });

  it('tolerates whitespace inside frameHex', async () => {
    const built = buildHttp2Frame({ frameType: 'PING', pingOpaqueDataHex: '0123456789abcdef' });
    const spaced = built.frameHex.match(/.{1,2}/g)!.join(' ');
    const parsed = parseHttp2Frame(spaced);

    expect(parsed.frameType).toBe('PING');
    expect(parsed.pingOpaqueDataHex).toBe('0123456789abcdef');
  });

  // ── lenient semantic decode ──

  it('sets decodeError but keeps payloadHex for a malformed SETTINGS payload', async () => {
    // 5-byte payload is not a multiple of 6 — build via RAW DATA-shaped header manually.
    const payload = Buffer.from('0102030405', 'hex'); // 5 bytes
    const header = Buffer.alloc(9);
    header[2] = payload.length;
    header[3] = 0x4; // SETTINGS type code
    const frameHex = Buffer.concat([header, payload]).toString('hex');

    const parsed = parseHttp2Frame(frameHex);
    expect(parsed.frameType).toBe('SETTINGS');
    expect(parsed.settings).toBeUndefined();
    expect(parsed.decodeError).toMatch(/not a multiple of 6/);
    expect(parsed.payloadHex).toBe('0102030405');
  });

  it('sets decodeError for a PING payload that is not 8 bytes', async () => {
    const payload = Buffer.alloc(4, 0xaa);
    const header = Buffer.alloc(9);
    header[2] = payload.length;
    header[3] = 0x6; // PING type code
    const frameHex = Buffer.concat([header, payload]).toString('hex');

    const parsed = parseHttp2Frame(frameHex);
    expect(parsed.frameType).toBe('PING');
    expect(parsed.pingOpaqueDataHex).toBeUndefined();
    expect(parsed.decodeError).toMatch(/not 8/);
  });

  // ── error paths ──

  it('rejects odd-length hex', async () => {
    expect(() => parseHttp2Frame('abc')).toThrow('even-length hexadecimal');
  });

  it('rejects non-hex characters', async () => {
    expect(() => parseHttp2Frame('zzzzzzzzzzzzzzzzzz')).toThrow('even-length hexadecimal');
  });

  it('rejects empty frameHex', async () => {
    expect(() => parseHttp2Frame('')).toThrow('non-empty');
  });

  it('rejects a frame shorter than the 9-byte header', async () => {
    expect(() => parseHttp2Frame('0000')).toThrow('at least 9 bytes');
  });

  it('rejects a truncated frame (declared payload exceeds buffer)', async () => {
    const header = Buffer.alloc(9);
    header[2] = 99; // claims 99-byte payload
    header[3] = 0x0; // DATA
    // only 2 payload bytes follow
    const frameHex = Buffer.concat([header, Buffer.from('ab', 'hex')]).toString('hex');

    expect(() => parseHttp2Frame(frameHex)).toThrow('truncated');
  });

  it('round-trips a PUSH_PROMISE frame (RFC 7540 §6.6)', async () => {
    const built = buildHttp2Frame({
      frameType: 'PUSH_PROMISE',
      streamId: 1,
      promisedStreamId: 2,
      headerBlockFragmentHex: '828684418a089d5c0b8170dc641d9f',
      flags: 0x4, // END_HEADERS
    });
    const parsed = parseHttp2Frame(built.frameHex);

    expect(parsed.frameType).toBe('PUSH_PROMISE');
    expect(parsed.typeCode).toBe(0x5);
    expect(parsed.streamId).toBe(1);
    expect(parsed.flags).toBe(0x4);
    expect(parsed.promisedStreamId).toBe(2);
    expect(parsed.headerBlockFragmentHex).toBe('828684418a089d5c0b8170dc641d9f');
    expect(parsed.padLength).toBeUndefined();
  });

  it('round-trips a padded PUSH_PROMISE frame', async () => {
    const built = buildHttp2Frame({
      frameType: 'PUSH_PROMISE',
      streamId: 3,
      promisedStreamId: 5,
      headerBlockFragmentHex: '00',
      padLength: 4,
    });
    const parsed = parseHttp2Frame(built.frameHex);

    expect(parsed.flags & 0x8).toBe(0x8); // PADDED
    expect(parsed.padLength).toBe(4);
    expect(parsed.promisedStreamId).toBe(5);
    expect(parsed.headerBlockFragmentHex).toBe('00');
  });

  it('clears the reserved high bit on the PUSH_PROMISE promised stream id', async () => {
    const built = buildHttp2Frame({
      frameType: 'PUSH_PROMISE',
      streamId: 1,
      promisedStreamId: 0x7fff_ffff, // max valid (31-bit)
    });
    const parsed = parseHttp2Frame(built.frameHex);
    expect(parsed.promisedStreamId).toBe(0x7fff_ffff);
  });

  it('requires non-zero streamId for PUSH_PROMISE', async () => {
    expect(() =>
      buildHttp2Frame({ frameType: 'PUSH_PROMISE', streamId: 0, promisedStreamId: 2 }),
    ).toThrow('non-zero streamId');
  });

  it('requires promisedStreamId for PUSH_PROMISE', async () => {
    expect(() => buildHttp2Frame({ frameType: 'PUSH_PROMISE', streamId: 1 })).toThrow(
      'promisedStreamId is required',
    );
  });

  it('flags a malformed PUSH_PROMISE payload (too short)', async () => {
    // Hand-build a PUSH_PROMISE header claiming a 1-byte payload that's too short for the 4-byte stream id.
    const header = Buffer.alloc(9);
    header[2] = 1; // 1-byte payload
    header[3] = 0x5; // PUSH_PROMISE
    header.writeUInt32BE(1, 5); // streamId = 1
    header[5] = header[5]! & 0x7f;
    const frameHex = Buffer.concat([header, Buffer.from('ff', 'hex')]).toString('hex');
    const parsed = parseHttp2Frame(frameHex);
    expect(parsed.frameType).toBe('PUSH_PROMISE');
    expect(parsed.decodeError).toMatch(/less than 4/);
  });
});
