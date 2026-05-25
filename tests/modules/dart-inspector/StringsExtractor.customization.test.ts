/**
 * Tests for the dart-inspector customization extensions (Phase B).
 *
 * Covers the four backwards-compatible options added on top of the original
 * `customRules` regex flow:
 *
 *   - `scanWindow` (byte range filter)
 *   - `scanStride` (offset alignment filter)
 *   - `CategoryRule.confidence` (propagated to ExtractedString)
 *   - `CategoryRule.enableWhen.fileNameMatches` (conditional rule activation)
 *
 * Each option is exercised both via the compiled `CategoryRule` shape (used
 * internally by tests) AND via the serialisable `CategoryRuleInput` form
 * (used through MCP), so the input → compile → match pipeline is pinned end
 * to end.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

import { StringsExtractor } from '@modules/dart-inspector/StringsExtractor';
import { compileRuleInput } from '@modules/dart-inspector/classifiers';
import type { CategoryRule } from '@modules/dart-inspector/types';

let tmpDir: string;
let basicPath: string;
let libappPath: string;
let otherPath: string;

function writeAscii(buf: Buffer, offset: number, value: string): number {
  buf.write(value, offset, 'ascii');
  buf.writeUInt8(0, offset + value.length);
  return offset + value.length + 1;
}

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'dart-customization-'));

  // Fixture: 5 ASCII strings spaced across the buffer.
  // Offsets: 100, 300, 500, 700, 900 — picked so scanWindow / scanStride tests
  // can independently slice the set.
  const buf = Buffer.alloc(2048, 0xff);
  writeAscii(buf, 100, 'EARLY_TOKEN_VALUE_AA'); // before any window we test
  writeAscii(buf, 300, 'MIDDLE_TOKEN_BB');
  writeAscii(buf, 500, 'MIDDLE_TOKEN_CC');
  writeAscii(buf, 700, 'MIDDLE_TOKEN_DD');
  writeAscii(buf, 900, 'LATE_TOKEN_EE');
  basicPath = join(tmpDir, 'basic.bin');
  await writeFile(basicPath, buf);

  // Same payload but written into two different filenames so enableWhen tests
  // can differentiate by basename.
  libappPath = join(tmpDir, 'libapp.so');
  otherPath = join(tmpDir, 'libfoo.so');
  await writeFile(libappPath, buf);
  await writeFile(otherPath, buf);
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('compileRuleInput — confidence', () => {
  it('compiles a rule with confidence inside [0, 1]', () => {
    const rule = compileRuleInput({
      category: 'highConf',
      pattern: '^EARLY_',
      confidence: 0.85,
    });
    expect(rule.confidence).toBe(0.85);
  });

  it('rejects confidence > 1', () => {
    expect(() =>
      compileRuleInput({ category: 'bad', pattern: '^a', confidence: 1.5 }),
    ).toThrowError(
      expect.objectContaining({
        name: 'ToolError',
        code: 'VALIDATION',
        message: expect.stringContaining('confidence'),
      }),
    );
  });

  it('rejects negative confidence', () => {
    expect(() =>
      compileRuleInput({ category: 'bad', pattern: '^a', confidence: -0.01 }),
    ).toThrowError(expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }));
  });

  it('omits confidence when not supplied', () => {
    const rule = compileRuleInput({ category: 'plain', pattern: '^a' });
    expect(rule.confidence).toBeUndefined();
  });
});

describe('compileRuleInput — enableWhenFileNameMatches', () => {
  it('compiles into a usable CategoryRule.enableWhen.fileNameMatches RegExp', () => {
    const rule = compileRuleInput({
      category: 'libappOnly',
      pattern: '^MIDDLE_TOKEN',
      enableWhenFileNameMatches: '^libapp\\.so$',
    });
    expect(rule.enableWhen?.fileNameMatches).toBeInstanceOf(RegExp);
    expect(rule.enableWhen?.fileNameMatches?.test('libapp.so')).toBe(true);
    expect(rule.enableWhen?.fileNameMatches?.test('libfoo.so')).toBe(false);
  });

  it('rejects a catastrophic regex in enableWhenFileNameMatches', () => {
    expect(() =>
      compileRuleInput({
        category: 'evil',
        pattern: '^a',
        enableWhenFileNameMatches: '(a+)+b',
      }),
    ).toThrowError(expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }));
  });

  it('rejects disallowed flags on enableWhenFileNameFlags', () => {
    expect(() =>
      compileRuleInput({
        category: 'evil',
        pattern: '^a',
        enableWhenFileNameMatches: '^libapp\\.so$',
        enableWhenFileNameFlags: 'g',
      }),
    ).toThrowError(expect.objectContaining({ name: 'ToolError', code: 'VALIDATION' }));
  });
});

describe('StringsExtractor — confidence propagation', () => {
  it('tags ExtractedString.confidence when the matching rule has one', async () => {
    const rule: CategoryRule = {
      category: 'midConf',
      pattern: /^MIDDLE_TOKEN/,
      confidence: 0.5,
    };
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicPath, {
      customRules: [rule],
      ruleMode: 'replace',
    });
    for (const hit of result.midConf ?? []) {
      expect(hit.confidence).toBe(0.5);
    }
    expect((result.midConf ?? []).length).toBe(3); // MIDDLE_TOKEN_BB/CC/DD
  });

  it('does NOT add a confidence field when the rule omits one', async () => {
    const rule: CategoryRule = { category: 'plain', pattern: /^EARLY_/ };
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicPath, {
      customRules: [rule],
      ruleMode: 'replace',
    });
    const hit = result.plain?.[0];
    expect(hit).toBeDefined();
    expect(hit?.confidence).toBeUndefined();
  });
});

describe('StringsExtractor — scanWindow', () => {
  it('drops hits before scanWindow.start', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicPath, {
      includeRaw: true,
      scanWindow: { start: 400 },
    });
    const rawValues = (result.raw ?? []).map((s) => s.value);
    expect(rawValues).not.toContain('EARLY_TOKEN_VALUE_AA');
    expect(rawValues).not.toContain('MIDDLE_TOKEN_BB'); // offset 300, before 400
    expect(rawValues).toContain('MIDDLE_TOKEN_CC'); // offset 500, inside window
    expect(rawValues).toContain('LATE_TOKEN_EE'); // offset 900, inside window
  });

  it('drops hits at or after scanWindow.end', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(basicPath, {
      includeRaw: true,
      scanWindow: { end: 800 },
    });
    const rawValues = (result.raw ?? []).map((s) => s.value);
    expect(rawValues).toContain('EARLY_TOKEN_VALUE_AA');
    expect(rawValues).toContain('MIDDLE_TOKEN_DD'); // offset 700, inside window
    expect(rawValues).not.toContain('LATE_TOKEN_EE'); // offset 900, after end
  });

  it('rejects invalid scanWindow (end <= start)', async () => {
    const extractor = new StringsExtractor();
    await expect(
      extractor.extractFromFile(basicPath, { scanWindow: { start: 500, end: 400 } }),
    ).rejects.toThrowError(
      expect.objectContaining({
        name: 'ToolError',
        code: 'VALIDATION',
        message: expect.stringContaining('scanWindow'),
      }),
    );
  });
});

describe('StringsExtractor — scanStride', () => {
  it('keeps only offsets divisible by scanStride', async () => {
    // All our fixture offsets are multiples of 100. stride=200 keeps {200,400,600,800,...}
    // none of which are in our set; stride=50 keeps {50,100,150,...} → keeps everything
    // since 100,300,500,700,900 are all multiples of 50 (but not 200).
    const extractor = new StringsExtractor();
    const stride200 = await extractor.extractFromFile(basicPath, {
      includeRaw: true,
      scanStride: 200,
    });
    expect(stride200.raw?.length ?? 0).toBe(0);

    const stride50 = await extractor.extractFromFile(basicPath, {
      includeRaw: true,
      scanStride: 50,
    });
    expect(stride50.raw?.length ?? 0).toBe(5);
  });

  it('rejects non-positive stride', async () => {
    const extractor = new StringsExtractor();
    await expect(extractor.extractFromFile(basicPath, { scanStride: 0 })).rejects.toThrowError(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
  });
});

describe('StringsExtractor — enableWhen.fileNameMatches', () => {
  const libappRule = compileRuleInput({
    category: 'libappOnly',
    pattern: '^MIDDLE_',
    enableWhenFileNameMatches: '^libapp\\.so$',
  });

  it('activates the rule when basename matches', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(libappPath, {
      customRules: [libappRule],
      ruleMode: 'replace',
      includeRaw: true,
    });
    expect((result.libappOnly ?? []).length).toBe(3);
  });

  it('skips the rule when basename does NOT match (hits fall through to raw)', async () => {
    const extractor = new StringsExtractor();
    const result = await extractor.extractFromFile(otherPath, {
      customRules: [libappRule],
      ruleMode: 'replace',
      includeRaw: true,
    });
    // libappOnly bucket exists (seeded by the rule chain) but is empty
    expect(result.libappOnly).toEqual([]);
    // MIDDLE_ entries should still be present, in raw
    const rawValues = (result.raw ?? []).map((s) => s.value);
    expect(rawValues).toContain('MIDDLE_TOKEN_BB');
  });
});
