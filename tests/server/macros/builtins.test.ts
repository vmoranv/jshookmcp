import { describe, it, expect } from 'vitest';
import { BUILTIN_MACROS, deobfuscateAstFlow, unpackerFlow } from '@server/macros/builtins';

describe('Built-in macros', () => {
  it('BUILTIN_MACROS has exactly 2 entries', () => {
    expect(BUILTIN_MACROS).toHaveLength(2);
  });

  it('exports named references matching BUILTIN_MACROS entries', () => {
    expect(BUILTIN_MACROS).toContain(deobfuscateAstFlow);
    expect(BUILTIN_MACROS).toContain(unpackerFlow);
  });

  it('deobfuscateAstFlow has correct id, displayName, tags, and steps', () => {
    expect(deobfuscateAstFlow.id).toBe('deobfuscate_ast_flow');
    expect(deobfuscateAstFlow.displayName).toBe('Deobfuscate AST Flow');
    expect(deobfuscateAstFlow.tags).toContain('deobfuscation');
    expect(deobfuscateAstFlow.tags).toContain('ast');
    expect(deobfuscateAstFlow.steps).toHaveLength(3);
    expect(deobfuscateAstFlow.timeoutMs).toBe(60_000);
  });

  it('unpackerFlow has correct id, displayName, tags, and steps', () => {
    expect(unpackerFlow.id).toBe('unpacker_flow');
    expect(unpackerFlow.displayName).toBe('Unpacker Flow');
    expect(unpackerFlow.tags).toContain('unpacking');
    expect(unpackerFlow.tags).toContain('deobfuscation');
    expect(unpackerFlow.steps).toHaveLength(3);
    expect(unpackerFlow.timeoutMs).toBe(90_000);
  });

  it('all built-in macros have unique ids', () => {
    const ids = BUILTIN_MACROS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all steps have id and toolName', () => {
    for (const m of BUILTIN_MACROS) {
      for (const s of m.steps) {
        expect(s.id).toBeTruthy();
        expect(s.toolName).toBeTruthy();
      }
    }
  });

  it('all macros have displayName and description', () => {
    for (const m of BUILTIN_MACROS) {
      expect(m.displayName).toBeTruthy();
      expect(typeof m.description).toBe('string');
    }
  });

  it('deobfuscateAstFlow uses inputFrom for data piping', () => {
    const stepsWithInputFrom = deobfuscateAstFlow.steps.filter((s) => s.inputFrom);
    expect(stepsWithInputFrom).toHaveLength(2);
    expect(stepsWithInputFrom[0]!.inputFrom).toEqual({ code: 'deobfuscate.code' });
  });

  it('unpackerFlow uses inputFrom for data piping', () => {
    const stepsWithInputFrom = unpackerFlow.steps.filter((s) => s.inputFrom);
    expect(stepsWithInputFrom).toHaveLength(2);
    expect(stepsWithInputFrom[0]!.inputFrom).toEqual({ code: 'detect_and_unpack.code' });
  });

  it('deobfuscateAstFlow marks optional step correctly', () => {
    const optionalSteps = deobfuscateAstFlow.steps.filter((s) => s.optional);
    expect(optionalSteps).toHaveLength(1);
    expect(optionalSteps[0]!.id).toBe('advanced_deobfuscate');
  });

  it('unpackerFlow marks optional step correctly', () => {
    const optionalSteps = unpackerFlow.steps.filter((s) => s.optional);
    expect(optionalSteps).toHaveLength(1);
    expect(optionalSteps[0]!.id).toBe('deep_deobfuscate');
  });
});
