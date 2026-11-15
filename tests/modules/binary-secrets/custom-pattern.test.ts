/**
 * A-phase (close-descoped-behaviors): binary_key_extract customPatterns.
 * Compile-time ReDoS guards + invalid flags + runtime timeout + customCategory.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileCustomPattern, scanCustomPatterns } from '@modules/binary-secrets/custom-pattern';
import { KeyExtractor } from '@modules/binary-secrets/KeyExtractor';
import { ToolError } from '@errors/ToolError';

function tmpFile(content: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'jshook-custompat-'));
  const path = join(dir, 'blob.bin');
  writeFileSync(path, content);
  return { dir, path };
}

function expectValidation(fn: () => unknown): void {
  try {
    fn();
    throw new Error('expected ToolError(VALIDATION)');
  } catch (err) {
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe('VALIDATION');
  }
}

describe('compileCustomPattern (ReDoS + flag guards)', () => {
  it('compiles a safe pattern with a category', () => {
    const c = compileCustomPattern({ pattern: 'AKIA[0-9A-Z]{16}', category: 'aws' });
    expect(c.category).toBe('aws');
    expect(c.re.source).toBe('AKIA[0-9A-Z]{16}');
  });

  it('rejects patterns carrying regex flags (/.../gm, /.../y)', () => {
    expectValidation(() => compileCustomPattern({ pattern: '/foo/gm' }));
    expectValidation(() => compileCustomPattern({ pattern: '/foo/y' }));
  });

  it('rejects nested quantifiers / catastrophic alternation', () => {
    expectValidation(() => compileCustomPattern({ pattern: '(a+)+' }));
    expectValidation(() => compileCustomPattern({ pattern: '(a|aa)+$' }));
  });

  it('rejects an empty or over-long pattern', () => {
    expectValidation(() => compileCustomPattern({ pattern: '' }));
    expectValidation(() => compileCustomPattern({ pattern: 'a'.repeat(5000) }));
  });

  it('rejects an invalid regex', () => {
    expectValidation(() => compileCustomPattern({ pattern: '(' }));
  });
});

describe('scanCustomPatterns', () => {
  it('emits matches with absOffset + category + matched bytes', () => {
    const c = compileCustomPattern({ pattern: 'AKIA[0-9A-Z]{4}', category: 'aws' });
    const buf = Buffer.from('xx AKIA1234 yy', 'latin1');
    const hits = scanCustomPatterns(buf, 100, [c], () => performance.now());
    expect(hits.length).toBe(1);
    expect(hits[0]!.absOffset).toBe(103);
    expect(hits[0]!.format).toBe('custom');
    expect(hits[0]!.customCategory).toBe('aws');
    expect(Buffer.from(hits[0]!.bytes).toString('latin1')).toBe('AKIA1234');
  });

  it('stops with TIMEOUT when the budget is exhausted', () => {
    const c = compileCustomPattern({ pattern: 'a', category: 'x' });
    const buf = Buffer.from('aaaa', 'latin1');
    let now = 0;
    const clock = () => {
      now += 1000; // each check jumps past a 50ms budget
      return now;
    };
    try {
      scanCustomPatterns(buf, 0, [c], clock);
      throw new Error('expected TIMEOUT');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe('TIMEOUT');
    }
  });
});

describe('KeyExtractor with customPatterns', () => {
  it('returns a custom candidate only when formats includes custom', async () => {
    const { dir, path } = tmpFile('prefix AKIA1234 suffix');
    try {
      const withCustom = await new KeyExtractor().extractFromFile(path, {
        formats: ['custom'],
        customPatterns: [{ pattern: 'AKIA[0-9A-Z]{4}', category: 'aws' }],
        includeContext: false,
      });
      expect(withCustom.candidates.length).toBe(1);
      expect(withCustom.candidates[0]!.format).toBe('custom');
      expect(withCustom.candidates[0]!.customCategory).toBe('aws');

      const without = await new KeyExtractor().extractFromFile(path, {
        formats: ['raw', 'base64', 'hex'],
        customPatterns: [{ pattern: 'AKIA[0-9A-Z]{4}', category: 'aws' }],
        includeContext: false,
        minEntropy: 8,
      });
      expect(without.candidates.some((c) => c.format === 'custom')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
