// Supply-chain security contract: pnpm overrides that pin a transitive
// dependency to a CVE-patched floor must not silently regress, and the
// committed lockfile must actually resolve to a patched version.
//
// Guards Dependabot alerts #57-#60 (hono < 4.12.21):
//   - CVE-2026-47673 (GHSA-f577-qrjj-4474) JWT middleware accepts any auth scheme
//   - CVE-2026-47674 (GHSA-xrhx-7g5j-rcj5) IP restriction bypass for non-canonical IPv6
//   - CVE-2026-47676 (GHSA-2gcr-mfcq-wcc3) app.mount() strips prefix from undecoded path
//   - CVE-2026-47675 (GHSA-3hrh-pfw6-9m5x) cookie helper Set-Cookie injection
// All four are fixed in hono 4.12.21. hono reaches us transitively via
// @modelcontextprotocol/sdk (HTTP transport), so a pnpm override is the fix.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Parse "1.2.3" into a comparable tuple; non-semver tokens throw. */
function parseSemver(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) throw new Error(`Unparseable semver: "${version}"`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Returns true when `version` >= `floor` (patch-level precision). */
function gte(version: string, floor: string): boolean {
  const a = parseSemver(version);
  const b = parseSemver(floor);
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return true;
}

// The CVE-patched floor for hono (Dependabot #57-#60).
const HONO_PATCHED_FLOOR = '4.12.21';

describe('security overrides — hono CVE pin (Dependabot #57-#60)', () => {
  it('package.json pins hono override at or above the patched floor', () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
    const overrides: Record<string, string> = pkg?.pnpm?.overrides ?? {};
    const honoOverride = overrides.hono;

    expect(honoOverride, 'pnpm.overrides.hono must exist to keep hono patched').toBeTruthy();

    // Override is a range like ">=4.12.21"; parseSemver reads the floor token.
    // String() keeps the type narrow under noUncheckedIndexedAccess — the expect
    // above already fails the test before this runs when the override is absent.
    const floor = String(honoOverride).replace(/^[^\d]*/, '');
    expect(
      gte(floor, HONO_PATCHED_FLOOR),
      `hono override "${honoOverride}" must be >= ${HONO_PATCHED_FLOOR}`,
    ).toBe(true);
  });

  it('pnpm-lock.yaml resolves every hono instance at or above the patched floor', () => {
    const lock = readFileSync(resolve(repoRoot, 'pnpm-lock.yaml'), 'utf8');

    // Resolved versions appear as snapshot/peer keys "hono@X.Y.Z" and as
    // dependency entries "hono: X.Y.Z". The override echo (e.g. "hono: '>=4.12.21'")
    // is intentionally NOT matched here — a quote/range follows the colon.
    const resolved = new Set<string>();
    for (const m of lock.matchAll(/hono@(\d+\.\d+\.\d+)/g)) resolved.add(m[1]!);
    for (const m of lock.matchAll(/\bhono:\s+(\d+\.\d+\.\d+)/g)) resolved.add(m[1]!);

    expect(
      resolved.size,
      'expected at least one resolved hono version in lockfile',
    ).toBeGreaterThan(0);

    const vulnerable = [...resolved].filter((v) => !gte(v, HONO_PATCHED_FLOOR));
    expect(
      vulnerable,
      `lockfile resolves vulnerable hono version(s): ${vulnerable.join(', ')} (need >= ${HONO_PATCHED_FLOOR})`,
    ).toEqual([]);
  });
});
