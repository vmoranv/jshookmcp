/**
 * Tests for the exported Flutter stdlib whitelist + SDK snapshot marker.
 *
 * The package set and version marker must be importable by downstream
 * modules (e.g. future tooling that reports which SDK the whitelist was
 * reviewed against), not kept module-local to PackageDetector.
 */
import { describe, expect, it } from 'vitest';

import {
  SDK_SNAPSHOT_VERSION,
  FLUTTER_STDLIB_PACKAGES,
  isStdlibPackage,
} from '@modules/dart-inspector/flutter-stdlib-packages';

const EXPORTED_AS_EXPECTED = SDK_SNAPSHOT_VERSION === '3.24.x';

describe('flutter-stdlib-packages exports', () => {
  it('exports SDK_SNAPSHOT_VERSION pinned to the reviewed Flutter release', () => {
    expect(EXPORTED_AS_EXPECTED).toBe(true);
    expect(SDK_SNAPSHOT_VERSION).toBe('3.24.x');
  });

  it('exports a non-empty, frozen set of stdlib package names', () => {
    expect(FLUTTER_STDLIB_PACKAGES).toBeInstanceOf(Set);
    expect(FLUTTER_STDLIB_PACKAGES.size).toBeGreaterThan(0);
    expect(Object.isFrozen(FLUTTER_STDLIB_PACKAGES)).toBe(true);
  });

  it('keeps the curated first-party packages in the exported set', () => {
    for (const name of ['flutter', 'sky_engine', 'io', 'flutter_test'] as const) {
      expect(FLUTTER_STDLIB_PACKAGES.has(name)).toBe(true);
    }
    expect(FLUTTER_STDLIB_PACKAGES.has('dio')).toBe(false);
    expect(FLUTTER_STDLIB_PACKAGES.has('my_corp_base')).toBe(false);
  });

  it('does not classify real pub.dev packages as stdlib', () => {
    for (const name of [
      'async',
      'collection',
      'convert',
      'ffi',
      'isolate',
      'js',
      'typed_data',
    ] as const) {
      expect(FLUTTER_STDLIB_PACKAGES.has(name)).toBe(false);
      expect(isStdlibPackage(name)).toBe(false);
    }
  });

  it('isStdlibPackage still consults the exported set', () => {
    expect(isStdlibPackage('flutter')).toBe(true);
    expect(isStdlibPackage('dio')).toBe(false);
    expect(isStdlibPackage('my_corp_base', new Set(['my_corp_base']))).toBe(true);
  });
});
