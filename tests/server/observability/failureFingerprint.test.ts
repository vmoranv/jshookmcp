/**
 * Failure fingerprints: group "same bug, different target" without shipping
 * the target.
 *
 * The old `error` span attribute carried the raw message, which in practice
 * meant customer URLs (`net::ERR_* at https://…`) and absolute paths landed in
 * the telemetry database. These tests pin the two properties that make the
 * replacement usable: normalization erases the identifying parts, and equal
 * bugs still produce equal hashes.
 */
import { describe, expect, it } from 'vitest';
import {
  failureFingerprint,
  failureSpanAttrs,
  normalizeFailureMessage,
} from '@server/observability/failureFingerprint';

describe('normalizeFailureMessage', () => {
  it('masks URLs so a customer host never reaches the hash input verbatim', () => {
    const normalized = normalizeFailureMessage(
      'net::ERR_CONNECTION_TIMED_OUT at https://app.voicecreator.pro/tts/generate',
    );
    expect(normalized).not.toContain('voicecreator');
    expect(normalized).toContain('<url>');
  });

  it('masks windows and POSIX paths', () => {
    expect(normalizeFailureMessage('failed: D:/chrome/chrome.exe')).not.toContain('chrome.exe');
    expect(normalizeFailureMessage("ENOENT open '/home/u/proj/lib/app.so'")).not.toContain(
      '/home/u',
    );
  });

  it('masks addresses and numbers that differ per occurrence', () => {
    const a = normalizeFailureMessage('Unmapped memory access at 0xa21c18 (len 160)');
    const b = normalizeFailureMessage('Unmapped memory access at 0xa01aa0 (len 32)');
    expect(a).toBe(b);
    expect(a).not.toMatch(/0x[0-9a-f]/i);
  });
});

describe('failureFingerprint', () => {
  it('gives the SAME fingerprint to one bug seen through two targets', () => {
    const a = failureFingerprint('net::ERR_CONNECTION_TIMED_OUT at https://a.example/x');
    const b = failureFingerprint('net::ERR_CONNECTION_TIMED_OUT at https://b.example/y');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it('gives DIFFERENT fingerprints to different bugs', () => {
    expect(failureFingerprint('Execution context was destroyed')).not.toBe(
      failureFingerprint('Navigation timeout of 30000 ms exceeded'),
    );
  });

  it('returns null for an absent or empty message', () => {
    expect(failureFingerprint(undefined)).toBeNull();
    expect(failureFingerprint('')).toBeNull();
    expect(failureFingerprint('   ')).toBeNull();
  });
});

describe('failureSpanAttrs', () => {
  it('reports ok:false, a class, and never the message', () => {
    const attrs = failureSpanAttrs('network', 'net::ERR at https://secret.example/path');
    expect(attrs).toEqual({
      ok: false,
      error_class: 'network',
      error_fingerprint: expect.stringMatching(/^[0-9a-f]{8}$/),
    });
    expect(JSON.stringify(attrs)).not.toContain('secret');
  });

  it('falls back to unclassified when the pipeline named no cause', () => {
    expect(failureSpanAttrs(undefined, 'boom')).toMatchObject({ error_class: 'unclassified' });
  });

  it('omits the fingerprint when there is no message to group', () => {
    expect(failureSpanAttrs('timeout', null)).toEqual({ ok: false, error_class: 'timeout' });
  });
});
