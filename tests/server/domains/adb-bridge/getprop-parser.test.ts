/**
 * Tests for the getprop output parser + device fingerprint summary builder.
 *
 * `adb shell getprop` emits one property per line as `[key]: [value]`. These
 * pure functions lift that dump into a structured map and a curated device
 * fingerprint without touching the adb subprocess (CI-verifiable).
 */
import { describe, expect, it } from 'vitest';
import { buildFingerprintSummary, parseGetprop } from '@server/domains/adb-bridge/getprop-parser';

const GETPROP_FIXTURE = [
  '[ro.build.version.release]: [13]',
  '[ro.build.version.sdk]: [33]',
  '[ro.build.version.security_patch]: [2023-08-05]',
  '[ro.build.id]: [TQ3A.230805.001]',
  '[ro.build.fingerprint]: [google/oriole/oriole:13/TQ3A.230805.001/10316531:user/release-keys]',
  '[ro.build.tags]: [release-keys]',
  '[ro.build.type]: [user]',
  '[ro.product.model]: [Pixel 6]',
  '[ro.product.brand]: [google]',
  '[ro.product.manufacturer]: [Google]',
  '[ro.product.device]: [oriole]',
  '[ro.product.name]: [oriole]',
  '[ro.product.cpu.abi]: [arm64-v8a]',
  '[ro.product.cpu.abilist]: [arm64-v8a,armeabi-v7a]',
  '[ro.boot.verifiedbootstate]: [green]',
  '[ro.boot.vbmeta.device_state]: [locked]',
  '[ro.boot.flash.locked]: [1]',
  '[persist.sys.timezone]: [America/Los_Angeles]',
  '',
  '[]: []',
  '[malformed line without brackets',
].join('\n');

describe('parseGetprop', () => {
  it('parses well-formed [key]: [value] lines into entries', () => {
    const entries = parseGetprop(GETPROP_FIXTURE);
    const map = Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
    expect(map['ro.build.version.sdk']).toBe('33');
    expect(map['ro.product.cpu.abi']).toBe('arm64-v8a');
    expect(map['ro.product.cpu.abilist']).toBe('arm64-v8a,armeabi-v7a');
    expect(map['ro.build.fingerprint']).toBe(
      'google/oriole/oriole:13/TQ3A.230805.001/10316531:user/release-keys',
    );
  });

  it('preserves empty-string values (e.g. unset properties)', () => {
    const entries = parseGetprop('[ro.unset.property]: []');
    expect(entries).toEqual([{ key: 'ro.unset.property', value: '' }]);
  });

  it('skips blank lines, the bare []: [] placeholder, and malformed lines', () => {
    const entries = parseGetprop(GETPROP_FIXTURE);
    const keys = entries.map((entry) => entry.key);
    expect(keys).not.toContain('');
    expect(keys).not.toContain('malformed line without brackets');
    // 18 well-formed non-empty-key lines in the fixture
    expect(entries.length).toBe(18);
  });

  it('returns an empty array for empty input', () => {
    expect(parseGetprop('')).toEqual([]);
    expect(parseGetprop('\n  \n')).toEqual([]);
  });
});

describe('buildFingerprintSummary', () => {
  it('extracts the curated build/product/boot/security fields when present', () => {
    const entries = parseGetprop(GETPROP_FIXTURE);
    const properties = Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
    const fingerprint = buildFingerprintSummary(properties);
    expect(fingerprint).toMatchObject({
      model: 'Pixel 6',
      manufacturer: 'Google',
      brand: 'google',
      device: 'oriole',
      product: 'oriole',
      release: '13',
      sdk: '33',
      abi: 'arm64-v8a',
      abiList: 'arm64-v8a,armeabi-v7a',
      buildId: 'TQ3A.230805.001',
      buildFingerprint: 'google/oriole/oriole:13/TQ3A.230805.001/10316531:user/release-keys',
      securityPatch: '2023-08-05',
      buildTags: 'release-keys',
      buildType: 'user',
      verifiedBoot: 'green',
      bootloaderLock: 'locked',
    });
  });

  it('omits fields that are absent rather than emitting undefined', () => {
    const fingerprint = buildFingerprintSummary({ 'ro.product.model': 'Nexus' });
    expect(fingerprint).toEqual({ model: 'Nexus' });
  });

  it('returns an empty object for an empty property map', () => {
    expect(buildFingerprintSummary({})).toEqual({});
  });
});
