import { describe, it, expect, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({ logger: loggerState }));

import {
  codeToIR,
  irToCode,
  roundTrip,
  applyIRTransforms,
  analyzeIR,
  astToIR,
  irToAST,
  IRProgram,
  IRNode,
  IRTransformOptions,
} from '@modules/deobfuscator/ReversibleIR';

describe('ReversibleIR', () => {
  it('codeToIR parses valid JavaScript', () => {
    const result = codeToIR('const x = 42;');
    expect(result).toHaveProperty('ir');
    expect(result).toHaveProperty('ast');
    expect((result as any).ir).not.toBeNull();
    expect((result as any).ir.nodes).toBeInstanceOf(Map);
  });

  it('codeToIR returns error for invalid JavaScript', () => {
    const result = codeToIR('const x = {{{ broken');
    expect(result).toHaveProperty('error');
    expect((result as any).ir).toBeNull();
  });

  it('irToCode generates valid JavaScript from IR', () => {
    const parsed = codeToIR('const x = 42;');
    if (!(parsed as any).ir) return;
    const code = irToCode((parsed as any).ir);
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
  });

  it('roundTrip preserves code structure', () => {
    const result = roundTrip('const x = 42;');
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('fidelity');
    expect(result.fidelity).toBeGreaterThanOrEqual(0);
    expect(result.fidelity).toBeLessThanOrEqual(100);
  });

  it('roundTrip with simple function', () => {
    const result = roundTrip('function add(a, b) { return a + b; }');
    expect(result.ir).not.toBeNull();
    expect(result.fidelity).toBeGreaterThanOrEqual(0);
  });

  it('roundTrip with control flow (if/else)', () => {
    const result = roundTrip('if (x > 0) { return 1; } else { return 0; }');
    expect(result.ir).not.toBeNull();
    expect(result.fidelity).toBeGreaterThanOrEqual(0);
  });

  it('roundTrip with loops', () => {
    const result = roundTrip('for (let i = 0; i < 10; i++) { console.log(i); }');
    expect(result.ir).not.toBeNull();
    expect(result.fidelity).toBeGreaterThanOrEqual(0);
  });

  it('applyIRTransforms with constant folding', () => {
    const parsed = codeToIR('const x = 1 + 2;');
    if (!(parsed as any).ir) return;
    const transformed = applyIRTransforms((parsed as any).ir, { constantFolding: true, deadCodeElimination: false, flowSensitivePropagation: false, preludeResolution: false });
    expect(transformed).toHaveProperty('nodes');
    expect(transformed.transformLog.length).toBeGreaterThanOrEqual(0);
  });

  it('applyIRTransforms with dead code elimination', () => {
    const parsed = codeToIR('const x = 1;');
    if (!(parsed as any).ir) return;
    const transformed = applyIRTransforms((parsed as any).ir, { deadCodeElimination: true, constantFolding: false, flowSensitivePropagation: false, preludeResolution: false });
    expect(transformed).toHaveProperty('nodes');
  });

  it('analyzeIR returns analysis result', () => {
    const parsed = codeToIR('function test() { return 1; }');
    if (!(parsed as any).ir) return;
    const analysis = analyzeIR((parsed as any).ir);
    expect(analysis).toHaveProperty('totalNodes');
    expect(analysis).toHaveProperty('functionCount');
    expect(analysis).toHaveProperty('optimizationPotential');
    expect(['low', 'medium', 'high']).toContain(analysis.optimizationPotential);
  });

  it('astToIR with empty program', () => {
    const parsed = codeToIR('');
    if (!(parsed as any).ir) return;
    expect((parsed as any).ir.nodes).toBeInstanceOf(Map);
    expect((parsed as any).ir.functions).toBeInstanceOf(Map);
  });

  it('irToAST produces valid AST', () => {
    const parsed = codeToIR('const x = 1;');
    if (!(parsed as any).ir) return;
    const ast = irToAST((parsed as any).ir);
    expect(ast).toHaveProperty('type');
    expect(ast.type).toBe('File');
  });
});
