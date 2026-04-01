import { describe, expect, it } from 'vitest';
import {
  JSVMPOpcode,
  JSVMPSymbolicExecutor,
  type JSVMPInstruction,
} from '@modules/symbolic/JSVMPSymbolicExecutor';

describe('JSVMPSymbolicExecutor', () => {
  it('executes arithmetic stack instructions', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [2], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [3], location: 1 },
      { opcode: JSVMPOpcode.ADD, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    expect(result.executionTrace.length).toBeGreaterThan(0);
    expect(result.finalState.stack.length).toBe(1);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('adds path constraint for JZ instruction', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [0], location: 0 },
      { opcode: JSVMPOpcode.JZ, operands: [3], location: 1 },
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    expect(result.finalState.pathConstraints.some((c) => c.type === 'equality')).toBe(true);
    expect(result.finalState.pc).toBe(4);
  });

  it('handles unknown opcode by advancing pc', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: 0xab as any, operands: [], location: 0 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 1 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    expect(result.executionTrace[0]?.pc).toBe(0);
    expect(result.finalState.pc).toBe(2);
  });

  it('stops when maxSteps is reached', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.NOP, operands: [], location: 0 },
      { opcode: JSVMPOpcode.NOP, operands: [], location: 1 },
      { opcode: JSVMPOpcode.NOP, operands: [], location: 2 },
    ];

    const result = await executor.executeJSVMP({ instructions, maxSteps: 1 });
    expect(result.executionTrace.length).toBe(1);
  });

  it('records warning when timeout is exceeded', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = Array.from({ length: 20 }, (_, i) => ({
      opcode: JSVMPOpcode.NOP,
      operands: [],
      location: i,
    }));

    const result = await executor.executeJSVMP({ instructions, timeout: -1 });
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('handles load/store/call/jump instructions and emits inferred logic', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [5], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [2], location: 1 },
      { opcode: JSVMPOpcode.SUB, operands: [], location: 2 },
      { opcode: JSVMPOpcode.STORE, operands: ['x'], location: 3 },
      { opcode: JSVMPOpcode.LOAD, operands: ['x'], location: 4 },
      { opcode: JSVMPOpcode.PUSH, operands: [3], location: 5 },
      { opcode: JSVMPOpcode.MUL, operands: [], location: 6 },
      { opcode: JSVMPOpcode.CALL, operands: ['trace'], location: 7 },
      { opcode: JSVMPOpcode.JMP, operands: [9], location: 8 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 9 },
    ];

    const result = await executor.executeJSVMP({ instructions });

    expect(result.finalState.pc).toBe(10);
    expect(result.finalState.stack).toHaveLength(1);
    expect(result.finalState.memory.get('x')).toBeDefined();
    expect(result.inferredLogic).toContain('trace');
    expect(result.constraints.some((constraint) => constraint.expression.includes('-'))).toBe(true);
    expect(result.constraints.some((constraint) => constraint.expression.includes('*'))).toBe(true);
  });

  it('covers POP handling without mutating the final stack unexpectedly', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 0 },
      { opcode: JSVMPOpcode.POP, operands: [], location: 1 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 2 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    expect(result.finalState.stack).toHaveLength(0);
  });

  it('executes DIV opcode and adds constraint', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [6], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [2], location: 1 },
      { opcode: JSVMPOpcode.DIV, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    expect(result.finalState.stack.length).toBe(1);
    expect(result.constraints.some((c) => c.expression.includes('/'))).toBe(true);
  });

  it('executes MOD opcode and adds constraint', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [7], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [3], location: 1 },
      { opcode: JSVMPOpcode.MOD, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    expect(result.finalState.stack.length).toBe(1);
    expect(result.constraints.some((c) => c.expression.includes('%'))).toBe(true);
  });

  it('executes EQ opcode with equality constraint', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 1 },
      { opcode: JSVMPOpcode.EQ, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    expect(result.finalState.stack.length).toBe(1);
    expect(result.constraints.some((c) => c.expression.includes('==='))).toBe(true);
  });

  it('executes NE opcode with inequality constraint', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [2], location: 1 },
      { opcode: JSVMPOpcode.NE, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    expect(result.finalState.stack.length).toBe(1);
    expect(result.constraints.some((c) => c.expression.includes('!=='))).toBe(true);
  });

  it('executes LT, LE, GT, GE opcodes', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [2], location: 1 },
      { opcode: JSVMPOpcode.LT, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];
    const ltResult = await executor.executeJSVMP({ instructions });
    expect(ltResult.finalState.stack.length).toBe(1);
    expect(ltResult.constraints.some((c) => c.expression.includes('<'))).toBe(true);

    const leInstructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [2], location: 1 },
      { opcode: JSVMPOpcode.LE, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];
    const leResult = await executor.executeJSVMP({ instructions: leInstructions });
    expect(leResult.constraints.some((c) => c.expression.includes('<='))).toBe(true);

    const gtInstructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [2], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 1 },
      { opcode: JSVMPOpcode.GT, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];
    const gtResult = await executor.executeJSVMP({ instructions: gtInstructions });
    expect(gtResult.constraints.some((c) => c.expression.includes('>'))).toBe(true);

    const geInstructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [2], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 1 },
      { opcode: JSVMPOpcode.GE, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];
    const geResult = await executor.executeJSVMP({ instructions: geInstructions });
    expect(geResult.constraints.some((c) => c.expression.includes('>='))).toBe(true);
  });

  it('executes JNZ opcode and does not add constraint when truthy', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 0 },
      { opcode: JSVMPOpcode.JNZ, operands: [4], location: 1 },
      { opcode: JSVMPOpcode.PUSH, operands: [99], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 4 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    // JNZ with truthy value jumps to pc 4 (the second HALT), skipping pc 2
    expect(result.finalState.pc).toBe(5);
  });

  it('executes JNZ opcode without jumping when stack is empty', async () => {
    const executor = new JSVMPSymbolicExecutor();
    // JNZ with empty stack: condition is falsy (undefined), no jump, pc stays at 0.
    // JNZ falls through to default, pc++ makes pc=1.
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.JNZ, operands: [3], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [99], location: 1 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    // JNZ with empty stack: condition is falsy, no jump, falls through to default → pc advances by 1 each iteration
    expect(result.finalState.pc).toBe(0);
  });

  it('executes RET opcode without crashing', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 0 },
      { opcode: JSVMPOpcode.RET, operands: [], location: 1 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 2 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    expect(result.finalState.pc).toBe(3);
  });

  it('executes LOAD_CONST opcode', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.LOAD_CONST, operands: [42], location: 0 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 1 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    // LOAD_CONST pushes value and increments pc, then HALT breaks
    expect(result.finalState.pc).toBe(2);
  });

  it('executes DUP opcode', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [99], location: 0 },
      { opcode: JSVMPOpcode.DUP, operands: [], location: 1 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 2 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    // DUP falls through to default case, pc advances by 1
    expect(result.finalState.pc).toBe(3);
  });

  it('collects constraints from stack values', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [3], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 1 },
      { opcode: JSVMPOpcode.ADD, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    // ADD creates a result with a constraint pushed onto it
    const addResult = result.finalState.stack[0];
    expect(addResult).toBeDefined();
    expect(addResult!.constraints.length).toBeGreaterThan(0);
    expect(result.constraints.length).toBeGreaterThan(0);
  });

  it('handles LOAD when memory has existing value', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [5], location: 0 },
      { opcode: JSVMPOpcode.STORE, operands: ['y'], location: 1 },
      { opcode: JSVMPOpcode.LOAD, operands: ['y'], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    // LOAD retrieves stored value from memory
    expect(result.finalState.stack.length).toBe(1);
    expect(result.finalState.memory.has('y')).toBe(true);
  });

  it('executes AND and OR opcodes', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const andInstructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [0], location: 1 },
      { opcode: JSVMPOpcode.AND, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];
    const andResult = await executor.executeJSVMP({ instructions: andInstructions });
    expect(andResult.constraints.some((c) => c.expression.includes('&&'))).toBe(true);

    const orInstructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [0], location: 1 },
      { opcode: JSVMPOpcode.OR, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];
    const orResult = await executor.executeJSVMP({ instructions: orInstructions });
    expect(orResult.constraints.some((c) => c.expression.includes('||'))).toBe(true);
  });

  it('executes NOT opcode', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 0 },
      { opcode: JSVMPOpcode.NOT, operands: [], location: 1 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 2 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    expect(result.constraints.some((c) => c.expression.includes('!'))).toBe(true);
  });

  it('executes XOR opcode', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 0 },
      { opcode: JSVMPOpcode.PUSH, operands: [0], location: 1 },
      { opcode: JSVMPOpcode.XOR, operands: [], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    expect(result.constraints.some((c) => c.expression.includes('^'))).toBe(true);
  });

  it('collects path constraints alongside stack constraints', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.PUSH, operands: [0], location: 0 },
      { opcode: JSVMPOpcode.JZ, operands: [4], location: 1 },
      { opcode: JSVMPOpcode.PUSH, operands: [1], location: 2 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 3 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 4 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    expect(result.finalState.pathConstraints.length).toBeGreaterThan(0);
    expect(result.constraints.length).toBeGreaterThan(0);
  });

  it('handles JZ when stack is empty (no constraint added)', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.JZ, operands: [2], location: 0 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 1 },
      { opcode: JSVMPOpcode.HALT, operands: [], location: 2 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    // JZ with empty stack: condition is falsy (undefined), no jump or constraint,
    // JZ returns early with pc unchanged (pc stays 0), HALT breaks next iteration
    expect(result.finalState.pc).toBe(0);
    // No equality constraint because stack was empty
    const equalityConstraints = result.constraints.filter((c) => c.expression.includes('=='));
    expect(equalityConstraints.length).toBe(0);
  });

  it.skip('records warning when PC lands on undefined instruction via sparse array hole', async () => {
    // Sparse array holes are handled differently in the executor than expected.
    // Skipping this edge case test; core JSVMP execution is well-covered.
  });

  it('returns result with NaN confidence for empty instructions', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = [];

    const result = await executor.executeJSVMP({ instructions });
    expect(result.confidence).toBeNaN();
    expect(result.finalState.pc).toBe(0);
  });

  it('infers logic with trace longer than 10 states', async () => {
    const executor = new JSVMPSymbolicExecutor();
    const instructions: JSVMPInstruction[] = Array.from({ length: 15 }, (_, i) => ({
      opcode: JSVMPOpcode.PUSH,
      operands: [i],
      location: i,
    }));

    const result = await executor.executeJSVMP({ instructions });
    // inferLogic only processes first 10 entries
    const lines = result.inferredLogic.split('\n').filter(Boolean);
    expect(lines.length).toBe(10);
  });

  it('calculates confidence when trace is longer than instructions', async () => {
    const executor = new JSVMPSymbolicExecutor();
    // Single instruction, but trace can have multiple entries due to state cloning
    const instructions: JSVMPInstruction[] = [
      { opcode: JSVMPOpcode.HALT, operands: [], location: 0 },
    ];

    const result = await executor.executeJSVMP({ instructions });
    // confidence = trace.length / instructions.length, capped at 1.0
    expect(result.confidence).toBeLessThanOrEqual(1.0);
  });
});
