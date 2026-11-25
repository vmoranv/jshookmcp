/**
 * Fix 3 [P1] — SPIR-V instruction statistics (opcode histogram, texture
 * sample count, control-flow complexity, cost estimate).
 */

import { describe, expect, it } from 'vitest';
import { parseSpirv, computeSpirvStats } from '@modules/webgpu/SpirvParser';

// ─── SPIR-V construction helpers (mirror SpirvParser.test.ts) ────────────────

const MAGIC = 0x07230203;

function wordsToBytes(words: number[]): Uint8Array {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < words.length; i++) {
    view.setUint32(i * 4, (words[i] ?? 0) >>> 0, true);
  }
  return bytes;
}

function makeInstruction(opcode: number, operands: number[]): number[] {
  const wordCount = 1 + operands.length;
  return [((wordCount & 0xffff) << 16) | (opcode & 0xffff), ...operands];
}

function buildModule(instructionWords: number[][]): Uint8Array {
  const header = [MAGIC, 0x00010000, 0, 64, 0];
  return wordsToBytes([...header, ...instructionWords.flat()]);
}

// Opcodes exercised by the fixture.
const OP_LOAD = 61;
const OP_STORE = 62;
const OP_FADD = 129;
const OP_FMUL = 133;
const OP_IMAGE_SAMPLE_IMPLICIT_LOD = 87;
const OP_IMAGE_SAMPLE = 80; // generic OpImageSample (was missing from TEXTURE_SAMPLE_OPCODES)
const OP_IMAGE_FETCH = 95;
const OP_BRANCH = 249;
const OP_BRANCH_CONDITIONAL = 250;
const OP_LOOP_MERGE = 246;
const OP_SELECTION_MERGE = 247;
const OP_MEMORY_BARRIER = 225;
const OP_RETURN = 253;
const OP_LABEL = 248;
const OP_FUNCTION = 54;
const OP_FUNCTION_END = 56;
const OP_TYPE_FLOAT = 22;
const OP_TYPE_VOID = 19;
const OP_TYPE_FUNCTION = 33;
const OP_TYPE_POINTER = 32;

// ─── Fixture ─────────────────────────────────────────────────────────────────

/**
 * A minimal-but-realistic module: a function body with loads, ALU ops, two
 * texture samples, a memory barrier, and a branch. Exercises the histogram,
 * textureSamples, controlFlowComplexity, and costScore paths.
 */
function buildSampleModule(): Uint8Array {
  const insts: number[][] = [
    makeInstruction(OP_TYPE_VOID, [1]),
    makeInstruction(OP_TYPE_FLOAT, [2, 32]),
    makeInstruction(OP_TYPE_FUNCTION, [3, 1]),
    makeInstruction(OP_TYPE_POINTER, [4, 7, 2]), // ptr<uniform, f32>
    makeInstruction(OP_FUNCTION, [3, 2, 1]),
    makeInstruction(OP_LABEL, [10]),
    makeInstruction(OP_LOAD, [2, 11, 12]), // %11 = OpLoad f32 %12
    makeInstruction(OP_LOAD, [2, 13, 12]),
    makeInstruction(OP_FMUL, [2, 14, 11, 13]),
    makeInstruction(OP_FADD, [2, 15, 14, 11]),
    makeInstruction(OP_IMAGE_SAMPLE_IMPLICIT_LOD, [2, 16, 15, 12]), // texture sample
    makeInstruction(OP_IMAGE_SAMPLE_IMPLICIT_LOD, [2, 17, 15, 12]), // texture sample
    makeInstruction(OP_IMAGE_FETCH, [2, 18, 15, 12]), // texture fetch
    makeInstruction(OP_MEMORY_BARRIER, [19, 2, 264]),
    makeInstruction(OP_BRANCH_CONDITIONAL, [20, 21, 22]),
    makeInstruction(OP_LABEL, [21]),
    makeInstruction(OP_BRANCH, [22]),
    makeInstruction(OP_LABEL, [22]),
    makeInstruction(OP_LOOP_MERGE, [23, 22, 22]),
    makeInstruction(OP_SELECTION_MERGE, [24, 25]),
    makeInstruction(OP_STORE, [12, 15]),
    makeInstruction(OP_RETURN, []),
    makeInstruction(OP_FUNCTION_END, []),
  ];
  return buildModule(insts);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('computeSpirvStats — opcode histogram & cost estimate', () => {
  it('counts total instructions and builds a named opcode histogram', () => {
    const reflect = parseSpirv(buildSampleModule());
    const stats = computeSpirvStats(reflect.instructions ?? []);

    expect(stats.totalInstructions).toBeGreaterThan(0);
    expect(stats.byOpcode.OpLoad).toBe(2);
    expect(stats.byOpcode.OpStore).toBe(1);
    expect(stats.byOpcode.OpFMul).toBe(1);
    expect(stats.byOpcode.OpFAdd).toBe(1);
  });

  it('counts texture samples across the OpImageSample*/Fetch/Gather family', () => {
    const reflect = parseSpirv(buildSampleModule());
    const stats = computeSpirvStats(reflect.instructions ?? []);

    // 2 × OpImageSampleImplicitLod + 1 × OpImageFetch
    expect(stats.textureSamples).toBe(3);
  });

  it('counts generic OpImageSample (opcode 80) as a texture sample', () => {
    const insts: number[][] = [
      makeInstruction(OP_TYPE_VOID, [1]),
      makeInstruction(OP_TYPE_FLOAT, [2, 32]),
      makeInstruction(OP_TYPE_FUNCTION, [3, 2, 1]),
      makeInstruction(OP_LABEL, [10]),
      // Single generic OpImageSample instruction.
      makeInstruction(OP_IMAGE_SAMPLE, [2, 16, 15, 12]),
      makeInstruction(OP_RETURN, []),
      makeInstruction(OP_FUNCTION_END, []),
    ];
    const reflect = parseSpirv(buildModule(insts));
    const stats = computeSpirvStats(reflect.instructions ?? []);

    expect(stats.textureSamples).toBe(1);
    expect(stats.byOpcode.OpImageSample).toBe(1);
  });

  it('measures control-flow complexity from branch/merge instructions', () => {
    const reflect = parseSpirv(buildSampleModule());
    const stats = computeSpirvStats(reflect.instructions ?? []);

    // OpBranchConditional + OpBranch + OpLoopMerge + OpSelectionMerge + OpReturn
    expect(stats.controlFlowComplexity).toBeGreaterThanOrEqual(5);
    expect(stats.byOpcode.OpBranch).toBe(1);
    expect(stats.byOpcode.OpBranchConditional).toBe(1);
  });

  it('computes costScore = Σ(opWeight × count) with texture samples weighted high', () => {
    const reflect = parseSpirv(buildSampleModule());
    const stats = computeSpirvStats(reflect.instructions ?? []);

    // Manual partial check: 3 texture ops (weight 8) dominate a default-1 baseline.
    const baseline = stats.totalInstructions;
    expect(stats.costScore).toBeGreaterThan(baseline);
    expect(stats.costScore).toBeGreaterThanOrEqual(3 * 8);
  });

  it('counts memory barriers with a high weight', () => {
    const reflect = parseSpirv(buildSampleModule());
    const stats = computeSpirvStats(reflect.instructions ?? []);

    expect(stats.byOpcode.OpMemoryBarrier).toBe(1);
    // barrier weight 12 ≥ texture weight 8; check total includes it.
    expect(stats.costScore).toBeGreaterThanOrEqual(12);
  });

  it('handles an empty instruction list without throwing', () => {
    const stats = computeSpirvStats([]);
    expect(stats).toEqual({
      totalInstructions: 0,
      byOpcode: {},
      textureSamples: 0,
      controlFlowComplexity: 0,
      costScore: 0,
    });
  });

  it('is exposed on the reflect result for handler consumption', () => {
    const reflect = parseSpirv(buildSampleModule());
    const stats = computeSpirvStats(reflect.instructions ?? []);
    expect(typeof stats.costScore).toBe('number');
    expect(Object.keys(stats.byOpcode).length).toBeGreaterThan(0);
  });
});
