import { describe, it, expect, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));

import {
  detectPoisonedNames,
  deriveBehavioralName,
  applyQuarantine,
  assessLLMDeobfuscationRisk,
  quarantinePoisonedNames,
  QuarantinedName,
  QuarantineResult,
} from '@modules/deobfuscator/PoisonedNameQuarantine';

describe('PoisonedNameQuarantine', () => {
  it('detectPoisonedNames returns empty for clean code', () => {
    const result = detectPoisonedNames('const userName = "Alice";');
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('detectPoisonedNames finds _0x style mangled names', () => {
    const code = 'var _0x1a2b = 42; _0x1a2b++;';
    const result = detectPoisonedNames(code);
    const mangled = result.find((n) => n.originalName.startsWith('_0x'));
    expect(mangled).toBeDefined();
    expect(mangled?.confidence).toBeGreaterThan(0);
  });

  it('detectPoisonedNames finds hash-like identifiers', () => {
    const code = 'var abcdef1234567890 = true;';
    const result = detectPoisonedNames(code);
    const hashLike = result.find((n) => n.reason === 'hash-like');
    expect(hashLike).toBeDefined();
  });

  it('detectPoisonedNames finds non-ASCII identifiers', () => {
    const code = 'var \u00e0\u00e8\u00ec = 1;';
    const result = detectPoisonedNames(code);
    const nonAscii = result.find((n) => n.reason === 'non-ascii');
    expect(nonAscii).toBeDefined();
  });

  it('deriveBehavioralName generates sensible rename from context', () => {
    const code = 'function _0x1a2b(x) { return x + 1; }';
    const name = deriveBehavioralName(code, '_0x1a2b');
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(0);
  });

  it('applyQuarantine replaces poisoned names in code', () => {
    const code = 'var _0x1a2b = 1; console.log(_0x1a2b);';
    const names: QuarantinedName[] = [{
      originalName: '_0x1a2b',
      reason: 'string-table-origin',
      confidence: 0.8,
      safeReplacement: 'safeVar',
      replaced: false,
    }];
    const result = applyQuarantine(code, names);
    expect(result.code).not.toContain('_0x1a2b');
    expect(result.replacedCount).toBeGreaterThan(0);
  });

  it('assessLLMDeobfuscationRisk returns risk level for obfuscated code', () => {
    const code = 'var _0x1a2b=["a","b","c"];function _0x3c4d(i){return _0x1a2b[i];}';
    const risk = assessLLMDeobfuscationRisk(code);
    expect(['low', 'medium', 'high']).toContain(risk.level);
    expect(risk.score).toBeGreaterThanOrEqual(0);
    expect(risk.score).toBeLessThanOrEqual(1);
  });

  it('assessLLMDeobfuscationRisk returns low risk for clean code', () => {
    const risk = assessLLMDeobfuscationRisk('const x = 42;');
    expect(risk.level).toBe('low');
  });

  it('quarantinePoisonedNames returns structured result', () => {
    const result = quarantinePoisonedNames('const x = 1;');
    expect(result).toHaveProperty('quarantinedNames');
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('replacedCount');
    expect(result).toHaveProperty('llmRisk');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.quarantinedNames)).toBe(true);
  });
});
