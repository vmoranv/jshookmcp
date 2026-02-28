import { describe, expect, it } from 'vitest';
import {
  JSVMPOpcode,
  JSVMPSymbolicExecutor,
  type JSVMPInstruction,
} from '../../../src/modules/symbolic/JSVMPSymbolicExecutor.js';

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
});
