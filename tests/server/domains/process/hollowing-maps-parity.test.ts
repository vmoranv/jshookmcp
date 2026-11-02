/**
 * Parity contract between the two /proc/pid/maps parsers.
 *
 * Documents the ACTUAL divergence between
 * `@native/platform/linux/mapsParser` (strict, for real /proc content) and
 * `hollowing-scan.ts` (tolerant variant for caller-pasted text), so any
 * convergence attempt must consciously preserve or change each difference.
 */
import { describe, expect, it } from 'vitest';

import { parseProcMaps as parseNative } from '@native/platform/linux/mapsParser';
import { parseProcMaps as parseHollowing } from '@server/domains/process/handlers/hollowing-scan';

const WELL_FORMED = '7f0000000000-7f0000001000 rwxp 00000000 00:00 0';
const WITH_PATH = '7f0000000000-7f0000001000 r-xp 00000000 fd:01 1234 /usr/lib/libc.so';
const FOURTH_FLAG = '7f0000000000-7f0000001000 rw-p 00000000 00:00 0';
const SHORT_PERMS = '7f0000000000-7f0000001000 r--  00000000 00:00 0 [vvar]';
const GARBAGE = 'not a maps line';

describe('/proc/pid/maps parser parity', () => {
  it('agrees on well-formed RWX input', () => {
    expect(parseNative(WELL_FORMED)).toHaveLength(1);
    expect(parseHollowing(WELL_FORMED)).toHaveLength(1);
  });

  it('agrees on pathname extraction', () => {
    expect(parseNative(WITH_PATH)[0]?.pathname).toBe('/usr/lib/libc.so');
    expect(parseHollowing(WITH_PATH)[0]?.pathname).toBe('/usr/lib/libc.so');
  });

  it('agrees on rejecting short permission strings', () => {
    expect(parseNative(SHORT_PERMS)).toHaveLength(0);
    expect(parseHollowing(SHORT_PERMS)).toHaveLength(0);
  });

  it('agrees on dropping garbage and empty input', () => {
    expect(parseNative(GARBAGE)).toHaveLength(0);
    expect(parseHollowing(GARBAGE)).toHaveLength(0);
    expect(parseNative('')).toHaveLength(0);
    expect(parseHollowing('')).toHaveLength(0);
  });

  // ── Remaining divergences (pinned so convergence can't change them silently)

  it('agrees on 4-char permission fields (rw-p)', () => {
    // Regression: the hollowing parser used to require an 'x' in position 3
    // and a lowercase-hex dev field, so it dropped ~100% of real
    // /proc/<pid>/maps lines. Both parsers now accept the kernel's shape.
    expect(parseNative(FOURTH_FLAG)).toHaveLength(1);
    expect(parseHollowing(FOURTH_FLAG)).toHaveLength(1);
  });

  it('agrees on uppercase hex device numbers', () => {
    const line = '00020000-00023000 r--s 00000000 0BC4:D8AA 281474976762117 /x.dll';
    expect(parseNative(line)).toHaveLength(1);
    expect(parseHollowing(line)).toHaveLength(1);
  });

  it('divergence: address type is bigint (native) vs string (hollowing)', () => {
    expect(typeof parseNative(WELL_FORMED)[0]?.start).toBe('bigint');
    expect(typeof parseHollowing(WELL_FORMED)[0]?.start).toBe('string');
  });

  it('divergence: permissions are structured (native) vs raw string (hollowing)', () => {
    expect(parseNative(WELL_FORMED)[0]?.permissions).toEqual({
      read: true,
      write: true,
      exec: true,
      private: true,
    });
    expect(parseHollowing(WELL_FORMED)[0]?.perms).toBe('rwxp');
  });
});
