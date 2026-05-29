/**
 * CpuEngine — self-built, dependency-free ARM64 interpreter (A-plan / M0).
 *
 * Replaces the earlier vendored unicorn.js (GPL-2.0, incompatible with this
 * project's AGPL-3.0 license) with a from-scratch decoder. An ISA is not
 * copyrightable, so a clean-room implementation carries no license burden and
 * gives us full control over memory, registers, and instrumentation hooks that
 * later milestones (ELF loader, libc/syscall/JNI layers) build upon.
 *
 * Strategy is target-driven and incremental: we decode the instruction classes
 * real target `.so` functions actually use, and throw on anything unimplemented
 * with the raw opcode so the gap is obvious and testable. Registers are stored
 * as 64-bit BigInt (true fidelity — no unicorn.js i64-via-number precision loss).
 *
 * M0 scope: linear execution of data-processing-immediate and
 * data-processing-register instructions. No branches, loads/stores, or syscalls
 * yet — those arrive with the milestones that need them.
 *
 * L1 adds `loadElf`: parse an ELF64 AArch64 shared object and map its PT_LOAD
 * segments at their virtual addresses, ready to execute from the ELF entry.
 */
import { ElfLoader } from './ElfLoader';

const EM_AARCH64 = 183;
const MASK64 = (1n << 64n) - 1n;
const MASK32 = (1n << 32n) - 1n;
const GPR_COUNT = 31; // x0..x30; encoding 31 means XZR/SP depending on context.
const MAX_STEPS = 1_000_000; // Runaway guard for the M0 linear executor.
const RETURN_SENTINEL = 0; // LR value that marks "return out of callSymbol".
const STACK_BASE = 0x7fff_0000; // Guest stack region base (grows down from the top).
const STACK_SIZE = 0x10000; // 64 KiB default emulated stack.

interface MappedRegion {
  base: number;
  size: number;
  data: Uint8Array;
}

/** Register/memory access handed to a host-function stub. */
export interface HostContext {
  /** Read argument/return register xN (0..30) as BigInt. */
  x(index: number): bigint;
  /** Write register xN. */
  setX(index: number, value: bigint): void;
  /** Read `length` bytes from guest memory at `address`. */
  read(address: number, length: number): Uint8Array;
  /** Write bytes into guest memory at `address`. */
  write(address: number, bytes: Uint8Array): void;
}

/** A host stub: receives the CPU context, optionally returns x0. */
export type HostFunction = (ctx: HostContext) => bigint | number | void;

/**
 * Register/memory view handed to a syscall handler. Same shape as HostContext
 * (read args, write result via return, touch guest memory) but named distinctly
 * because syscalls read their number from x8 and args from x0..x5.
 */
export type SyscallContext = HostContext;

/** A syscall handler: receives the CPU context, optionally returns x0. */
export type SyscallHandler = (ctx: SyscallContext) => bigint | number | void;

/**
 * Per-instruction trace event, delivered to instruction hooks just before each
 * instruction executes. Registers are read on demand (not pre-snapshotted) so a
 * hook that only watches the PC pays nothing for register access.
 */
export interface TraceEvent {
  /** Address of the instruction about to execute. */
  pc: number;
  /** The 32-bit little-endian instruction word. */
  insn: number;
  /** Monotonic step counter (1-based) within the current run. */
  step: number;
  /** Read GPR xN (0..30) as BigInt; index 31 reads 0 (XZR). */
  x(index: number): bigint;
  /** Read a named register (x0..x30, sp, pc) as a JS number. */
  reg(name: string): number;
}

/**
 * An instruction hook: observes (pc, insn, registers) before each instruction.
 * Read-only by contract — for instruction trace, register snapshots, and
 * breakpoints (a hook that inspects `pc`). It must not mutate engine state.
 */
export type InstructionHook = (event: TraceEvent) => void;

export class CpuEngine {
  private readonly gpr: bigint[] = Array.from({ length: GPR_COUNT }, () => 0n);
  private sp = 0n;
  /** PC and SP are addresses (< 2^53), kept as JS numbers to avoid BigInt churn in the fetch loop. */
  private pc = 0;
  private readonly regions: MappedRegion[] = [];
  /** Exported dynamic symbols (name → vaddr), populated by loadElf. */
  private symbols = new Map<string, number>();
  /** Set by branch instructions so the run loop skips its default PC increment. */
  private branched = false;
  /** NZCV condition flags (set by SUBS/CMP, read by B.cond). */
  private flagN = false;
  private flagZ = false;
  private flagC = false;
  private flagV = false;
  /** Host-function stubs keyed by guest address (libc imports, etc.). */
  private readonly hostFns = new Map<number, HostFunction>();
  /** Syscall handlers keyed by AArch64 syscall number (x8). */
  private readonly syscalls = new Map<number, SyscallHandler>();
  /** Top of the lazily-mapped guest stack (0 = not yet allocated). */
  private stackTop = 0;
  /** Instruction observers (trace/breakpoint). Empty ⇒ hot loop pays nothing. */
  private readonly instructionHooks: InstructionHook[] = [];

  /** Self-contained — no external engine to probe. */
  isAvailable(): boolean {
    return true;
  }

  /** Map a zero-filled region of guest memory. */
  mapMemory(address: number, size: number): void {
    this.regions.push({ base: address, size, data: new Uint8Array(size) });
  }

  /** Write bytes (machine code or data) into a mapped region. */
  writeCode(address: number, bytes: Uint8Array): void {
    const region = this.findRegion(address, bytes.length);
    region.data.set(bytes, address - region.base);
  }

  /**
   * Load an ELF64 AArch64 shared object: map every PT_LOAD segment at its
   * virtual address (with the zero-filled .bss tail) and return the entry point.
   */
  loadElf(bytes: Uint8Array): { entry: number } {
    const elf = new ElfLoader(bytes);
    if (elf.machine !== EM_AARCH64) {
      throw new Error(`Unsupported ELF machine 0x${elf.machine.toString(16)} (expected AArch64)`);
    }
    for (const seg of elf.loadableSegments()) {
      this.regions.push({ base: seg.vaddr, size: seg.data.length, data: seg.data });
    }
    this.symbols = elf.exportedSymbols();
    return { entry: elf.entry };
  }

  /**
   * Invoke an exported function by name following AArch64 AAPCS: integer
   * arguments go in x0..x7, the return value comes back in x0. A sentinel
   * return address is placed in LR (x30); execution halts when the function
   * returns to it. A fresh stack is mapped and SP set to its top so prologues
   * (stp x29,x30,[sp,#-16]!) have somewhere to spill. Returns the low 64 bits
   * of x0 as a JS number.
   */
  callSymbol(name: string, args: number[]): number {
    const addr = this.symbols.get(name);
    if (addr === undefined) {
      throw new Error(`Unknown symbol: "${name}" is not an exported function`);
    }
    if (args.length > 8) {
      throw new Error(`callSymbol supports up to 8 register arguments, got ${args.length}`);
    }
    for (let i = 0; i < args.length; i++) {
      this.gpr[i] = BigInt.asUintN(64, BigInt(args[i]!));
    }
    this.gpr[30] = BigInt(RETURN_SENTINEL); // LR → halt marker
    this.sp = BigInt(this.ensureStack());
    this.run(addr, RETURN_SENTINEL);
    return Number(this.gpr[0]);
  }

  /** List the exported dynamic symbol names callSymbol can resolve (from loadElf). */
  exportedSymbolNames(): string[] {
    return [...this.symbols.keys()];
  }

  /** Write a 64-bit value into a named register (x0..x30, sp, pc). */
  writeRegister(name: string, value: number): void {
    this.writeNamed(name, BigInt(value) & MASK64);
  }

  /** Read the current 64-bit value of a named register as a JS number. */
  readRegister(name: string): number {
    return Number(this.readNamed(name));
  }

  /** Register a host-function stub at a guest address (e.g. a libc import). */
  registerHostFunction(address: number, fn: HostFunction): void {
    this.hostFns.set(address, fn);
  }

  /** Register a syscall handler for an AArch64 syscall number (svc #0, nr in x8). */
  registerSyscall(nr: number, handler: SyscallHandler): void {
    this.syscalls.set(nr, handler);
  }

  /**
   * Register an instruction hook fired before each instruction executes
   * (trace/register-snapshot/breakpoint). Returns an unsubscribe function.
   * With no hooks registered the run loop skips the hook path entirely, so the
   * common case stays free of per-instruction overhead.
   */
  addInstructionHook(hook: InstructionHook): () => void {
    this.instructionHooks.push(hook);
    return () => {
      const i = this.instructionHooks.indexOf(hook);
      if (i >= 0) this.instructionHooks.splice(i, 1);
    };
  }

  /** Read `length` bytes from guest memory (copies out of the mapped region). */
  readMemory(address: number, length: number): Uint8Array {
    const region = this.findRegion(address, length);
    const offset = address - region.base;
    return region.data.slice(offset, offset + length);
  }

  /**
   * Lazily map a guest stack and return its top address (stacks grow down, so
   * SP starts at the high end). Mapped once and reused across callSymbol calls.
   */
  private ensureStack(): number {
    if (this.stackTop === 0) {
      this.mapMemory(STACK_BASE, STACK_SIZE);
      this.stackTop = STACK_BASE + STACK_SIZE;
    }
    return this.stackTop;
  }

  /** Invoke a registered host stub directly (exercise a stub in isolation). */
  callHost(address: number): void {
    const fn = this.hostFns.get(address);
    if (!fn) throw new Error(`No host function registered at 0x${address.toString(16)}`);
    this.invokeHost(fn);
  }

  /** Build the HostContext view over this engine's registers and memory. */
  private hostContext(): HostContext {
    return {
      x: (i) => this.readGpr(i),
      setX: (i, v) => this.writeGpr(i, BigInt.asUintN(64, v)),
      read: (addr, len) => this.readMemory(addr, len),
      write: (addr, bytes) => this.writeCode(addr, bytes),
    };
  }

  /** Run a host stub: call JS, store its return in x0 (if any). */
  private invokeHost(fn: HostFunction): void {
    const result = fn(this.hostContext());
    if (result !== undefined) {
      this.gpr[0] = BigInt.asUintN(64, BigInt(result));
    }
  }

  /** Execute linearly from `begin` until the PC reaches `until`. */
  start(begin: number, until: number): void {
    this.run(begin, until);
  }

  /**
   * Core fetch-decode-execute loop. Runs until PC === `stopAt`. Branch
   * instructions set PC directly and raise `this.branched` so the loop skips
   * the default +4 increment.
   */
  private run(begin: number, stopAt: number): void {
    this.pc = begin;
    let steps = 0;
    while (this.pc !== stopAt) {
      if (++steps > MAX_STEPS) {
        throw new Error(`Execution exceeded ${MAX_STEPS} steps (no halt before ${stopAt})`);
      }
      // A registered host stub (libc import) is a JS function, not guest code:
      // run it and return to the caller (PC ← LR) without fetching instructions
      // from an address that has no mapped code. The `size` guard keeps the
      // common stub-free hot loop free of a per-instruction Map.get.
      if (this.hostFns.size > 0) {
        const hostFn = this.hostFns.get(this.pc);
        if (hostFn) {
          this.invokeHost(hostFn);
          this.pc = Number(this.readGpr(30));
          continue;
        }
      }
      const region = this.findRegion(this.pc, 4);
      const offset = this.pc - region.base;
      const code = region.data;
      const insn =
        (code[offset]! |
          (code[offset + 1]! << 8) |
          (code[offset + 2]! << 16) |
          (code[offset + 3]! << 24)) >>>
        0;
      // Observability hook point: fire registered instruction hooks before
      // executing. The length guard keeps the hook-free hot loop at zero cost
      // (no closure allocation, no calls) — mirroring the hostFns.size guard.
      if (this.instructionHooks.length > 0) {
        this.fireInstructionHooks(this.pc, insn, steps);
      }
      this.branched = false;
      this.execute(insn);
      if (!this.branched) this.pc += 4;
    }
  }

  /** Build a read-only TraceEvent and dispatch it to every instruction hook. */
  private fireInstructionHooks(pc: number, insn: number, step: number): void {
    const event: TraceEvent = {
      pc,
      insn,
      step,
      x: (i) => this.readGpr(i),
      reg: (name) => this.readRegister(name),
    };
    for (const hook of this.instructionHooks) hook(event);
  }

  // ── Decode + execute ──

  private execute(insn: number): void {
    // Decode the opcode discriminants via direct inline bit extraction
    // (hot path: avoids per-field helper calls and lets V8 keep it monomorphic).
    const op2829 = (insn >>> 29) & 0b11;
    const op3126 = insn >>> 26;

    // B (unconditional branch): 000101 | imm26   → PC += SignExtend(imm26 << 2)
    if (op3126 === 0b000101) {
      this.pc += this.branchOffset(insn);
      this.branched = true;
      return;
    }

    // BL (branch with link): 100101 | imm26   → LR = PC+4; PC += offset
    if (op3126 === 0b100101) {
      this.gpr[30] = BigInt(this.pc + 4);
      this.pc += this.branchOffset(insn);
      this.branched = true;
      return;
    }

    // RET: 1101011 0 0 10 11111 000000 Rn 00000   → PC = X[Rn] (default LR)
    if ((insn & 0xfffffc1f) >>> 0 === 0xd65f0000) {
      const rn = (insn >>> 5) & 0b11111;
      this.pc = Number(this.readGpr(rn));
      this.branched = true;
      return;
    }

    // BR Rn: 1101011 0 0 00 11111 000000 Rn 00000  → PC = X[Rn] (indirect branch)
    if ((insn & 0xfffffc1f) >>> 0 === 0xd61f0000) {
      const rn = (insn >>> 5) & 0b11111;
      this.pc = Number(this.readGpr(rn));
      this.branched = true;
      return;
    }

    // BLR Rn: 1101011 0 0 01 11111 000000 Rn 00000  → LR = PC+4; PC = X[Rn]
    if ((insn & 0xfffffc1f) >>> 0 === 0xd63f0000) {
      const rn = (insn >>> 5) & 0b11111;
      const target = Number(this.readGpr(rn));
      this.gpr[30] = BigInt(this.pc + 4);
      this.pc = target;
      this.branched = true;
      return;
    }

    // ADD (immediate): sf | 0 | 0 | 100010 | sh | imm12 | Rn | Rd  (Rn/Rd use SP semantics)
    if (op2829 === 0b00 && ((insn >>> 23) & 0b111111) === 0b100010) {
      const sf = insn >>> 31;
      const sh = (insn >>> 22) & 1;
      let imm12 = (insn >>> 10) & 0xfff;
      if (sh === 1) imm12 <<= 12;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const sum = this.readGprSp(rn) + BigInt(imm12);
      this.writeGprSp(rd, sf === 1 ? BigInt.asUintN(64, sum) : BigInt.asUintN(32, sum));
      return;
    }

    // ADD (shifted register): sf | 0 | 0 | 01011 | shift | 0 | Rm | imm6 | Rn | Rd
    if (op2829 === 0b00 && ((insn >>> 24) & 0b11111) === 0b01011 && ((insn >>> 21) & 1) === 0) {
      const sf = insn >>> 31;
      const shiftType = (insn >>> 22) & 0b11;
      const rm = (insn >>> 16) & 0b11111;
      const imm6 = (insn >>> 10) & 0b111111;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const sum =
        imm6 === 0
          ? this.readGpr(rn) + this.readGpr(rm) // no-shift fast path (most common)
          : this.readGpr(rn) + this.applyShift(this.readGpr(rm), shiftType, imm6, sf);
      this.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, sum) : BigInt.asUintN(32, sum));
      return;
    }

    // SUB (immediate): sf | 1 | 0 | 100010 | sh | imm12 | Rn | Rd
    if (op2829 === 0b10 && ((insn >>> 23) & 0b111111) === 0b100010) {
      const sf = insn >>> 31;
      const sh = (insn >>> 22) & 1; // shift imm12 left by 12 when set
      let imm12 = (insn >>> 10) & 0xfff;
      if (sh === 1) imm12 <<= 12;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      // SUB uses SP semantics for Rn/Rd (encoding 31 = SP, not XZR).
      const diff = this.readGprSp(rn) - BigInt(imm12);
      this.writeGprSp(rd, sf === 1 ? BigInt.asUintN(64, diff) : BigInt.asUintN(32, diff));
      return;
    }

    // SUB (shifted register): sf | 1 | 0 | 01011 | shift | 0 | Rm | imm6 | Rn | Rd
    if (op2829 === 0b10 && ((insn >>> 24) & 0b11111) === 0b01011 && ((insn >>> 21) & 1) === 0) {
      const sf = insn >>> 31;
      const shiftType = (insn >>> 22) & 0b11;
      const rm = (insn >>> 16) & 0b11111;
      const imm6 = (insn >>> 10) & 0b111111;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const operand2 = this.applyShift(this.readGpr(rm), shiftType, imm6, sf);
      const diff = this.readGpr(rn) - operand2;
      this.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, diff) : BigInt.asUintN(32, diff));
      return;
    }

    // MOVZ (move wide immediate): sf | 10 | 100101 | hw | imm16 | Rd
    if (op2829 === 0b10 && ((insn >>> 23) & 0b111111) === 0b100101) {
      const sf = insn >>> 31;
      const hw = (insn >>> 21) & 0b11;
      const imm16 = (insn >>> 5) & 0xffff;
      const rd = insn & 0b11111;
      const value = BigInt(imm16) << BigInt(hw * 16);
      this.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value));
      return;
    }

    // ORR (shifted register): sf | 01 | 01010 | shift | 0 | Rm | imm6 | Rn | Rd
    //   MOV (register) is the alias ORR Rd, XZR, Rm. Rn/Rm use XZR for enc 31.
    if (op2829 === 0b01 && ((insn >>> 24) & 0b11111) === 0b01010 && ((insn >>> 21) & 1) === 0) {
      const sf = insn >>> 31;
      const shiftType = (insn >>> 22) & 0b11;
      const rm = (insn >>> 16) & 0b11111;
      const imm6 = (insn >>> 10) & 0b111111;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const operand2 = this.applyShift(this.readGpr(rm), shiftType, imm6, sf);
      const value = this.readGpr(rn) | operand2;
      this.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value));
      return;
    }

    // EOR (shifted register): sf | 10 | 01010 | shift | 0 | Rm | imm6 | Rn | Rd
    if (op2829 === 0b10 && ((insn >>> 24) & 0b11111) === 0b01010 && ((insn >>> 21) & 1) === 0) {
      const sf = insn >>> 31;
      const shiftType = (insn >>> 22) & 0b11;
      const rm = (insn >>> 16) & 0b11111;
      const imm6 = (insn >>> 10) & 0b111111;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const operand2 = this.applyShift(this.readGpr(rm), shiftType, imm6, sf);
      const value = this.readGpr(rn) ^ operand2;
      this.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value));
      return;
    }

    // SUBS/CMP (immediate): sf | 1 | 1 | 100010 | sh | imm12 | Rn | Rd  (S=1 sets flags)
    //   CMP is SUBS with Rd=XZR. Rn uses SP semantics.
    if (op2829 === 0b11 && ((insn >>> 23) & 0b111111) === 0b100010) {
      const sf = insn >>> 31;
      const sh = (insn >>> 22) & 1;
      let imm12 = (insn >>> 10) & 0xfff;
      if (sh === 1) imm12 <<= 12;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const result = this.subWithFlags(this.readGprSp(rn), BigInt(imm12), sf);
      this.writeGpr(rd, result); // Rd=31 → XZR, write discarded
      return;
    }

    // SUBS/CMP (shifted register): sf | 1 | 1 | 01011 | shift | 0 | Rm | imm6 | Rn | Rd
    if (op2829 === 0b11 && ((insn >>> 24) & 0b11111) === 0b01011 && ((insn >>> 21) & 1) === 0) {
      const sf = insn >>> 31;
      const shiftType = (insn >>> 22) & 0b11;
      const rm = (insn >>> 16) & 0b11111;
      const imm6 = (insn >>> 10) & 0b111111;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const operand2 = this.applyShift(this.readGpr(rm), shiftType, imm6, sf);
      const result = this.subWithFlags(this.readGpr(rn), operand2, sf);
      this.writeGpr(rd, result);
      return;
    }

    // CBZ/CBNZ: sf | 011010 | op | imm19 | Rt   (op: 0=CBZ 1=CBNZ)
    if (((insn >>> 25) & 0b111111) === 0b011010) {
      const sf = insn >>> 31;
      const op = (insn >>> 24) & 1;
      const rt = insn & 0b11111;
      const value = sf === 1 ? this.readGpr(rt) : BigInt.asUintN(32, this.readGpr(rt));
      const isZero = value === 0n;
      if (op === 0 ? isZero : !isZero) {
        this.pc += this.imm19Offset(insn);
        this.branched = true;
      }
      return;
    }

    // B.cond: 0101010 0 | imm19 | 0 | cond
    if (insn >>> 24 === 0b01010100 && ((insn >>> 4) & 1) === 0) {
      const cond = insn & 0b1111;
      if (this.conditionHolds(cond)) {
        this.pc += this.imm19Offset(insn);
        this.branched = true;
      }
      return;
    }

    // LDR/STR (immediate, general register): size | 111 | 0 | b2524 | opc(L) | …
    //   b2927 === 0b111, V(bit26) === 0 ⇒ integer load/store.
    //   bits 25:24 select form: 0b01 = unsigned offset, 0b00 = pre/post-index.
    //   bit 22 (L) = 0 store, 1 load. size(31:30): 2 = 32-bit Wt, 3 = 64-bit Xt.
    if (((insn >>> 27) & 0b111) === 0b111 && ((insn >>> 26) & 1) === 0) {
      const size = insn >>> 30; // 0=byte 1=half 2=word 3=dword
      const form = (insn >>> 24) & 0b11;
      const isLoad = ((insn >>> 22) & 1) === 1;
      const rn = (insn >>> 5) & 0b11111;
      const rt = insn & 0b11111;
      const bytes = 1 << size;

      if (form === 0b01) {
        // Unsigned offset: imm12 scaled by access size.
        const imm12 = (insn >>> 10) & 0xfff;
        const addr = Number(this.readGprSp(rn)) + imm12 * bytes;
        if (isLoad) this.writeGpr(rt, this.loadValue(addr, bytes));
        else this.storeValue(addr, bytes, this.readGpr(rt));
        return;
      }

      if (form === 0b00) {
        // Pre/post-index: imm9 signed; idx bits 11:10 (0b11 pre, 0b01 post).
        const imm9raw = (insn >>> 12) & 0x1ff;
        const imm9 = imm9raw & 0x100 ? imm9raw - 0x200 : imm9raw;
        const idx = (insn >>> 10) & 0b11;
        const base = Number(this.readGprSp(rn));
        const addr = idx === 0b11 ? base + imm9 : base; // pre adds before, post after
        if (isLoad) this.writeGpr(rt, this.loadValue(addr, bytes));
        else this.storeValue(addr, bytes, this.readGpr(rt));
        this.writeGprSp(rn, BigInt.asUintN(64, BigInt(base + imm9))); // writeback
        return;
      }
    }

    // LDP/STP (load/store pair): opc | 101 | V(0) | idx(24:23) | L | imm7 | Rt2 | Rn | Rt
    //   bits 29:25 === 0b10100 (V=0, integer); opc(31:30): 0b00 = 32-bit, 0b10 = 64-bit.
    //   idx(24:23): 0b01 post-index, 0b11 pre-index, 0b10 signed offset.
    //   L(bit22): 0 store, 1 load. imm7 signed, scaled by access size.
    if (((insn >>> 25) & 0b11111) === 0b10100) {
      const opc = insn >>> 30;
      const is64 = opc === 0b10;
      const bytes = is64 ? 8 : 4;
      const idx = (insn >>> 23) & 0b11;
      const isLoad = ((insn >>> 22) & 1) === 1;
      const imm7raw = (insn >>> 15) & 0x7f;
      const imm7 = (imm7raw & 0x40 ? imm7raw - 0x80 : imm7raw) * bytes;
      const rt2 = (insn >>> 10) & 0b11111;
      const rn = (insn >>> 5) & 0b11111;
      const rt = insn & 0b11111;
      const base = Number(this.readGprSp(rn));
      const addr = idx === 0b01 ? base : base + imm7; // post-index reads at base
      if (isLoad) {
        this.writeGpr(rt, this.loadValue(addr, bytes));
        this.writeGpr(rt2, this.loadValue(addr + bytes, bytes));
      } else {
        this.storeValue(addr, bytes, this.readGpr(rt));
        this.storeValue(addr + bytes, bytes, this.readGpr(rt2));
      }
      if (idx !== 0b10) {
        // pre/post-index write the updated base back; signed-offset (0b10) does not.
        this.writeGprSp(rn, BigInt.asUintN(64, BigInt(base + imm7)));
      }
      return;
    }

    // SVC #imm16: 11010100 000 imm16 000 01 → trap to a syscall handler.
    //   AArch64 ABI: syscall number in x8, args x0..x5, result returns in x0.
    if ((insn & 0xffe0001f) >>> 0 === 0xd4000001) {
      const nr = Number(this.readGpr(8));
      const handler = this.syscalls.get(nr);
      if (!handler) {
        throw new Error(`Unimplemented syscall ${nr} (x8) at pc=0x${this.pc.toString(16)}`);
      }
      const result = handler(this.hostContext());
      if (result !== undefined) {
        this.gpr[0] = BigInt.asUintN(64, BigInt(result));
      }
      return;
    }

    throw new Error(
      `Unsupported ARM64 opcode 0x${(insn >>> 0).toString(16).padStart(8, '0')} at pc=0x${this.pc.toString(16)}`,
    );
  }

  /** Decode a 26-bit branch immediate into a byte offset (sign-extended, ×4). */
  private branchOffset(insn: number): number {
    const imm26 = insn & 0x03ffffff;
    const signed = imm26 & 0x02000000 ? imm26 - 0x04000000 : imm26;
    return signed * 4;
  }

  /** Decode a 19-bit (bits 23:5) branch immediate into a byte offset (×4). */
  private imm19Offset(insn: number): number {
    const imm19 = (insn >>> 5) & 0x7ffff;
    const signed = imm19 & 0x40000 ? imm19 - 0x80000 : imm19;
    return signed * 4;
  }

  /**
   * Compute operand1 - operand2 at the given width, update NZCV, and return the
   * (width-masked) result. Subtraction is add-with-carry of ~operand2 + 1, so
   * C = "no borrow" and V = signed overflow, matching AArch64 SUBS semantics.
   */
  private subWithFlags(operand1: bigint, operand2: bigint, sf: number): bigint {
    const width = sf === 1 ? 64n : 32n;
    const mask = (1n << width) - 1n;
    const a = operand1 & mask;
    const b = operand2 & mask;
    const result = (a - b) & mask;
    this.flagN = result >> (width - 1n) === 1n;
    this.flagZ = result === 0n;
    this.flagC = a >= b; // unsigned: no borrow occurred
    const signA = (a >> (width - 1n)) & 1n;
    const signB = (b >> (width - 1n)) & 1n;
    const signR = (result >> (width - 1n)) & 1n;
    this.flagV = signA !== signB && signA !== signR; // signed overflow
    return result;
  }

  /** Evaluate an AArch64 condition code against the current NZCV flags. */
  private conditionHolds(cond: number): boolean {
    const n = this.flagN;
    const z = this.flagZ;
    const c = this.flagC;
    const v = this.flagV;
    switch (cond >> 1) {
      case 0b000:
        return cond & 1 ? !z : z; // EQ / NE
      case 0b001:
        return cond & 1 ? !c : c; // CS(HS) / CC(LO)
      case 0b010:
        return cond & 1 ? !n : n; // MI / PL
      case 0b011:
        return cond & 1 ? !v : v; // VS / VC
      case 0b100:
        return cond & 1 ? !(c && !z) : c && !z; // HI / LS
      case 0b101:
        return cond & 1 ? n !== v : n === v; // GE / LT
      case 0b110:
        return cond & 1 ? !(!z && n === v) : !z && n === v; // GT / LE
      default:
        return true; // AL / NV — always
    }
  }

  /** Apply an ARM64 shift (LSL/LSR/ASR/ROR) to a register operand. */
  private applyShift(value: bigint, shiftType: number, amount: number, sf: number): bigint {
    if (amount === 0) return value;
    const mask = sf === 1 ? MASK64 : MASK32;
    const width = sf === 1 ? 64n : 32n;
    const amt = BigInt(amount);
    switch (shiftType) {
      case 0b00: // LSL
        return (value << amt) & mask;
      case 0b01: // LSR
        return (value & mask) >> amt;
      case 0b10: {
        // ASR — sign-extend from the operand width.
        const signBit = 1n << (width - 1n);
        const signed = value & mask & signBit ? (value & mask) - (1n << width) : value & mask;
        return (signed >> amt) & mask;
      }
      default:
        throw new Error(`Unsupported shift type ${shiftType}`);
    }
  }

  // ── Register file (XZR semantics for encoding 31) ──

  private readGpr(index: number): bigint {
    if (index === 31) return 0n; // XZR
    return this.gpr[index] ?? 0n;
  }

  private writeGpr(index: number, value: bigint): void {
    if (index === 31) return; // writes to XZR are discarded
    this.gpr[index] = BigInt.asUintN(64, value);
  }

  /** Register access where encoding 31 means SP (used by ADD/SUB immediate). */
  private readGprSp(index: number): bigint {
    if (index === 31) return this.sp;
    return this.gpr[index] ?? 0n;
  }

  private writeGprSp(index: number, value: bigint): void {
    if (index === 31) {
      this.sp = BigInt.asUintN(64, value);
      return;
    }
    this.gpr[index] = BigInt.asUintN(64, value);
  }

  private writeNamed(name: string, value: bigint): void {
    const lower = name.toLowerCase();
    if (lower === 'sp') {
      this.sp = value;
      return;
    }
    if (lower === 'pc') {
      this.pc = Number(value);
      return;
    }
    if (lower === 'xzr') return;
    this.gpr[this.gprIndex(lower)] = value;
  }

  private readNamed(name: string): bigint {
    const lower = name.toLowerCase();
    if (lower === 'sp') return this.sp;
    if (lower === 'pc') return BigInt(this.pc);
    if (lower === 'xzr') return 0n;
    return this.gpr[this.gprIndex(lower)] ?? 0n;
  }

  /** Resolve "x0".."x30" to a register-file index, or throw on a bad name. */
  private gprIndex(lower: string): number {
    const match = /^x(\d{1,2})$/.exec(lower);
    const index = match ? Number(match[1]) : NaN;
    if (!Number.isInteger(index) || index < 0 || index >= GPR_COUNT) {
      throw new Error(`Unknown register: "${lower}"`);
    }
    return index;
  }

  // ── Memory ──

  private findRegion(address: number, length: number): MappedRegion {
    for (const region of this.regions) {
      if (address >= region.base && address + length <= region.base + region.size) {
        return region;
      }
    }
    throw new Error(`Unmapped memory access at 0x${address.toString(16)} (len ${length})`);
  }

  /** Read a little-endian unsigned integer of `bytes` width from guest memory. */
  private loadValue(address: number, bytes: number): bigint {
    const region = this.findRegion(address, bytes);
    const data = region.data;
    let offset = address - region.base;
    let value = 0n;
    for (let i = 0; i < bytes; i++) {
      value |= BigInt(data[offset++]!) << BigInt(i * 8);
    }
    return value;
  }

  /** Write the low `bytes` of `value` to guest memory, little-endian. */
  private storeValue(address: number, bytes: number, value: bigint): void {
    const region = this.findRegion(address, bytes);
    const data = region.data;
    let offset = address - region.base;
    let v = value;
    for (let i = 0; i < bytes; i++) {
      data[offset++] = Number(v & 0xffn);
      v >>= 8n;
    }
  }
}
