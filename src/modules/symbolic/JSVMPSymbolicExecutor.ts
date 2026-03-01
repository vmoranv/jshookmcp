import { SymbolicExecutor, SymbolicValue, SymbolicState, Constraint } from './SymbolicExecutor.js';
import { logger } from '../../utils/logger.js';
import type { VMType } from '../../types/index.js';

export enum JSVMPOpcode {
  PUSH = 0x01,
  POP = 0x02,
  DUP = 0x03,

  ADD = 0x10,
  SUB = 0x11,
  MUL = 0x12,
  DIV = 0x13,
  MOD = 0x14,

  AND = 0x20,
  OR = 0x21,
  NOT = 0x22,
  XOR = 0x23,

  EQ = 0x30,
  NE = 0x31,
  LT = 0x32,
  LE = 0x33,
  GT = 0x34,
  GE = 0x35,

  JMP = 0x40,
  JZ = 0x41,
  JNZ = 0x42,
  CALL = 0x43,
  RET = 0x44,

  LOAD = 0x50,
  STORE = 0x51,
  LOAD_CONST = 0x52,

  NOP = 0x00,
  HALT = 0xff,
}

export interface JSVMPInstruction {
  opcode: JSVMPOpcode;
  operands: unknown[];
  location: number;
}

export interface JSVMPSymbolicExecutorOptions {
  instructions: JSVMPInstruction[];
  vmType?: VMType;
  maxSteps?: number;
  timeout?: number;
}

export interface JSVMPSymbolicExecutorResult {
  finalState: SymbolicState;
  executionTrace: SymbolicState[];
  inferredLogic: string;
  constraints: Constraint[];
  confidence: number;
  warnings: string[];
}

export class JSVMPSymbolicExecutor extends SymbolicExecutor {
  async executeJSVMP(options: JSVMPSymbolicExecutorOptions): Promise<JSVMPSymbolicExecutorResult> {
    const startTime = Date.now();
    const { instructions, vmType = 'custom', maxSteps = 1000, timeout = 30000 } = options;

    logger.info(' JSVMP...');
    logger.info(` : ${instructions.length}`);
    logger.info(`VM type detected: ${vmType}`);

    const warnings: string[] = [];
    const executionTrace: SymbolicState[] = [];

    try {
      let state: SymbolicState = {
        pc: 0,
        stack: [],
        registers: new Map(),
        memory: new Map(),
        pathConstraints: [],
      };

      let steps = 0;
      while (state.pc < instructions.length && steps < maxSteps) {
        if (Date.now() - startTime > timeout) {
          warnings.push('JSVMP');
          break;
        }

        const instruction = instructions[state.pc];
        if (!instruction) {
          warnings.push(`: PC=${state.pc}`);
          break;
        }

        executionTrace.push(this.cloneStateInternal(state));

        state = this.executeInstruction(state, instruction);

        if (instruction.opcode === JSVMPOpcode.HALT) {
          break;
        }

        steps++;
      }
      const inferredLogic = this.inferLogic(executionTrace, instructions);
      const constraints = this.collectAllConstraints(executionTrace);
      const confidence = this.calculateConfidence(executionTrace, instructions);
      const executionTime = Date.now() - startTime;
      logger.info(`JSVMP symbolic execution complete in ${executionTime}ms`);
      logger.info(` : ${steps}`);
      logger.info(` : ${(confidence * 100).toFixed(1)}%`);

      return {
        finalState: state,
        executionTrace,
        inferredLogic,
        constraints,
        confidence,
        warnings,
      };
    } catch (error) {
      logger.error('JSVMP', error);
      throw error;
    }
  }

  private executeInstruction(state: SymbolicState, instruction: JSVMPInstruction): SymbolicState {
    const newState = this.cloneStateInternal(state);

    switch (instruction.opcode) {
      case JSVMPOpcode.PUSH:
        this.executePush(newState, instruction.operands[0]);
        break;

      case JSVMPOpcode.POP:
        this.executePop(newState);
        break;

      case JSVMPOpcode.ADD:
        this.executeAdd(newState);
        break;

      case JSVMPOpcode.SUB:
        this.executeSub(newState);
        break;

      case JSVMPOpcode.MUL:
        this.executeMul(newState);
        break;

      case JSVMPOpcode.LOAD:
        this.executeLoad(newState, this.asStringOperand(instruction.operands[0]));
        break;

      case JSVMPOpcode.STORE:
        this.executeStore(newState, this.asStringOperand(instruction.operands[0]));
        break;

      case JSVMPOpcode.JMP:
        newState.pc = this.asNumberOperand(instruction.operands[0]);
        return newState;

      case JSVMPOpcode.JZ:
        this.executeJZ(newState, this.asNumberOperand(instruction.operands[0]));
        return newState;

      case JSVMPOpcode.CALL:
        this.executeCall(newState, this.asStringOperand(instruction.operands[0]));
        break;

      default:
        logger.warn(`: 0x${instruction.opcode.toString(16)}`);
    }

    newState.pc++;
    return newState;
  }

  private executePush(state: SymbolicState, value: unknown): void {
    const symbolicValue = this.createSymbolicValue('unknown', `const_${value}`, String(value));
    symbolicValue.possibleValues = [value];
    state.stack.push(symbolicValue);
  }

  private asNumberOperand(value: unknown): number {
    return typeof value === 'number' ? value : (value as number);
  }

  private asStringOperand(value: unknown): string {
    return typeof value === 'string' ? value : (value as string);
  }

  private executePop(state: SymbolicState): SymbolicValue | undefined {
    return state.stack.pop();
  }

  private executeAdd(state: SymbolicState): void {
    const b = state.stack.pop();
    const a = state.stack.pop();

    if (a && b) {
      const result = this.createSymbolicValue('number', `${a.name} + ${b.name}`);
      this.addConstraint(result, 'custom', `${result.name} = ${a.name} + ${b.name}`, '');
      state.stack.push(result);
    }
  }

  private executeSub(state: SymbolicState): void {
    const b = state.stack.pop();
    const a = state.stack.pop();

    if (a && b) {
      const result = this.createSymbolicValue('number', `${a.name} - ${b.name}`);
      this.addConstraint(result, 'custom', `${result.name} = ${a.name} - ${b.name}`, '');
      state.stack.push(result);
    }
  }

  private executeMul(state: SymbolicState): void {
    const b = state.stack.pop();
    const a = state.stack.pop();

    if (a && b) {
      const result = this.createSymbolicValue('number', `${a.name} * ${b.name}`);
      this.addConstraint(result, 'custom', `${result.name} = ${a.name} * ${b.name}`, '');
      state.stack.push(result);
    }
  }

  private executeLoad(state: SymbolicState, varName: string): void {
    const value = state.memory.get(varName);
    if (value) {
      state.stack.push(value);
    } else {
      const symbolicValue = this.createSymbolicValue('unknown', varName, varName);
      state.stack.push(symbolicValue);
    }
  }

  private executeStore(state: SymbolicState, varName: string): void {
    const value = state.stack.pop();
    if (value) {
      state.memory.set(varName, value);
    }
  }

  private executeJZ(state: SymbolicState, target: number): void {
    const condition = state.stack.pop();
    if (condition) {
      const constraint: Constraint = {
        type: 'equality',
        expression: `${condition.name} == 0`,
        description: '',
      };
      state.pathConstraints.push(constraint);

      state.pc = target;
    }
  }

  private executeCall(_state: SymbolicState, funcName: string): void {
    logger.info(` : ${funcName}`);
  }

  private inferLogic(trace: SymbolicState[], instructions: JSVMPInstruction[]): string {
    const lines: string[] = [];

    for (let i = 0; i < Math.min(trace.length, 10); i++) {
      const state = trace[i];
      if (!state) continue;

      const instruction = instructions[state.pc];

      if (instruction) {
        lines.push(
          `${instruction.opcode}(${instruction.operands.join(', ')}) at ${instruction.location}`
        );
      }
    }

    return lines.join('\n') || '';
  }

  private collectAllConstraints(trace: SymbolicState[]): Constraint[] {
    const constraints: Constraint[] = [];

    for (const state of trace) {
      constraints.push(...state.pathConstraints);

      for (const value of state.stack) {
        constraints.push(...value.constraints);
      }
    }

    return constraints;
  }

  private calculateConfidence(trace: SymbolicState[], instructions: JSVMPInstruction[]): number {
    const coverage = trace.length / instructions.length;
    return Math.min(coverage, 1.0);
  }

  private cloneStateInternal(state: SymbolicState): SymbolicState {
    return {
      pc: state.pc,
      stack: [...state.stack],
      registers: new Map(state.registers),
      memory: new Map(state.memory),
      pathConstraints: [...state.pathConstraints],
    };
  }
}
