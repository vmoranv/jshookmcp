import { describe, expect, it } from 'vitest';
import { CryptoDetector } from '../../../src/modules/crypto/CryptoDetector.js';

describe('CryptoDetector', () => {
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

  it('merges AI results when AI detection is enabled', async () => {
    const detector = new CryptoDetector({
      chat: async () => ({
        content:
          '{"algorithms":[{"name":"AIHash","type":"hash","confidence":0.92,"usage":"from model"}]}',
      }),
    } as any);

    const result = await detector.detect({ code: 'const x = 1;' } as any);
    expect(result.algorithms.some((a) => a.name === 'AIHash')).toBe(true);
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
      })
    );

    const result = await detector.detect({ code: 'const algo = "MY_HASH_X";', useAI: false } as any);
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
});

