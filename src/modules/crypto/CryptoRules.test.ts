import { describe, expect, it } from 'vitest';
import { CryptoRulesManager } from './CryptoRules.js';

describe('CryptoRulesManager', () => {
  it('loads default keyword/library/constant/security rules', () => {
    const manager = new CryptoRulesManager();
    expect(manager.getKeywordRules().length).toBeGreaterThan(0);
    expect(manager.getLibraryRules().some((r) => r.name === 'CryptoJS')).toBe(true);
    expect(manager.getConstantRules().some((r) => r.name === 'SHA256')).toBe(true);
    expect(manager.getSecurityRules().some((r) => r.name === 'weak-md5')).toBe(true);
  });

  it('supports adding pattern rules', () => {
    const manager = new CryptoRulesManager();
    manager.addPatternRule({
      name: 'custom-regex',
      type: 'hash',
      pattern: { type: 'regex', matcher: /sha3/i },
      confidence: 0.7,
    });

    expect(manager.getPatternRules().some((r) => r.name === 'custom-regex')).toBe(true);
  });

  it('can load additional rules from JSON', () => {
    const manager = new CryptoRulesManager();
    const json = JSON.stringify({
      keywords: [{ category: 'other', keywords: ['FOO_CIPHER'], confidence: 0.5 }],
      libraries: [{ name: 'MyCryptoLib', patterns: ['my-crypto-lib'], confidence: 0.8 }],
      constants: [{ name: 'CONST_X', type: 'other', values: [1, 2, 3], confidence: 0.6 }],
    });

    manager.loadFromJSON(json);

    expect(manager.getKeywordRules().some((r) => r.keywords.includes('FOO_CIPHER'))).toBe(true);
    expect(manager.getLibraryRules().some((r) => r.name === 'MyCryptoLib')).toBe(true);
    expect(manager.getConstantRules().some((r) => r.name === 'CONST_X')).toBe(true);
  });

  it('throws a descriptive error for invalid JSON input', () => {
    const manager = new CryptoRulesManager();
    expect(() => manager.loadFromJSON('{ invalid json')).toThrow('Failed to load rules from JSON');
  });

  it('exports current ruleset as parseable JSON', () => {
    const manager = new CryptoRulesManager();
    const out = manager.exportToJSON();
    const parsed = JSON.parse(out);

    expect(Array.isArray(parsed.keywords)).toBe(true);
    expect(Array.isArray(parsed.libraries)).toBe(true);
    expect(Array.isArray(parsed.constants)).toBe(true);
    expect(Array.isArray(parsed.security)).toBe(true);
  });

  it('addKeywordRule overrides rule for same category key', () => {
    const manager = new CryptoRulesManager();
    manager.addKeywordRule({
      category: 'hash',
      keywords: ['ONLY_HASH_X'],
      confidence: 0.99,
    });

    const hashRule = manager.getKeywordRules().find((r) => r.category === 'hash');
    expect(hashRule?.keywords).toEqual(['ONLY_HASH_X']);
    expect(hashRule?.confidence).toBe(0.99);
  });
});

