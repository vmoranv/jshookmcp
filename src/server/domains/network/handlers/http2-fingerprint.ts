import { createHash } from 'node:crypto';
import { parseHttp2Frame } from '@server/domains/network/http2-raw';
import type { Http2SettingsEntry, ParsedHttp2Frame } from '@server/domains/network/http2-raw';

/**
 * HTTP/2 SETTINGS fingerprint (Akamai-style).
 *
 * The connection preface a client sends — its SETTINGS frame, the stream-0
 * WINDOW_UPDATE, and any PRIORITY frames — is highly client-specific and is the
 * basis of the HTTP/2 fingerprint used by Akamai-style bot detection. This
 * module parses one or more captured HTTP/2 frames and reduces them to a stable
 * canonical string + sha256 hash.
 *
 * Design note (reverse-engineering neutrality): the structured fields are
 * authoritative. The canonical string follows the widely-documented Akamai
 * convention (`<settings>|<window_update>|<priority>`); callers comparing
 * against a proprietary fingerprint DB should re-serialize from the structured
 * fields rather than assume hash compatibility.
 */

// RFC 7540 §3.5 connection preface magic: "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n" (24 bytes).
const H2_PREFACE_MAGIC_HEX = '505249202a20485454502f322e300d0a0d0a534d0d0a0d0a';
const H2_PREFACE_MAGIC_BYTES = 24;
const H2_FRAME_HEADER_BYTES = 9;

// RFC 7540 §6.3 PRIORITY frame type code. Deprecated in RFC 9113 but still sent
// by many clients; not in the buildable/parseable SupportedHttp2FrameType union,
// so it surfaces as a 'RAW' parsed frame and is decoded inline here.
const HTTP2_FRAME_TYPE_PRIORITY = 0x2;

// SETTINGS ACK flag bit (RFC 7540 §6.5.1).
const SETTINGS_ACK_FLAG = 0x1;

export interface Http2PriorityInfo {
  /** Stream ID this PRIORITY frame applies to (from the frame header). */
  streamId: number;
  /** Exclusive dependency flag (RFC 7540 §6.3). */
  exclusive: boolean;
  /** Stream ID this stream depends on. */
  dependsOn: number;
  /** Raw weight byte (0-255); actual weight = value + 1. */
  weight: number;
}

export interface Http2FingerprintResult {
  /** Akamai-style canonical string: `<settings>|<window_update>|<priority>`. */
  canonical: string;
  /** sha256(canonical) as full 64-char lowercase hex. */
  hash: string;
  /** SETTINGS entries in captured wire order (absent settings omitted — their absence is the signal). */
  settings: Http2SettingsEntry[];
  /** Stream-0 WINDOW_UPDATE increment, or null if absent. */
  windowUpdateIncrement: number | null;
  /** PRIORITY frames in capture order. */
  priorities: Http2PriorityInfo[];
  /** Number of frames parsed. */
  frameCount: number;
  /** Whether the 24-byte connection preface magic was detected and skipped. */
  prefaceSkipped: boolean;
  /** Non-fatal issues (truncated trailing frame, malformed priority, ...). */
  warnings: string[];
}

function normalizeHex(value: string): string {
  return value.replace(/\s+/g, '').trim().toLowerCase();
}

/**
 * Parse a hex blob containing one or more concatenated HTTP/2 frames into
 * individual parsed frames. If the blob begins with the 24-byte connection
 * preface magic (RFC 7540 §3.5), it is detected and skipped.
 *
 * Trailing malformed/truncated bytes do not abort parsing of the frames already
 * consumed — a warning is pushed instead (analysis-friendly: a corrupt capture
 * still yields the fingerprintable leading frames).
 */
export function parseHttp2Frames(frameHex: string): {
  frames: ParsedHttp2Frame[];
  prefaceSkipped: boolean;
  warnings: string[];
} {
  const normalized = normalizeHex(frameHex);
  const warnings: string[] = [];
  if (normalized.length === 0) {
    throw new Error('frameHex must be a non-empty hexadecimal string');
  }
  if (normalized.length % 2 !== 0 || !/^[0-9a-f]+$/.test(normalized)) {
    throw new Error('frameHex must be an even-length hexadecimal string');
  }

  const totalBytes = normalized.length / 2;
  let offset = 0;
  let prefaceSkipped = false;

  // Detect & skip the connection preface magic.
  if (
    totalBytes >= H2_PREFACE_MAGIC_BYTES &&
    normalized.slice(0, H2_PREFACE_MAGIC_BYTES * 2) === H2_PREFACE_MAGIC_HEX
  ) {
    offset = H2_PREFACE_MAGIC_BYTES;
    prefaceSkipped = true;
  }

  const frames: ParsedHttp2Frame[] = [];
  let broke = false;
  while (offset * 2 + H2_FRAME_HEADER_BYTES * 2 <= normalized.length) {
    const remainingHex = normalized.slice(offset * 2);
    // Read the payload length from the 3-byte big-endian length prefix to know
    // how many bytes this frame occupies before handing off to parseHttp2Frame.
    const remainingBytes = remainingHex.length / 2;
    const payloadLength =
      (Number.parseInt(remainingHex.slice(0, 2), 16) << 16) |
      (Number.parseInt(remainingHex.slice(2, 4), 16) << 8) |
      Number.parseInt(remainingHex.slice(4, 6), 16);

    if (remainingBytes < H2_FRAME_HEADER_BYTES + payloadLength) {
      warnings.push(
        `trailing frame at byte offset ${String(offset)} declares ${String(payloadLength)} payload bytes but only ${String(remainingBytes - H2_FRAME_HEADER_BYTES)} remain; stopped`,
      );
      broke = true;
      break;
    }

    const frameByteLength = H2_FRAME_HEADER_BYTES + payloadLength;
    const singleHex = remainingHex.slice(0, frameByteLength * 2);
    try {
      frames.push(parseHttp2Frame(singleHex));
    } catch (error) {
      warnings.push(
        `frame at byte offset ${String(offset)} failed to parse: ${error instanceof Error ? error.message : String(error)}; stopped`,
      );
      broke = true;
      break;
    }
    offset += frameByteLength;
  }

  // Bytes left after the last complete frame that are too few to form a header
  // (the loop condition never let us enter). Surface them so a corrupt capture
  // is visible rather than silently dropped.
  if (!broke) {
    const leftoverBytes = normalized.length / 2 - offset;
    if (leftoverBytes > 0) {
      warnings.push(`trailing ${String(leftoverBytes)} bytes after last complete frame; ignored`);
    }
  }

  if (frames.length === 0 && warnings.length === 0) {
    warnings.push('no complete HTTP/2 frame header found in input');
  }

  return { frames, prefaceSkipped, warnings };
}

/**
 * Decode a 5-byte PRIORITY payload (RFC 7540 §6.3). The streamId comes from the
 * enclosing frame header, not the payload. Returns null (with no throw) if the
 * payload is malformed.
 */
export function parsePriorityPayload(
  payloadHex: string,
  streamId: number,
): Http2PriorityInfo | null {
  const buf = Buffer.from(payloadHex, 'hex');
  if (buf.length < 5) {
    return null;
  }
  const dependencyWord = buf.readUInt32BE(0);
  return {
    streamId,
    exclusive: (dependencyWord & 0x80_00_00_00) !== 0,
    dependsOn: dependencyWord & 0x7f_ff_ff_ff,
    weight: buf[4]!,
  };
}

/**
 * Reduce parsed HTTP/2 frames into an Akamai-style fingerprint.
 *
 * - SETTINGS: the first non-ACK SETTINGS frame contributes its entries (wire
 *   order preserved). Absent settings are omitted — which settings a client
 *   chose to send is itself the fingerprint signal.
 * - WINDOW_UPDATE: the first stream-0 WINDOW_UPDATE increment.
 * - PRIORITY: every PRIORITY frame (type 0x2), decoded, in capture order.
 */
export function computeHttp2Fingerprint(frames: ParsedHttp2Frame[]): Http2FingerprintResult {
  const warnings: string[] = [];

  const settingsFrame = frames.find(
    (f) => f.frameType === 'SETTINGS' && (f.flags & SETTINGS_ACK_FLAG) === 0,
  );
  const settings = settingsFrame?.settings ?? [];

  const windowUpdateFrame = frames.find((f) => f.frameType === 'WINDOW_UPDATE' && f.streamId === 0);
  const windowUpdateIncrement = windowUpdateFrame?.windowSizeIncrement ?? null;

  const priorities: Http2PriorityInfo[] = [];
  for (const frame of frames) {
    if (frame.typeCode !== HTTP2_FRAME_TYPE_PRIORITY) {
      continue;
    }
    const decoded = parsePriorityPayload(frame.payloadHex, frame.streamId);
    if (decoded === null) {
      warnings.push(
        `PRIORITY frame on stream ${String(frame.streamId)} has malformed payload (${String(frame.payloadBytes)} bytes); skipped`,
      );
      continue;
    }
    priorities.push(decoded);
  }

  const settingsPart = settings.map((s) => `${String(s.id)}:${String(s.value)}`).join(';');
  const windowUpdatePart = windowUpdateIncrement === null ? '' : String(windowUpdateIncrement);
  const priorityPart = priorities.map((p) => `${String(p.streamId)}:${String(p.weight)}`).join(',');
  const canonical = `${settingsPart}|${windowUpdatePart}|${priorityPart}`;
  const hash = createHash('sha256').update(canonical).digest('hex');

  return {
    canonical,
    hash,
    settings,
    windowUpdateIncrement,
    priorities,
    frameCount: frames.length,
    prefaceSkipped: false,
    warnings,
  };
}
