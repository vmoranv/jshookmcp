/**
 * ProtocolAnalysisFingerprintHandlers — protocol fingerprint heuristics.
 */

import { argStringArray } from '@server/domains/shared/parse-args';
import { asJsonResponse } from '@server/domains/shared/response';
import type { ToolArgs, ToolResponse } from '@server/types';
import {
  PROTO_DNS_CONFIDENCE,
  PROTO_H2_CONFIDENCE,
  PROTO_H2_PRI_CONFIDENCE,
  PROTO_HTTP_CONFIDENCE,
  PROTO_MQTT_CONFIDENCE,
  PROTO_QUIC_CONFIDENCE,
  PROTO_SOCKS5_CONFIDENCE,
  PROTO_SSH_CONFIDENCE,
  PROTO_STUN_CONFIDENCE,
  PROTO_TLS_CONFIDENCE,
  PROTO_TLS_MIN_RECORD_LEN,
  PROTO_TLS_RECORD_CONFIDENCE,
  PROTO_WS_CONFIDENCE,
} from '@src/constants';
import {
  HTTP_METHODS,
  isLikelyDnsHeader,
  parseDnsHeader,
  parseTlsClientHello,
  readU16,
  readU8,
  WS_OPCODES,
} from './fingerprint-utils';
import { ProtocolAnalysisPacketHandlers } from './packet-handlers';

export class ProtocolAnalysisFingerprintHandlers extends ProtocolAnalysisPacketHandlers {
  async handleProtoFingerprint(args: ToolArgs): Promise<ToolResponse> {
    const hexPayloads = argStringArray(args, 'hexPayloads');
    const includeKnown = args.includeKnownProtocols !== false;
    const includeHints = args.includeFieldHints !== false;

    if (hexPayloads.length === 0) {
      return asJsonResponse({ success: false, error: 'hexPayloads is required' });
    }

    const results = hexPayloads.map((hex, index) => {
      const clean = hex.replace(/\s/g, '');
      const matches: Array<{ protocol: string; layer: string; confidence: number }> = [];
      const actualBytes = clean.length / 2;
      const tlsRecordLen = actualBytes >= 5 ? readU16(clean, 3) : -1;
      const hasCompleteTlsRecord =
        Number.isFinite(tlsRecordLen) && tlsRecordLen >= 0 && actualBytes >= 5 + tlsRecordLen;
      const isTlsClientHello =
        hasCompleteTlsRecord &&
        tlsRecordLen >= PROTO_TLS_MIN_RECORD_LEN &&
        readU8(clean, 0) === 0x16 &&
        readU8(clean, 5) === 0x01;
      const isDns = isLikelyDnsHeader(clean);
      const isHttp = Object.keys(HTTP_METHODS).some((method) =>
        clean.toUpperCase().startsWith(method),
      );
      const isSsh = clean.toUpperCase().startsWith('5353482D');
      const isWs = clean.length >= 4 && looksLikeWebSocket(clean);

      let deepParse: Record<string, unknown> | null = null;

      if (isTlsClientHello) {
        matches.push({
          protocol: 'TLS ClientHello',
          layer: 'L6-TLS',
          confidence: PROTO_TLS_CONFIDENCE,
        });
        if (includeHints) {
          deepParse = parseTlsClientHello(clean);
        }
      } else if (isHttp) {
        matches.push({
          protocol: 'HTTP/1.x',
          layer: 'L7-HTTP',
          confidence: PROTO_HTTP_CONFIDENCE,
        });
        if (includeHints) {
          deepParse = describeHttp(clean);
        }
      } else if (isSsh) {
        matches.push({ protocol: 'SSH', layer: 'L7-SSH', confidence: PROTO_SSH_CONFIDENCE });
        if (includeHints && clean.length >= 20) {
          deepParse = {
            banner: Buffer.from(clean.substring(0, Math.min(clean.length, 80)), 'hex').toString(
              'ascii',
            ),
          };
        }
      } else if (isWs) {
        matches.push({ protocol: 'WebSocket', layer: 'L7-WS', confidence: PROTO_WS_CONFIDENCE });
        if (includeHints && clean.length >= 4) {
          deepParse = describeWebSocket(clean);
        }
      } else if (actualBytes >= 20 && looksLikeStun(clean, actualBytes)) {
        matches.push({ protocol: 'STUN', layer: 'L5-STUN', confidence: PROTO_STUN_CONFIDENCE });
        if (includeHints) {
          deepParse = describeStun(clean);
        }
      } else if (actualBytes >= 6 && readU8(clean, 0) === 0xc0 && looksLikeQuic(clean)) {
        const version = quicVersion(clean);
        matches.push({ protocol: 'QUIC', layer: 'L4-QUIC', confidence: PROTO_QUIC_CONFIDENCE });
        if (includeHints && actualBytes >= 6) {
          const destConnIdLen = readU8(clean, 5);
          deepParse = {
            headerForm: 'long',
            version:
              version === 0x00000001
                ? 'v1'
                : version === 0x00000000
                  ? 'version-negotiation'
                  : `0x${version.toString(16)}`,
            destConnIdLen,
          };
        }
      } else if (actualBytes >= 3 && readU8(clean, 0) === 0x05 && looksLikeSocks5(clean)) {
        matches.push({
          protocol: 'SOCKS5',
          layer: 'L5-SOCKS5',
          confidence: PROTO_SOCKS5_CONFIDENCE,
        });
        if (includeHints) {
          deepParse = describeSocks5(clean);
        }
      } else if (isDns) {
        matches.push({ protocol: 'DNS', layer: 'L7-DNS', confidence: PROTO_DNS_CONFIDENCE });
        if (includeHints) {
          deepParse = parseDnsHeader(clean);
        }
      } else if (actualBytes >= 2 && looksLikeMqtt(clean, actualBytes)) {
        matches.push({ protocol: 'MQTT', layer: 'L7-MQTT', confidence: PROTO_MQTT_CONFIDENCE });
        if (includeHints) {
          deepParse = describeMqtt(clean);
        }
      } else if (actualBytes >= 9 && looksLikeH2Frame(clean, actualBytes)) {
        matches.push({ protocol: 'HTTP/2', layer: 'L5-HTTP2', confidence: PROTO_H2_CONFIDENCE });
        if (includeHints) {
          deepParse = describeH2Frame(clean);
        }
      }

      if (includeKnown && matches.length === 0) {
        if (hasCompleteTlsRecord && /^160301|^160302|^160303/i.test(clean.substring(0, 8))) {
          matches.push({
            protocol: 'TLS Record',
            layer: 'L6-TLS',
            confidence: PROTO_TLS_RECORD_CONFIDENCE,
          });
        }
        if (clean.substring(0, 8).startsWith('50524920')) {
          matches.push({
            protocol: 'HTTP/2 PRI',
            layer: 'L7-HTTP2',
            confidence: PROTO_H2_PRI_CONFIDENCE,
          });
        }
      }

      const fieldHints: Array<{ offset: number; hint: string }> = [];
      if (includeHints && !deepParse && clean.length >= 8) {
        const first2 = readU16(clean, 0);
        if (first2 > 0 && first2 < clean.length / 2) {
          fieldHints.push({ offset: 0, hint: `possible length field (${first2} bytes)` });
        }
      }

      return {
        index,
        size: actualBytes,
        protocolMatches:
          matches.length > 0 ? matches : [{ protocol: 'unknown', layer: 'unknown', confidence: 0 }],
        ...(deepParse ? { parsedFields: deepParse } : {}),
        ...(fieldHints.length > 0 ? { fieldHints } : {}),
      };
    });

    return asJsonResponse({ success: true, fingerprints: results });
  }
}

/** Detect a plausible WebSocket frame header (verbatim from the former inline
 * predicate in the fingerprint scan; keep in sync with describeWebSocket). */
function looksLikeWebSocket(clean: string): boolean {
  const b0 = readU8(clean, 0);
  const b1 = readU8(clean, 1);
  const opcode = b0 & 0x0f;
  if (opcode === 0) return false;

  const validOpcode = opcode <= 10 && !(opcode >= 3 && opcode <= 7);
  const masked = ((b1 >> 7) & 1) === 1;
  const wsByteCount = clean.length / 2;
  let payloadLen = b1 & 0x7f;
  let headerBytes = 2;

  if (payloadLen === 126) {
    if (wsByteCount < 4) return false;
    payloadLen = readU16(clean, 2);
    headerBytes = 4;
  } else if (payloadLen === 127) {
    if (wsByteCount < 10) return false;
    // Signed 32-bit reads make hi32 negative when the sign bit is
    // set; compare unsigned and reject >4GiB frames outright.
    const hi32 = ((readU16(clean, 2) << 16) | readU16(clean, 4)) >>> 0;
    if (hi32 > 0) return false;
    payloadLen = (readU16(clean, 6) << 16) | readU16(clean, 8);
    headerBytes = 10;
  }

  return validOpcode && wsByteCount >= headerBytes + (masked ? 4 : 0) + payloadLen;
}

function describeHttp(clean: string): Record<string, unknown> {
  const method =
    Object.entries(HTTP_METHODS).find(([prefix]) => clean.toUpperCase().startsWith(prefix))?.[1] ??
    'UNKNOWN';
  return {
    method,
    httpVersion: clean.indexOf('2048545450') > 0 ? '1.x' : 'unknown',
  };
}

function describeWebSocket(clean: string): Record<string, unknown> {
  const b0 = readU8(clean, 0);
  const b1 = readU8(clean, 1);
  const opcode = b0 & 0xf;
  const masked = (b1 >> 7) & 1;
  let payloadLen = b1 & 0x7f;
  let headerSize = 2;
  if (payloadLen === 126) {
    payloadLen = clean.length >= 4 ? readU16(clean, 2) : 0;
    headerSize = 4;
  } else if (payloadLen === 127) {
    if (clean.length >= 20) {
      const hi32 = (readU16(clean, 2) << 16) | readU16(clean, 4);
      const lo32 = (readU16(clean, 6) << 16) | readU16(clean, 8);
      payloadLen = hi32 > 0 ? 0xffffffff : lo32;
    } else {
      payloadLen = 0;
    }
    headerSize = 10;
  }
  if (masked) headerSize += 4;
  return {
    fin: (b0 >> 7) & 1,
    rsv1: (b0 >> 6) & 1,
    opcode,
    opcodeName: WS_OPCODES[opcode] ?? `reserved(${opcode})`,
    masked: !!masked,
    payloadLength: payloadLen,
    headerSize,
  };
}

function looksLikeStun(clean: string, actualBytes: number): boolean {
  const magic =
    (readU8(clean, 4) << 24) |
    (readU8(clean, 5) << 16) |
    (readU8(clean, 6) << 8) |
    readU8(clean, 7);
  if (magic !== 0x2112a442) return false;
  const msgType = readU16(clean, 0);
  if ((msgType & 0xc000) !== 0) return false;
  const msgLen = readU16(clean, 2);
  return 20 + msgLen <= actualBytes;
}

function describeStun(clean: string): Record<string, unknown> {
  const msgType = readU16(clean, 0);
  const cls = (msgType >> 4) & 1;
  const method = msgType & 0x3eef;
  return {
    messageType: msgType,
    class: cls ? 'indication/response' : 'request',
    method,
    messageLength: readU16(clean, 2),
  };
}

function quicVersion(clean: string): number {
  return (
    (readU8(clean, 1) << 24) | (readU8(clean, 2) << 16) | (readU8(clean, 3) << 8) | readU8(clean, 4)
  );
}

function looksLikeQuic(clean: string): boolean {
  const version = quicVersion(clean);
  return version === 0x00000001 || version === 0x00000000 || version === 0x709a50c4;
}

function looksLikeSocks5(clean: string): boolean {
  const b1 = readU8(clean, 1);
  return (b1 >= 1 && b1 <= 3) || (b1 > 0 && b1 < 10);
}

function describeSocks5(clean: string): Record<string, unknown> {
  const b1 = readU8(clean, 1);
  const CMD_NAMES: Record<number, string> = { 1: 'CONNECT', 2: 'BIND', 3: 'UDP_ASSOCIATE' };
  const isCmd = b1 >= 1 && b1 <= 3;
  return isCmd ? { command: CMD_NAMES[b1] ?? b1 } : { authMethodCount: b1 };
}

function looksLikeMqtt(clean: string, actualBytes: number): boolean {
  const b0 = readU8(clean, 0);
  const mqttType = b0 >> 4;
  if (mqttType < 1 || mqttType > 14) return false;
  if (mqttType !== 3 && (b0 & 0x0f) !== 0) return false;
  let value = 0;
  let shift = 0;
  let encodedBytes = 0;
  for (let i = 1; i <= 4 && i < actualBytes; i++) {
    const b = readU8(clean, i);
    value |= (b & 0x7f) << shift;
    shift += 7;
    encodedBytes++;
    if ((b & 0x80) === 0) break;
  }
  return encodedBytes > 0 && value > 0 && 1 + encodedBytes + value <= actualBytes;
}

const MQTT_TYPE_NAMES: Record<number, string> = {
  1: 'CONNECT',
  2: 'CONNACK',
  3: 'PUBLISH',
  4: 'PUBACK',
  5: 'PUBREC',
  6: 'PUBREL',
  7: 'PUBCOMP',
  8: 'SUBSCRIBE',
  9: 'SUBACK',
  10: 'UNSUBSCRIBE',
  11: 'UNSUBACK',
  12: 'PINGREQ',
  13: 'PINGRESP',
  14: 'DISCONNECT',
};

function describeMqtt(clean: string): Record<string, unknown> {
  const mqttB0 = readU8(clean, 0);
  const mqttType = mqttB0 >> 4;
  return {
    packetType: MQTT_TYPE_NAMES[mqttType] ?? mqttType,
    dup: (mqttB0 >> 3) & 1,
    qos: (mqttB0 >> 1) & 3,
  };
}

function looksLikeH2Frame(clean: string, actualBytes: number): boolean {
  const frameLen = (readU8(clean, 0) << 16) | (readU8(clean, 1) << 8) | readU8(clean, 2);
  const frameType = readU8(clean, 3);
  if (frameType < 0 || frameType > 9) return false;
  if (frameType === 0 && frameLen === 0) return false;
  if (frameLen > 16384) return false;
  const streamId =
    (readU8(clean, 5) << 24) |
    (readU8(clean, 6) << 16) |
    (readU8(clean, 7) << 8) |
    readU8(clean, 8);
  if ((streamId & 0x80000000) !== 0) return false;
  return 9 + frameLen <= actualBytes;
}

const H2_FRAME_NAMES: Record<number, string> = {
  0: 'DATA',
  1: 'HEADERS',
  2: 'PRIORITY',
  3: 'RST_STREAM',
  4: 'SETTINGS',
  5: 'PUSH_PROMISE',
  6: 'PING',
  7: 'GOAWAY',
  8: 'WINDOW_UPDATE',
  9: 'CONTINUATION',
};

function describeH2Frame(clean: string): Record<string, unknown> {
  const frameType = readU8(clean, 3);
  const streamId =
    (readU8(clean, 5) << 24) |
    (readU8(clean, 6) << 16) |
    (readU8(clean, 7) << 8) |
    readU8(clean, 8);
  return {
    frameType: H2_FRAME_NAMES[frameType] ?? frameType,
    frameLength: (readU8(clean, 0) << 16) | (readU8(clean, 1) << 8) | readU8(clean, 2),
    flags: readU8(clean, 4),
    streamId,
  };
}
