const HTTP2_MAX_FRAME_SIZE = 0x00ff_ffff;
const HTTP2_MAX_STREAM_ID = 0x7fff_ffff;
const HTTP2_MAX_SETTINGS_ID = 0xffff;
const HTTP2_MAX_UNSIGNED_INT32 = 0xffff_ffff;

export type SupportedHttp2FrameType =
  | 'DATA'
  | 'SETTINGS'
  | 'PING'
  | 'WINDOW_UPDATE'
  | 'RST_STREAM'
  | 'GOAWAY'
  | 'RAW';

export interface Http2SettingsEntry {
  id: number;
  value: number;
}

export interface Http2FrameBuildInput {
  frameType: SupportedHttp2FrameType;
  streamId?: number;
  flags?: number;
  frameTypeCode?: number;
  payloadHex?: string;
  payloadText?: string;
  payloadEncoding?: 'utf8' | 'ascii';
  settings?: Http2SettingsEntry[];
  ack?: boolean;
  pingOpaqueDataHex?: string;
  windowSizeIncrement?: number;
  errorCode?: number;
  lastStreamId?: number;
  debugDataText?: string;
  debugDataEncoding?: 'utf8' | 'ascii';
}

export interface BuiltHttp2Frame {
  frameType: SupportedHttp2FrameType;
  typeCode: number;
  streamId: number;
  flags: number;
  payloadBytes: number;
  payloadHex: string;
  frameHeaderHex: string;
  frameHex: string;
}

const FRAME_TYPE_CODES: Record<Exclude<SupportedHttp2FrameType, 'RAW'>, number> = {
  DATA: 0x0,
  RST_STREAM: 0x3,
  SETTINGS: 0x4,
  PING: 0x6,
  GOAWAY: 0x7,
  WINDOW_UPDATE: 0x8,
};

function assertIntegerInRange(value: number, field: string, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} must be an integer between ${String(min)} and ${String(max)}`);
  }
}

function parseHexBytes(value: string, field: string): Buffer {
  const normalized = value.replace(/\s+/g, '').trim();
  if (normalized.length === 0) {
    return Buffer.alloc(0);
  }
  if (normalized.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(normalized)) {
    throw new Error(`${field} must be an even-length hexadecimal string`);
  }
  return Buffer.from(normalized, 'hex');
}

function encodeTextBytes(value: string, encoding: BufferEncoding): Buffer {
  return Buffer.from(value, encoding);
}

function resolvePayloadBytes(
  payloadHex: string | undefined,
  payloadText: string | undefined,
  payloadEncoding: BufferEncoding,
): Buffer {
  if (payloadHex !== undefined && payloadText !== undefined) {
    throw new Error('payloadHex and payloadText are mutually exclusive');
  }

  if (payloadHex !== undefined) {
    return parseHexBytes(payloadHex, 'payloadHex');
  }

  if (payloadText !== undefined) {
    return encodeTextBytes(payloadText, payloadEncoding);
  }

  return Buffer.alloc(0);
}

function buildSettingsPayload(entries: Http2SettingsEntry[]): Buffer {
  const payload = Buffer.alloc(entries.length * 6);
  entries.forEach((entry, index) => {
    assertIntegerInRange(entry.id, `settings[${String(index)}].id`, 0, HTTP2_MAX_SETTINGS_ID);
    assertIntegerInRange(
      entry.value,
      `settings[${String(index)}].value`,
      0,
      HTTP2_MAX_UNSIGNED_INT32,
    );
    payload.writeUInt16BE(entry.id, index * 6);
    payload.writeUInt32BE(entry.value >>> 0, index * 6 + 2);
  });
  return payload;
}

function encodeUInt31(value: number, field: string): Buffer {
  assertIntegerInRange(value, field, 0, HTTP2_MAX_STREAM_ID);
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  buffer[0] = buffer[0]! & 0x7f;
  return buffer;
}

function buildFramePayload(input: Http2FrameBuildInput): {
  payload: Buffer;
  typeCode: number;
  flags: number;
} {
  const frameType = input.frameType;
  const flags = input.flags ?? 0;
  assertIntegerInRange(flags, 'flags', 0, 0xff);

  switch (frameType) {
    case 'DATA': {
      const payload = resolvePayloadBytes(
        input.payloadHex,
        input.payloadText,
        input.payloadEncoding ?? 'utf8',
      );
      return { payload, typeCode: FRAME_TYPE_CODES.DATA, flags };
    }
    case 'SETTINGS': {
      if (input.ack === true && (input.settings?.length ?? 0) > 0) {
        throw new Error('SETTINGS ack frames must not include settings payload');
      }
      const payload = buildSettingsPayload(input.settings ?? []);
      return {
        payload,
        typeCode: FRAME_TYPE_CODES.SETTINGS,
        flags: input.ack ? flags | 0x1 : flags,
      };
    }
    case 'PING': {
      const payload = input.pingOpaqueDataHex
        ? parseHexBytes(input.pingOpaqueDataHex, 'pingOpaqueDataHex')
        : Buffer.alloc(8);
      if (payload.length !== 8) {
        throw new Error('PING frames require exactly 8 bytes of opaque data');
      }
      return {
        payload,
        typeCode: FRAME_TYPE_CODES.PING,
        flags: input.ack ? flags | 0x1 : flags,
      };
    }
    case 'WINDOW_UPDATE': {
      const increment = input.windowSizeIncrement;
      if (increment === undefined) {
        throw new Error('windowSizeIncrement is required for WINDOW_UPDATE frames');
      }
      assertIntegerInRange(increment, 'windowSizeIncrement', 1, HTTP2_MAX_STREAM_ID);
      const payload = encodeUInt31(increment, 'windowSizeIncrement');
      return { payload, typeCode: FRAME_TYPE_CODES.WINDOW_UPDATE, flags };
    }
    case 'RST_STREAM': {
      const errorCode = input.errorCode ?? 0;
      assertIntegerInRange(errorCode, 'errorCode', 0, HTTP2_MAX_UNSIGNED_INT32);
      const payload = Buffer.alloc(4);
      payload.writeUInt32BE(errorCode >>> 0, 0);
      return { payload, typeCode: FRAME_TYPE_CODES.RST_STREAM, flags };
    }
    case 'GOAWAY': {
      const lastStreamId = input.lastStreamId ?? 0;
      const errorCode = input.errorCode ?? 0;
      assertIntegerInRange(lastStreamId, 'lastStreamId', 0, HTTP2_MAX_STREAM_ID);
      assertIntegerInRange(errorCode, 'errorCode', 0, HTTP2_MAX_UNSIGNED_INT32);
      const debugData =
        input.debugDataText !== undefined
          ? encodeTextBytes(input.debugDataText, input.debugDataEncoding ?? 'utf8')
          : Buffer.alloc(0);
      const payload = Buffer.concat([
        encodeUInt31(lastStreamId, 'lastStreamId'),
        Buffer.from([
          (errorCode >>> 24) & 0xff,
          (errorCode >>> 16) & 0xff,
          (errorCode >>> 8) & 0xff,
          errorCode & 0xff,
        ]),
        debugData,
      ]);
      return { payload, typeCode: FRAME_TYPE_CODES.GOAWAY, flags };
    }
    case 'RAW': {
      const typeCode = input.frameTypeCode;
      if (typeCode === undefined) {
        throw new Error('frameTypeCode is required when frameType is RAW');
      }
      assertIntegerInRange(typeCode, 'frameTypeCode', 0, 0xff);
      const payload = resolvePayloadBytes(
        input.payloadHex,
        input.payloadText,
        input.payloadEncoding ?? 'utf8',
      );
      return { payload, typeCode, flags };
    }
  }
}

function validateFrameTypeStream(frameType: SupportedHttp2FrameType, streamId: number): void {
  if (
    (frameType === 'SETTINGS' || frameType === 'PING' || frameType === 'GOAWAY') &&
    streamId !== 0
  ) {
    throw new Error(`${frameType} frames must use streamId 0`);
  }
  if ((frameType === 'DATA' || frameType === 'RST_STREAM') && streamId === 0) {
    throw new Error(`${frameType} frames must use a non-zero streamId`);
  }
}

export function buildHttp2Frame(input: Http2FrameBuildInput): BuiltHttp2Frame {
  const streamId = input.streamId ?? 0;
  assertIntegerInRange(streamId, 'streamId', 0, HTTP2_MAX_STREAM_ID);
  validateFrameTypeStream(input.frameType, streamId);

  const { payload, typeCode, flags } = buildFramePayload(input);
  if (payload.length > HTTP2_MAX_FRAME_SIZE) {
    throw new Error(
      `payload exceeds the HTTP/2 maximum frame size of ${String(HTTP2_MAX_FRAME_SIZE)} bytes`,
    );
  }

  const header = Buffer.alloc(9);
  header[0] = (payload.length >>> 16) & 0xff;
  header[1] = (payload.length >>> 8) & 0xff;
  header[2] = payload.length & 0xff;
  header[3] = typeCode & 0xff;
  header[4] = flags & 0xff;
  header.writeUInt32BE(streamId >>> 0, 5);
  header[5] = header[5]! & 0x7f;

  const frame = Buffer.concat([header, payload]);
  return {
    frameType: input.frameType,
    typeCode,
    streamId,
    flags,
    payloadBytes: payload.length,
    payloadHex: payload.toString('hex'),
    frameHeaderHex: header.toString('hex'),
    frameHex: frame.toString('hex'),
  };
}
