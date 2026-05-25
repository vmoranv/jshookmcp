/**
 * Tests for the built-in apk-packer fingerprint database.
 *
 * These tests validate the *shape* of every entry in DEFAULT_SIGNATURES
 * so a typo in a new entry surfaces immediately. They do not load any
 * APK binary — fingerprints are purely declarative.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SIGNATURES } from '@modules/apk-packer/fingerprints';

describe('DEFAULT_SIGNATURES', () => {
  it('contains at least 16 vendor entries (the documented baseline)', () => {
    expect(DEFAULT_SIGNATURES.length).toBeGreaterThanOrEqual(16);
  });

  it('every entry has non-empty name, vendor, and libPatterns', () => {
    for (const sig of DEFAULT_SIGNATURES) {
      expect(typeof sig.name).toBe('string');
      expect(sig.name.length).toBeGreaterThan(0);
      expect(typeof sig.vendor).toBe('string');
      expect(sig.vendor.length).toBeGreaterThan(0);
      expect(Array.isArray(sig.libPatterns)).toBe(true);
      expect(sig.libPatterns.length).toBeGreaterThan(0);
    }
  });

  it('every libPattern is either a string or a RegExp', () => {
    for (const sig of DEFAULT_SIGNATURES) {
      for (const pat of sig.libPatterns) {
        const isStr = typeof pat === 'string';
        const isRe = pat instanceof RegExp;
        expect(isStr || isRe).toBe(true);
      }
    }
  });

  it('string libPatterns are lowercase (matcher lowercases inputs)', () => {
    for (const sig of DEFAULT_SIGNATURES) {
      for (const pat of sig.libPatterns) {
        if (typeof pat === 'string') {
          expect(pat).toBe(pat.toLowerCase());
        }
      }
    }
  });

  it('covers the documented canonical vendors', () => {
    const vendors = new Set(DEFAULT_SIGNATURES.map((s) => s.vendor.toLowerCase()));
    const required = [
      'qihoo',
      'tencent',
      'bangcle',
      'ijiami',
      'baidu',
      'alibaba',
      'netease',
      'guardsquare',
      'licel',
      'inka entworks',
      'senseshield',
      'apkprotect',
      'naga',
      'kiwi',
      'upx',
    ];
    for (const r of required) expect(vendors).toContain(r);
  });

  it('object is frozen (cannot be mutated by callers)', () => {
    expect(Object.isFrozen(DEFAULT_SIGNATURES)).toBe(true);
  });

  it('contains canonical Jiagu fingerprint', () => {
    const jiagu = DEFAULT_SIGNATURES.find((s) => /jiagu/i.test(s.name));
    expect(jiagu).toBeDefined();
    expect(jiagu!.libPatterns).toContain('libjiagu.so');
  });

  it('contains canonical Tencent Legu fingerprints', () => {
    const legu = DEFAULT_SIGNATURES.find((s) => s.name === 'Tencent Legu');
    expect(legu).toBeDefined();
    expect(legu!.libPatterns).toContain('libshell.so');
  });
});
