/**
 * Structured error attributes for the `tool.execute` span.
 *
 * The old end-attribute was the truncated MESSAGE
 * (`net::ERR_CONNECTION_TIMED_OUT at https://app.voicecreator.pro/tts/generate`).
 * That put a customer's target URL into the telemetry database and still left
 * the failure unclassifiable downstream, because the field had no structure.
 *
 * This module produces the structured replacement — `error_class` plus
 * `error_fingerprint`, a short hash of the message with URLs, paths, addresses
 * and digits masked. The fingerprint groups "same bug, different target" while
 * carrying none of them, so a failure profile can rank clusters without storing
 * anything identifying.
 */
import { createHash } from 'node:crypto';

/** How much of the message is hashed. Long stacks add no grouping value. */
const FINGERPRINT_INPUT_LIMIT = 160;
const FINGERPRINT_HEX_CHARS = 8;

/**
 * Normalize a failure message into a grouping key.
 *
 * Masked: URLs (host + path), absolute paths, hex addresses, and runs of
 * digits. Those are exactly the parts that differ between two occurrences of
 * one bug, and exactly the parts that carry user data.
 */
export function normalizeFailureMessage(message: string): string {
  return (
    message
      .replace(/https?:\/\/\S+/gi, '<url>')
      // Drive-letter paths with either separator: `D:\chrome\chrome.exe` and
      // `D:/chrome/chrome.exe` are the same leak.
      .replace(/[A-Za-z]:[\\/][^\s'"]+/g, '<path>')
      .replace(/(?:^|[\s'"(])\/(?:[^\s'"/]+\/)+[^\s'")]*/g, ' <path>')
      .replace(/0x[0-9a-f]+/gi, '<addr>')
      .replace(/\d+/g, '<n>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, FINGERPRINT_INPUT_LIMIT)
  );
}

/** Stable short hash of the normalized message; `null` for an empty message. */
export function failureFingerprint(message: string | null | undefined): string | null {
  if (typeof message !== 'string') return null;
  const normalized = normalizeFailureMessage(message);
  if (normalized.length === 0) return null;
  return createHash('sha256').update(normalized).digest('hex').slice(0, FINGERPRINT_HEX_CHARS);
}

/**
 * Span end-attributes for a failed call.
 *
 * `error_class` is the classified kind (or `unclassified` when the pipeline
 * could not name a cause) rather than the raw message, so the attribute is
 * safe on any telemetry backend. The message itself never leaves the process.
 */
export function failureSpanAttrs(
  kind: string | undefined,
  message: string | null | undefined,
): Record<string, unknown> {
  const fingerprint = failureFingerprint(message);
  return {
    ok: false,
    error_class: kind ?? 'unclassified',
    ...(fingerprint !== null ? { error_fingerprint: fingerprint } : {}),
  };
}
