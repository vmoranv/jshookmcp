import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as parser from '@babel/parser';
import { CryptoRulesManager } from '@modules/crypto/CryptoRules';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import { CryptoDetector } from '@modules/crypto/CryptoDetector';

describe('CryptoDetector', () => {
  beforeEach(() => {
    Object.values(loggerState).forEach((fn) => (fn as any).mockReset?.());
  });

  it('detects algorithms, libraries and security issues without AI', async () => {
    const detector = new CryptoDetector({ chat: async () => ({ content: '{}' }) } as any);
    const code = `
      const algo = "MD5";
      const encrypted = CryptoJS.AES.encrypt("text", "key");
      console.log(encrypted, algo);
    `;

    const result = await detector.detect({ code, useAI: false } as any);

    expect(result.algorithms.some((a) => a.name === 'AES')).toBe(true);
    expect(result.algorithms.some((a) => a.name === 'MD5')).toBe(true);
    expect(result.libraries.some((lib) => lib.name === 'CryptoJS')).toBe(true);
    expect(result.securityIssues?.some((issue) => issue.algorithm === 'MD5')).toBe(true);
    expect(result.strength?.score).toBeLessThan(100);
  });

  it('ignores legacy AI dependencies and keeps rule-based results', async () => {
    const legacy = {
      chat: vi.fn(async () => ({
        content:
          '{"algorithms":[{"name":"AIHash","type":"hash","confidence":0.92,"usage":"from model"}]}',
      })),
    } as any;
    const detector = new CryptoDetector(legacy);

    const result = await detector.detect({ code: 'const x = 1;' } as any);
    expect(result.algorithms).toEqual([]);
    expect(legacy.chat).not.toHaveBeenCalled();
  });

  it('handles malformed AI output gracefully', async () => {
    const detector = new CryptoDetector({
      chat: async () => ({ content: 'not-json-at-all' }),
    } as any);

    const result = await detector.detect({ code: 'const x = 1;' } as any);
    expect(result.algorithms.some((a) => a.name === 'Unknown')).toBe(false);
  });

  it('handles AI provider failures without throwing', async () => {
    const detector = new CryptoDetector({
      chat: async () => {
        throw new Error('provider down');
      },
    } as any);

    await expect(detector.detect({ code: 'const y = SHA256;' } as any)).resolves.toMatchObject({
      algorithms: expect.any(Array),
      libraries: expect.any(Array),
    });
  });

  it('supports loading custom keyword rules and detecting them', async () => {
    const detector = new CryptoDetector({ chat: async () => ({ content: '{}' }) } as any);
    detector.loadCustomRules(
      JSON.stringify({
        keywords: [{ category: 'hash', keywords: ['MY_HASH_X'], confidence: 0.88 }],
      }),
    );

    const result = await detector.detect({
      code: 'const algo = "MY_HASH_X";',
      useAI: false,
    } as any);
    expect(result.algorithms.some((a) => a.name === 'MY_HASH_X')).toBe(true);
  });

  it('exports rules as valid JSON string', () => {
    const detector = new CryptoDetector({ chat: async () => ({ content: '{}' }) } as any);
    const rules = detector.exportRules();
    const parsed = JSON.parse(rules);
    expect(parsed).toHaveProperty('keywords');
    expect(parsed).toHaveProperty('libraries');
    expect(parsed).toHaveProperty('constants');
  });

  it('detects AST-based crypto patterns and keeps the highest-confidence merge', () => {
    const detector = new CryptoDetector({ chat: async () => ({ content: '{}' }) } as any);
    const sboxValues = Array.from({ length: 256 }, (_, i) => i).join(', ');
    const code = `
      const sbox = [${sboxValues}];
      function checksum(data) {
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          sum ^= data[i];
        }
        return sum >>> 0;
      }
      bigNumber.modPow(2, 3);
    `;

    const astResults = (detector as any).detectByAST(code);
    expect(astResults.algorithms.some((algo: any) => algo.name === 'Custom Symmetric Cipher')).toBe(
      true,
    );
    expect(astResults.algorithms.some((algo: any) => algo.name === 'Asymmetric Encryption')).toBe(
      true,
    );
    expect(astResults.algorithms.some((algo: any) => algo.name === 'Custom Hash Function')).toBe(
      true,
    );

    const merged = (detector as any).mergeResults([
      {
        name: 'AES',
        type: 'symmetric',
        confidence: 0.2,
        location: { file: 'current', line: 1 },
        usage: 'low',
      },
      {
        name: 'AES',
        type: 'symmetric',
        confidence: 0.9,
        location: { file: 'current', line: 2 },
        usage: 'high',
      },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.confidence).toBe(0.9);
  });

  it('scores strength across all penalty buckets', () => {
    const detector = new CryptoDetector({ chat: async () => ({ content: '{}' }) } as any);
    const strength = (detector as any).analyzeStrength(
      [],
      [
        { severity: 'critical', issue: 'broken algorithm', recommendation: '' },
        { severity: 'high', issue: 'weak key size', recommendation: '' },
        { severity: 'medium', issue: 'legacy mode', recommendation: '' },
        { severity: 'low', issue: 'implementation detail', recommendation: '' },
      ],
    );

    expect(strength.overall).toBe('moderate');
    expect(strength.factors.algorithm).toBeLessThan(100);
    expect(strength.factors.keySize).toBeLessThan(100);
    expect(strength.factors.mode).toBeLessThan(100);
    expect(strength.factors.implementation).toBeLessThan(100);
  });

  it('ignores mode and padding keywords while still extracting real crypto parameters', async () => {
    const detector = new CryptoDetector({ chat: async () => ({ content: '{}' }) } as any);
    const code = `
      CryptoJS.version = "4.2.0";
      const payload = CryptoJS.AES.encrypt("text", "key", {
        mode: "CBC",
        padding: "Pkcs7",
        keySize: 256,
      });
      const subtle = crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array([1]) }, payload);
      const mode = "CBC";
      const padding = "PKCS7";
    `;

    const keywordResults = (detector as any).detectByKeywords(code);
    expect(keywordResults.some((algo: any) => algo.name === 'CBC')).toBe(false);
    expect(keywordResults.some((algo: any) => algo.name === 'PKCS7')).toBe(false);

    const result = await detector.detect({ code } as any);

    const aes = result.algorithms.find((algo) => algo.name === 'AES');
    expect(aes?.parameters).toMatchObject({
      mode: 'CBC',
      padding: 'Pkcs7',
      keySize: 256,
    });
    expect(result.libraries.some((lib) => lib.name === 'CryptoJS' && lib.version === '4.2.0')).toBe(
      true,
    );
    expect(result.libraries.some((lib) => lib.name === 'Web Crypto API')).toBe(true);
  });

  it('handles AST parser failures and strength extremes', () => {
    const detector = new CryptoDetector({ chat: async () => ({ content: '{}' }) } as any);
    const parseSpy = vi.spyOn(parser, 'parse').mockImplementation(() => {
      throw new Error('parse failed');
    });

    const ast = (detector as any).detectByAST('const x = 1;');
    expect(ast.algorithms).toEqual([]);
    expect(ast.parameters.size).toBe(0);

    const strong = (detector as any).analyzeStrength([], []);
    expect(strong.overall).toBe('strong');

    const broken = (detector as any).analyzeStrength(
      [],
      [
        { severity: 'critical', issue: 'broken algorithm', recommendation: '' },
        { severity: 'critical', issue: 'broken algorithm', recommendation: '' },
        { severity: 'critical', issue: 'weak key size', recommendation: '' },
        { severity: 'critical', issue: 'weak key size', recommendation: '' },
        { severity: 'critical', issue: 'legacy mode', recommendation: '' },
        { severity: 'critical', issue: 'legacy mode', recommendation: '' },
        { severity: 'critical', issue: 'implementation detail', recommendation: '' },
        { severity: 'critical', issue: 'implementation detail', recommendation: '' },
      ],
    );
    expect(broken.overall).toBe('broken');
    expect(broken.score).toBeLessThan(40);

    parseSpy.mockRestore();
  });

  it('covers custom rule loading, missing line numbers, weak strength and crypto.subtle parameter parsing', async () => {
    const detector = new CryptoDetector({ chat: async () => ({ content: '{}' }) } as any);

    detector.loadCustomRules(
      JSON.stringify({
        keywords: [{ category: 'hash', keywords: ['MY_HASH_X'], confidence: 0.88 }],
      }),
    );

    const exported = JSON.parse(detector.exportRules());
    expect(exported.keywords).toBeDefined();

    expect((detector as any).findLineNumber('alpha\nbeta', 'gamma')).toBe(0);

    const weak = (detector as any).analyzeStrength(
      [],
      [
        { severity: 'critical', issue: 'broken algorithm', recommendation: '' },
        { severity: 'critical', issue: 'weak key size', recommendation: '' },
        { severity: 'critical', issue: 'legacy mode', recommendation: '' },
        { severity: 'critical', issue: 'implementation detail', recommendation: '' },
        { severity: 'critical', issue: 'implementation detail', recommendation: '' },
      ],
    );
    expect(weak.overall).toBe('weak');

    const astResults = (detector as any).detectByAST(`
      crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    `);
    expect(astResults.parameters.get('AES-GCM')).toMatchObject({
      name: 'AES-GCM',
      length: 256,
    });
  });

  it('keeps the highest-confidence result and logs detect failures', async () => {
    const detector = new CryptoDetector({ chat: async () => ({ content: '{}' }) } as any);

    const merged = (detector as any).mergeResults([
      {
        name: 'AES',
        type: 'symmetric',
        confidence: 0.9,
        location: { file: 'current', line: 1 },
        usage: 'high',
      },
      {
        name: 'AES',
        type: 'symmetric',
        confidence: 0.2,
        location: { file: 'current', line: 2 },
        usage: 'low',
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.confidence).toBe(0.9);

    vi.spyOn(detector as any, 'detectByKeywords').mockImplementation(() => {
      throw new Error('forced failure');
    });

    await expect(detector.detect({ code: 'const x = 1;' } as any)).rejects.toThrow(
      /forced failure/,
    );
    expect(loggerState.error).toHaveBeenCalledWith(
      expect.stringContaining('Crypto detection failed'),
      expect.any(Error),
    );
  });

  it('maps constant rules with type other to encoding algorithms', () => {
    const rules = new CryptoRulesManager();
    rules.addConstantRule({
      name: 'Legacy Encoding Table',
      type: 'other',
      values: [1, 2, 3, 4],
      confidence: 0.61,
    } as any);

    const detector = new CryptoDetector({ chat: async () => ({ content: '{}' }) } as any, rules);
    const astResults = (detector as any).detectByAST(`
      const legacy = [1, 2, 3, 4, 9];
    `);

    expect(astResults.algorithms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Legacy Encoding Table',
          type: 'encoding',
        }),
      ]),
    );
  });
});
