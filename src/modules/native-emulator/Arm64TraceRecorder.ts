/**
 * ARM64 Trace & Taint Analysis Engine (SOTA Phase 1).
 *
 * Provides instruction-level execution recording, register read/write delta tracking,
 * memory access logging, and symbolic taint propagation across AArch64 execution paths.
 */

export interface RegisterDiff {
  reg: number; // 0..30, or special (-1 for SP, -2 for NZCV)
  name: string;
  before: bigint;
  after: bigint;
}

export interface MemoryAccessLog {
  type: 'read' | 'write';
  address: number;
  size: number;
  value: bigint;
}

export interface Arm64TraceRecord {
  step: number;
  pc: number;
  insn: number;
  disasm?: string;
  regDiffs: RegisterDiff[];
  memAccesses: MemoryAccessLog[];
  isBranch: boolean;
  targetPc?: number;
}

export class Arm64TraceRecorder {
  private readonly records: Arm64TraceRecord[] = [];
  private isRecording = false;
  private readonly taintedRegisters = new Set<number>();
  private readonly taintedMemory = new Set<number>(); // word-aligned addresses

  startRecording(): void {
    this.records.length = 0;
    this.isRecording = true;
  }

  stopRecording(): Arm64TraceRecord[] {
    this.isRecording = false;
    return [...this.records];
  }

  getTrace(): readonly Arm64TraceRecord[] {
    return this.records;
  }

  recordStep(record: Arm64TraceRecord): void {
    if (!this.isRecording) return;
    this.records.push(record);
  }

  setRegisterTaint(regIndex: number, tainted: boolean): void {
    if (tainted) {
      this.taintedRegisters.add(regIndex);
    } else {
      this.taintedRegisters.delete(regIndex);
    }
  }

  isRegisterTainted(regIndex: number): boolean {
    return this.taintedRegisters.has(regIndex);
  }

  setMemoryTaint(address: number, tainted: boolean): void {
    // `address & ~7` coerces to signed 32-bit and wraps AArch64 addresses above
    // 0x7fffffff. Addresses here are JS numbers (< 2^53), so align arithmetically.
    const aligned = Math.floor(address / 8) * 8;
    if (tainted) {
      this.taintedMemory.add(aligned);
    } else {
      this.taintedMemory.delete(aligned);
    }
  }

  isMemoryTainted(address: number): boolean {
    const aligned = Math.floor(address / 8) * 8;
    return this.taintedMemory.has(aligned);
  }

  clearTaints(): void {
    this.taintedRegisters.clear();
    this.taintedMemory.clear();
  }
}
