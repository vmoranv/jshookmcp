import { describe, it, expect } from 'vitest';
import { BUILTIN_MACROS, deobfuscateAstFlow, unpackerFlow } from '@server/macros/builtins';

describe('Built-in Macros', () => {
  it('BUILTIN_MACROS has exactly 2 entries', () => {
    expect(BUILTIN_MACROS).toHaveLength(2);
  });

  it('all built-in macros have unique ids', () => {
    const ids = BUILTIN_MACROS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all macros have displayName and description', () => {
    for (const m of BUILTIN_MACROS) {
      expect(m.displayName).toBeTruthy();
      expect(typeof m.displayName).toBe('string');
      expect(m.description).toBeTruthy();
      expect(typeof m.description).toBe('string');
    }
  });

  it('all steps have id and toolName', () => {
    for (const m of BUILTIN_MACROS) {
      expect(m.steps.length).toBeGreaterThan(0);
      for (const step of m.steps) {
        expect(step.id).toBeTruthy();
        expect(typeof step.id).toBe('string');
        expect(step.toolName).toBeTruthy();
        expect(typeof step.toolName).toBe('string');
      }
    }
  });

  describe('deobfuscateAstFlow', () => {
    it('has correct id', () => {
      expect(deobfuscateAstFlow.id).toBe('deobfuscate_ast_flow');
    });

    it('has 3 steps', () => {
      expect(deobfuscateAstFlow.steps).toHaveLength(3);
    });

    it('chains deobfuscate → advanced_deobfuscate → extract_function_tree', () => {
      const tools = deobfuscateAstFlow.steps.map((s) => s.toolName);
      expect(tools).toEqual(['deobfuscate', 'advanced_deobfuscate', 'extract_function_tree']);
    });

    it('has 60s timeout', () => {
      expect(deobfuscateAstFlow.timeoutMs).toBe(60_000);
    });

    it('advanced_deobfuscate step is optional', () => {
      const advStep = deobfuscateAstFlow.steps.find((s) => s.id === 'advanced_deobfuscate');
      expect(advStep?.optional).toBe(true);
    });
  });

  describe('unpackerFlow', () => {
    it('has correct id', () => {
      expect(unpackerFlow.id).toBe('unpacker_flow');
    });

    it('has 3 steps', () => {
      expect(unpackerFlow.steps).toHaveLength(3);
    });

    it('chains deobfuscate → advanced_deobfuscate → ast_transform_beautify', () => {
      const tools = unpackerFlow.steps.map((s) => s.toolName);
      expect(tools).toEqual(['deobfuscate', 'advanced_deobfuscate', 'ast_transform_beautify']);
    });

    it('has 90s timeout', () => {
      expect(unpackerFlow.timeoutMs).toBe(90_000);
    });

    it('deep_deobfuscate step is optional', () => {
      const deepStep = unpackerFlow.steps.find((s) => s.id === 'deep_deobfuscate');
      expect(deepStep?.optional).toBe(true);
    });
  });
});
