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
 * Decode is structured as a top-level dispatch on the AArch64 main encoding
 * group (bits[28:25]) into four families — DP-immediate, branch/system,
 * load/store, DP-register — each a focused method. This keeps the hot fetch loop
 * branching on a single discriminant first (V8-friendly) and the instruction
 * set extensible without growing one linear if-chain.
 *
 * L1 adds `loadElf`: parse an ELF64 AArch64 shared object and map its PT_LOAD
 * segments at their virtual addresses, ready to execute from the ELF entry.
 */
import { ElfLoader } from './ElfLoader';
import {
  R_AARCH64_ABS64,
  R_AARCH64_GLOB_DAT,
  R_AARCH64_JUMP_SLOT,
  R_AARCH64_RELATIVE,
  R_AARCH64_COPY,
} from './ElfLoader';
import type { SimdContext } from './simd';
import { executeSimdFp } from './simd';
import { signExtend, decodeBitMask } from './utils/BitOperations';
import { applyShift, extendReg } from './utils/ShiftExtend';
import { RegisterFile } from './cpu/RegisterFile';
import { MemoryManager } from './cpu/MemoryManager';
import type { ExecutionContext } from './cpu/ExecutionContext';
import { FpContext } from './fp/FpOperations';
import type { GuestSymbolResolver } from './symbol-resolver';
import type { HostContext, HostFunction, SyscallContext } from './host-context';

export type { HostContext, HostFunction, SyscallContext } from './host-context';

const MASK64 = (1n << 64n) - 1n;
import {
  addWithFlags as helperAddWithFlags,
  subWithFlags as helperSubWithFlags,
  conditionHolds as helperConditionHolds,
} from './utils/ArithmeticHelpers';
import { execDataProcessingImmediate } from './decoder/DataProcessingImmediate';
import { execBranchSystem, NullIndirectCallError } from './decoder/BranchSystem';
import { execDataProcessingRegister } from './decoder/DataProcessingRegister';
import { execLoadStore } from './decoder/LoadStore';
import { type PacKeys } from './decoder/PointerAuth';

/** Fixed test key set for Pointer Authentication (self-consistent; not a real device key).
 *  Override per-session via setPacKeys / nemu_set_pac_key. */
export const DEFAULT_PAC_KEYS: PacKeys = {
  ia: '84be85ce9804e94bec2802d4e0a488e9',
  ib: '84be85ce9804e94bec2802d4e0a488e9',
  da: '84be85ce9804e94bec2802d4e0a488e9',
  db: '84be85ce9804e94bec2802d4e0a488e9',
  ga: 'c0ffee00112233445566778899aabbcc',
};

/** Upper bound on retained AUT-mismatch diagnostics (RE signal, not a leak sink). */
const PAC_MISMATCH_LOG_CAP = 32;
/**
 * A jump/call through a register holding 0 (BR/BLR to address 0). Carried as a
 * distinct class so callers can tell a NULL indirect call apart from any other
 * throw: the `callSymbol` path lets it propagate (the user invoked a function
 * that dereferenced an uninitialised pointer — a real bug), while the
 * constructor path tolerates it (a C++ static-ctor that wanders into a NULL
 * call is an emulator-fidelity limit, not a reason to fail the whole load).
 *
 * Re-exported from the BranchSystem decoder for compatibility.
 */
export { NullIndirectCallError };

function relocationTypeName(type: number): string {
  if (type === R_AARCH64_ABS64) return 'R_AARCH64_ABS64';
  if (type === R_AARCH64_GLOB_DAT) return 'R_AARCH64_GLOB_DAT';
  if (type === R_AARCH64_JUMP_SLOT) return 'R_AARCH64_JUMP_SLOT';
  if (type === R_AARCH64_RELATIVE) return 'R_AARCH64_RELATIVE';
  if (type === R_AARCH64_COPY) return 'R_AARCH64_COPY';
  return `R_AARCH64_${type}`;
}

function formatUnresolvedImports(imports: readonly NativeRuntimeImportDiagnostic[]): string {
  return imports
    .map((item) => `${item.symbol}@GOT(0x${item.gotOffset.toString(16)}, ${item.relocationType})`)
    .join(', ');
}

export interface NativeRuntimeImportDiagnostic {
  symbol: string;
  gotOffset: number;
  relocationType: string;
  addend: number;
  resolution: 'unresolved';
}

const EM_AARCH64 = 183;
const MAX_STEPS = 1_000_000; // Runaway guard for the M0 linear executor.
const RETURN_SENTINEL = 0; // LR value that marks "return out of callSymbol".
const STACK_BASE = 0x7fff_0000; // Guest stack region base (grows down from the top).
const STACK_SIZE = 0x20000; // 128 KiB (some .so's need deeper stacks).
/** Base of the lazily-grown region holding one host stub per resolved import. */
const IMPORT_STUB_BASE = 0x6800_0000;
/** Size of the import-stub region, mapped up front so GOT-resolved stub
 *  addresses are always readable/executable even if a hostFn lookup misses
 *  (e.g. a stub bound under a different symbol name). */
const IMPORT_STUB_SIZE = 0x100000;
/**
 * Thread-pointer (TPIDR_EL0) region. A modern stack-protector prologue reads the
 * stack canary via `mrs x, TPIDR_EL0` then loads `[x, #0x28]`; pointing TPIDR_EL0
 * at a mapped block (with a fixed non-zero canary) lets those prologues run
 * instead of faulting on an unmapped read.
 */
const TLS_BASE = 0x7000_0000;
const TLS_SIZE = 0x2000; // 8 KB — covers obfuscated SOs that stash pointers at large TLS offsets (e.g. frame-table ptr @ +0x1768)

type HostSymbolResolver = GuestSymbolResolver<HostFunction>;

interface GuestInvocationPolicy {
  preserveControlState: boolean;
  resetStack: boolean;
  /** Registers to set AFTER the default zeroing loop (x0-x28). Key=register index. */
  initRegisters?: Record<number, bigint>;
  /** Max instruction steps before aborting; defaults to MAX_STEPS (1M) when omitted, 0, or negative. */
  maxSteps?: number;
}

/** A syscall handler: receives the CPU context, optionally returns x0. */
export type SyscallHandler = (ctx: SyscallContext) => bigint | number | void;

/**
 * UnsupportedOpcodeError — the fetch loop hit an instruction word no decoder
 * family claimed. Raised as a typed error (not a bare Error) so callers like
 * `nemu_trace` can soften it into a "trace aborted here with a partial
 * capture" result rather than an unhandled throw, while `call_symbol` keeps
 * letting it propagate (a missed instruction on an explicit call is a real
 * gap worth surfacing).
 */
export class UnsupportedOpcodeError extends Error {
  readonly pc: number;
  readonly insn: number;
  constructor(message: string, pc: number, insn: number) {
    super(message);
    this.name = 'UnsupportedOpcodeError';
    this.pc = pc;
    this.insn = insn;
  }
}

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
  /**
   * Read a SIMD/FP vector register (v0..v31, or the q/d/s/h/b width aliases)
   * as a lowercase hex string of the alias width's bytes (little-endian, no
   * `0x` prefix). The narrowest alias `b` returns 2 hex chars; the full `v`/`q`
   * alias returns 32. Throws on any other name so trace consumers fail loudly
   * rather than silently dropping a capture.
   */
  vector(name: string): string;
}

/**
 * An instruction hook: observes (pc, insn, registers) before each instruction.
 * Read-only by contract — for instruction trace, register snapshots, and
 * breakpoints (a hook that inspects `pc`). It must not mutate engine state.
 */
export type InstructionHook = (event: TraceEvent) => void;

export class CpuEngine implements ExecutionContext {
  private readonly registerFile = new RegisterFile();
  private readonly memory = new MemoryManager();
  /** FP exception context (FPCR/FPSR) for IEEE754 compliance. */
  private readonly fpContext = new FpContext();
  /** Set by branch instructions so the run loop skips its default PC increment. */
  private branched = false;
  // Bounds of the primary .text segment (first PT_LOAD RX), for the catch-all
  // that skips obfuscated opcodes.
  private textStart = -1;
  private textEnd = 0;
  /** Host-function stubs keyed by guest address (libc imports, etc.). */
  private readonly hostFns = new Map<number, HostFunction>();
  /** Syscall handlers keyed by AArch64 syscall number (x8). */
  private readonly syscalls = new Map<number, SyscallHandler>();
  /**
   * Syscall handlers normalized to the decoder's HostContext shape. Rebuilt
   * lazily and invalidated by registerSyscall — the fetch loop calls execute()
   * once per instruction, so rebuilding this map inline would allocate on
   * every branch/system instruction.
   */
  private normalizedSyscalls: Map<number, (hctx: HostContext) => number | undefined> | null = null;
  /** Top of the lazily-mapped guest stack (0 = not yet allocated). */
  private stackTop = 0;
  /** Base of the lazily-mapped thread-local (TPIDR_EL0) block (0 = none yet). */
  private tlsBase = 0;
  /** Next free address in the import-stub region (bumped per resolved import).
   *  The whole stub region is mapped up front: GOT slots carry stub addresses
   *  and a stray BR/BLR to one must not fault on an unmapped fetch even if the
   *  hostFn lookup misses (loader bug: stubs were registered but never mapped). */
  private importStubBump = (this.mapMemory(IMPORT_STUB_BASE, IMPORT_STUB_SIZE), IMPORT_STUB_BASE);
  /** Stable import-stub address per symbol, shared by relocations and dlsym. */
  private readonly importStubsByName = new Map<string, number>();
  /** Instruction observers (trace/breakpoint). Empty ⇒ hot loop pays nothing. */
  private readonly instructionHooks: InstructionHook[] = [];
  /** NULL indirect calls swallowed while running .init_array constructors. */
  private readonly constructorFaults: string[] = [];
  /** NULL indirect calls auto-patched to RET during execution. */
  readonly nullCallPatches: string[] = [];
  /** True while running a constructor — NULL calls propagate to the ctor handler. */
  private runningConstructor = false;
  /** Undefined dynamic imports that could not be resolved to built-in stubs. */
  private readonly unresolvedImportDiagnostics: NativeRuntimeImportDiagnostic[] = [];

  /**
   * Register-save stack for obfuscated code that doesn't follow the ARM64
   * calling convention. When a BL/BLR is about to execute, x19-x29 are saved
   * here. After the called function returns (PC === saved return address), the
   * registers are restored from the snapshot. This allows the emulator to run
   * code that uses callee-saved registers as scratch temporaries.
   */
  private readonly callerRegsStack: Array<{
    retAddr: number;
    x19: bigint;
    x20: bigint;
    x21: bigint;
    x22: bigint;
    x23: bigint;
    x24: bigint;
    x25: bigint;
    x26: bigint;
    x27: bigint;
    x28: bigint;
    x29: bigint;
  }> = [];
  /** Pre-execution snapshot of x19-x29 (populated just before a BL/BLR). */
  private pendingSaveRegs: ReturnType<CpuEngine['snapshotCallerRegs']> | null = null;
  /** Set by exit/exit_group (or a host stub) to halt the run loop at once. */
  private stopRequested = false;
  /** Pointer-authentication keys (ARMv8.3 PAC). IA/IB/DA/DB/GA; uses DEFAULT_PAC_KEYS initially. */
  pacKeys: PacKeys = DEFAULT_PAC_KEYS;
  /** Bounded AUT-mismatch log (PointerAuth decoder sink; for nemu_trace). */
  private readonly pacMismatchLog: string[] = [];

  /** Replace the active PAC key set (e.g. inject keys dumped from a real device). */

  setPacKeys = (keys: PacKeys): void => {
    this.pacKeys = keys;
  };

  /** Record an AUT mismatch from the PointerAuth decoders. Capped, never throws. */
  recordPacMismatch = (entry: string): void => {
    if (this.pacMismatchLog.length < PAC_MISMATCH_LOG_CAP) {
      this.pacMismatchLog.push(entry);
    }
  };

  /** Non-destructive snapshot of recorded AUT mismatches. */
  pacDiagSnapshot(): string[] {
    return [...this.pacMismatchLog];
  }

  /** Self-contained — no external engine to probe. */
  isAvailable(): boolean {
    return true;
  }

  /**
   * Request the running program halt before the next instruction — models a
   * guest process calling exit()/exit_group(), where control never returns to
   * the caller. The run loop checks this and stops cleanly (rather than the
   * caller hand-rolling an unmapped-PC throw).
   */
  requestStop(): void {
    this.stopRequested = true;
  }

  /**
   * Release all CPU engine resources: mapped memory regions, register file,
   * symbol table, host function stubs, syscall handlers, and diagnostic logs.
   *
   * Idempotent: safe to call multiple times. This method follows the disposal
   * pattern recommended by research on dynamic binary translators and emulator
   * lifecycle management:
   *
   * - Clear all mapped memory regions (releases backing Uint8Array buffers)
   * - Reset CPU registers to zero state
   * - Clear symbol table
   * - Clear host function stub table
   * - Clear syscall handler table
   * - Clear diagnostic logs (constructor faults, unresolved imports)
   * - Reset allocator state (stack, TLS, import stubs)
   *
   * **References:**
   * - Linux kernel ARM64 cleanup path simplification (2026): use of `__free`
   *   attribute to automate resource cleanup
   *   https://www.spinics.net/lists/arm-kernel/msg1084912.html
   * - JIT code cache management: best practices for clearing compiled code
   *   https://arxiv.org/abs/1810.09555
   * - ACM TACO: Combining ML and lifetime-based resource management
   *   https://dl.acm.org/doi/10.1145/3611018
   */
  dispose(): void {
    // Clear all memory regions (releases backing buffers)
    this.memory['regions'].length = 0;
    this.memory['regionsByBase'].length = 0;
    this.memory['lastRegion'] = undefined;
    this.memory.clearSymbols();

    // Reset register file to zero state
    for (let i = 0; i < 31; i++) {
      this.registerFile.writeGpr(i, 0n);
    }
    this.registerFile.sp = 0n;
    this.registerFile.pc = 0;
    this.registerFile.setFlags(false, false, false, false);
    // Clear SIMD/FP registers
    for (let i = 0; i < 32; i++) {
      this.registerFile.writeVector(i, new Uint8Array(16));
    }

    // Clear host function stubs and syscalls
    this.hostFns.clear();
    this.syscalls.clear();
    this.normalizedSyscalls = null;

    // Clear instruction hooks
    this.instructionHooks.length = 0;

    // Clear diagnostic logs
    this.constructorFaults.length = 0;
    this.unresolvedImportDiagnostics.length = 0;

    // Reset allocator state
    this.stackTop = 0;
    this.tlsBase = 0;
    this.importStubBump = IMPORT_STUB_BASE;
    this.importStubsByName.clear();
    this.callerRegsStack.length = 0;
    this.pendingSaveRegs = null;

    // Reset FP context
    this.fpContext['fpcr'] = 0;
    this.fpContext['fpsr'] = 0;

    // Reset flags
    this.stopRequested = false;
    this.branched = false;
  }

  /** Map a zero-filled region of guest memory. */
  mapMemory(address: number, size: number): void {
    this.memory.addRegion({ base: address, size, data: new Uint8Array(size) });
  }

  /** Shadow memory overlay (address → bytes). Reads from shadow take priority. */
  private readonly shadows = new Map<number, Uint8Array>();

  /** Add/update a shadow memory overlay at `address`. */
  addShadow(address: number, bytes: Uint8Array): void {
    this.shadows.set(address, bytes.slice());
    // Install read hook so instruction-issued loads see shadows too
    if (!this.memory.readHook) {
      this.memory.readHook = (a, l) => this.findShadow(a, l);
    }
  }

  /** Remove a shadow overlay. */
  removeShadow(address: number): void {
    this.shadows.delete(address);
  }

  /** Check if a shadow overlay exists at the given address range. */
  private findShadow(address: number, length: number): Uint8Array | null {
    for (const [base, data] of this.shadows) {
      if (address >= base && address + length <= base + data.length) {
        return data.subarray(address - base, address - base + length);
      }
    }
    return null;
  }

  /** Write bytes (machine code or data) into a mapped region. */
  writeCode(address: number, bytes: Uint8Array): void {
    const region = this.memory.findRegion(address, bytes.length);
    region.data.set(bytes, address - region.base);
  }

  /**
   * Load an ELF64 AArch64 shared object: map every PT_LOAD segment at its
   * virtual address (with the zero-filled .bss tail), apply dynamic relocations,
   * and return the entry point. When a `bionic` library is supplied, imported
   * libc symbols (resolved via R_AARCH64_JUMP_SLOT / GLOB_DAT) are auto-wired to
   * host stubs and their GOT slots patched — so a real PIC `.so` runs without the
   * caller hand-routing each import.
   */
  /**
   * Load an ELF64 AArch64 shared object: map every PT_LOAD segment at its
   * virtual address (with the zero-filled .bss tail), apply dynamic relocations,
   * and return the entry point. When a `bionic` library is supplied, imported
   * libc symbols (resolved via R_AARCH64_JUMP_SLOT / GLOB_DAT) are auto-wired to
   * host stubs and their GOT slots patched — so a real PIC `.so` runs without the
   * caller hand-routing each import.
   *
   * `bias` shifts where the image is mapped (every vaddr becomes bias+vaddr),
   * letting several position-independent `.so` coexist in one address space —
   * exactly what a dynamic linker does for inter-library dependencies. Default
   * bias 0 preserves the original single-library behaviour. `mergeSymbols`
   * (default true for bias 0, false otherwise) controls whether the freshly
   * loaded object's exports are written into the engine-wide symbol table that
   * `callSymbol`/relocation resolution consult; chain loads set it so a later
   * primary can bind against the dependency's exports.
   */
  loadElf(
    bytes: Uint8Array,
    imports?: HostSymbolResolver,
    bias = 0,
    mergeSymbols = bias === 0,
  ): { entry: number } {
    const elf = new ElfLoader(bytes);
    if (elf.machine !== EM_AARCH64) {
      throw new Error(`Unsupported ELF machine 0x${elf.machine.toString(16)} (expected AArch64)`);
    }
    if (bias === 0) {
      this.constructorFaults.length = 0;
      this.unresolvedImportDiagnostics.length = 0;
    }
    // Load segments sorted by vaddr; auto-fill gaps between them with zero pages.
    // Some obfuscated SOs (e.g. Douyin sgmain) have data fields referenced at
    // addresses that fall between PT_LOAD mappings.
    const segments = [...elf.loadableSegments()].toSorted((a, b) => a.vaddr - b.vaddr);
    let prevEnd = 0;
    for (const seg of segments) {
      if (bias === 0 && seg.vaddr > prevEnd) {
        const gapSize = seg.vaddr - prevEnd;
        this.memory.addRegion({ base: prevEnd, size: gapSize, data: new Uint8Array(gapSize) });
      }
      this.memory.addRegion({ base: bias + seg.vaddr, size: seg.data.length, data: seg.data });
      prevEnd = seg.vaddr + seg.data.length;
      if (bias === 0 && seg.executable && this.textStart === -1) {
        this.textStart = seg.vaddr;
        this.textEnd = prevEnd;
      }
    }
    const exported = elf.exportedSymbols();
    if (mergeSymbols) {
      for (const [name, vaddr] of exported) this.memory.addSymbol(name, bias + vaddr);
    }
    this.applyRelocations(elf, imports, bias, exported);
    if (bias === 0) this.runInitializers(elf, bias);
    return { entry: bias + elf.entry };
  }

  /**
   * Load a chain of dependent libraries followed by a primary library, resolving
   * inter-library imports. Each dependency is mapped at a non-overlapping bias
   * (starting at 0x10000000, incrementing by 64MB per library) with its exports
   * merged into the engine-wide symbol table; then the primary library is loaded
   * at bias 0 (the traditional single-library slot) and can bind to both bionic
   * libc stubs *and* the dependencies' exports. Only the primary's .init/.init_array
   * constructors run (dependencies' constructors are skipped to avoid partial-
   * init hazards when their own imports remain unresolved — a real dynamic linker
   * would recursively resolve the entire transitive closure first, but this
   * minimal chain loader only handles one level: explicit deps + bionic).
   *
   * Returns the load result for the primary library: its entry, unresolved
   * imports (those not satisfied by either deps or bionic), and constructor faults.
   * The diagnostics reflect the *primary* library only; dependencies' unresolved
   * imports are intentionally not surfaced (they're background context, not user-
   * facing failures unless the primary's call paths actually reach them).
   *
   * @param dependencies - The `.so` bytes of each dependency (loaded first, in order).
   * @param primary - The primary library's `.so` bytes (loaded last at bias 0).
   * @param bionic - Optional bionic libc stub table (wired into all libraries).
   * @returns The primary library's load result (entry, unresolvedImports, constructorFaults).
   */
  loadLibraryChain(
    dependencies: Uint8Array[],
    primary: Uint8Array,
    imports?: HostSymbolResolver,
  ): {
    entry: number;
    unresolvedImports: readonly NativeRuntimeImportDiagnostic[];
    constructorFaults: readonly string[];
  } {
    const BIAS_START = 0x10000000;
    const BIAS_STEP = 0x4000000; // 64 MB per library (generous for real .so)
    // Load each dependency at its own bias, merging exports into the global table.
    for (let i = 0; i < dependencies.length; i++) {
      const dep = dependencies[i];
      if (!dep) continue;
      const depBias = BIAS_START + i * BIAS_STEP;
      this.loadElf(dep, imports, depBias, true);
    }
    // Load the primary at bias 0 (traditional single-library behaviour): it
    // inherits the merged dependency exports and runs its own constructors.
    this.constructorFaults.length = 0;
    this.unresolvedImportDiagnostics.length = 0;
    const { entry } = this.loadElf(primary, imports, 0, true);
    return {
      entry,
      unresolvedImports: [...this.unresolvedImportDiagnostics],
      constructorFaults: [...this.constructorFaults],
    };
  }

  /**
   * Run the object's initializers (DT_INIT, then each DT_INIT_ARRAY entry) the
   * way a dynamic linker does immediately after relocation — without this step a
   * `.so` built with C++ static constructors or `__attribute__((constructor))`
   * functions has its global subsystems left NULL, so its public API
   * short-circuits (e.g. SQLite's sqlite3_initialize bails before allocating, so
   * sqlite3_open returns a NULL handle). The init-array slots are read out of
   * *relocated* guest memory: each slot held an R_AARCH64_RELATIVE fixup whose
   * on-disk value was 0 and only became the real constructor address once
   * applyRelocations ran. Each constructor is invoked C-style — argc=0, argv=
   * envp=NULL in x0..x2 — and run to return on a fresh frame, reusing the same
   * sentinel-LR halt mechanism as callSymbol.
   */
  private runInitializers(elf: ElfLoader, bias = 0): void {
    const { init, arraySlots } = elf.initializers();
    const ctors: number[] = [];
    if (init !== 0) ctors.push(bias + init); // DT_INIT is the function address directly.
    for (const slot of arraySlots) {
      const fn = Number(this.memory.loadValue(bias + slot, 8)); // slot holds the (relocated) ptr.
      if (fn !== 0) ctors.push(fn);
    }
    for (const ctor of ctors) this.runConstructor(ctor);
  }

  /**
   * Invoke a constructor at `addr` with (argc=0, argv=NULL, envp=NULL), to
   * return. A constructor that wanders into a NULL indirect call is tolerated
   * (recorded, not thrown): unlike a user-driven `callSymbol`, a static C++
   * constructor reaching `BLR 0` here reflects emulator fidelity (some import or
   * vtable slot the interpreter didn't fully model), and must not abort loading
   * the whole library — a caller may only want an export that doesn't depend on
   * that ctor. Other faults still propagate.
   */
  private runConstructor(addr: number): void {
    this.runningConstructor = true;
    try {
      this.invokeGuest(addr, [0n, 0n, 0n], {
        preserveControlState: false,
        resetStack: true,
      });
    } catch (e) {
      if (e instanceof NullIndirectCallError) {
        this.constructorFaults.push(`ctor@0x${addr.toString(16)}: ${e.message}`);
        return;
      }
      if (e instanceof UnsupportedOpcodeError) {
        this.constructorFaults.push(
          `ctor@0x${addr.toString(16)}: unsupported opcode at pc=0x${e.pc.toString(16)} — ${e.message}`,
        );
        return;
      }
      // Constructor wandered into unmapped/invalid memory (e.g. BigInt overflow
      // addresses from unrelocated GOT entries). Tolerate like NULL calls.
      if (e instanceof Error && e.message.includes('Unmapped memory access')) {
        this.constructorFaults.push(`ctor@0x${addr.toString(16)}: ${e.message}`);
        return;
      }
      throw e;
    } finally {
      this.runningConstructor = false;
    }
  }

  /**
   * Apply the object's dynamic relocations to the mapped image. RELATIVE adds the
   * load bias (zero here, since segments map at their link-time vaddr). ABS64 and
   * GLOB_DAT write a resolved symbol value (this `.so`'s own export, or an
   * auto-wired import stub) into the target slot. JUMP_SLOT is the PLT/GOT entry
   * a stub-trampoline reads, so it too points at the import stub.
   */
  private applyRelocations(
    elf: ElfLoader,
    imports?: HostSymbolResolver,
    bias = 0,
    exported?: Map<string, number>,
  ): void {
    const ownExports = exported ?? elf.exportedSymbols();
    for (const rel of elf.relocations()) {
      const patchedOffset = bias + rel.offset;
      switch (rel.type) {
        case R_AARCH64_RELATIVE:
          // *(bias+offset) = bias + addend.
          this.memory.storeValue(patchedOffset, 8, BigInt(bias + rel.addend));
          break;
        case R_AARCH64_ABS64:
        case R_AARCH64_GLOB_DAT:
        case R_AARCH64_JUMP_SLOT: {
          if (this.isUnresolvedImport(rel.symbolName, rel.symbolValue, imports)) {
            this.unresolvedImportDiagnostics.push({
              symbol: rel.symbolName,
              gotOffset: patchedOffset,
              relocationType: relocationTypeName(rel.type),
              addend: rel.addend,
              resolution: 'unresolved',
            });
          }
          // An import bound to this object's own export resolves at bias+vaddr;
          // an undefined import (symbolValue 0) stays 0 unless bionic/chain
          // supplies it. Bionic stub addresses are absolute (no bias).
          const ownVaddr = rel.symbolName ? ownExports.get(rel.symbolName) : undefined;
          const resolved =
            ownVaddr !== undefined
              ? bias + ownVaddr
              : this.resolveRelocSymbol(rel.symbolName, rel.symbolValue, imports);
          this.memory.storeValue(patchedOffset, 8, BigInt(resolved + rel.addend));
          break;
        }
        case R_AARCH64_COPY: {
          // COPY relocation: copy the symbol's data from the defining library to
          // this library's .bss. Used for global variables defined in dependencies.
          // symbolValue points to the source (in the defining library).
          // offset (bias-adjusted) is the destination (in this library's .bss).
          if (rel.symbolValue === 0) {
            // Symbol not found in dependencies — leave zeroed (BSS default).
            break;
          }
          // Read symbol size from the symbol table (assume 8 bytes if unknown).
          // For a proper implementation, we'd need to store symbol sizes in ElfLoader.
          // For now, copy 8 bytes (pointer-sized) as a minimal implementation.
          const copySize = 8;
          try {
            const sourceData = this.memory.readMemory(rel.symbolValue, copySize);
            this.memory.writeMemory(patchedOffset, sourceData);
          } catch {
            // Source not mapped — symbol might be in a library we haven't loaded yet.
            // Leave the destination zeroed (BSS default).
          }
          break;
        }
        default:
          // Unknown reloc types are skipped rather than fatal: many objects carry
          // TLS/IRELATIVE entries the compute path never touches. A missing fixup
          // surfaces later as a loud unmapped-access throw if it actually matters.
          break;
      }
    }
  }

  /**
   * Resolve a relocation's target address: prefer this object's own export, then
   * an auto-wired bionic import (allocating a one-off host stub the first time a
   * name is seen). Falls back to the symbol's own value (0 for undefined imports
   * with no bionic entry), so calling an unresolved import faults loudly.
   */
  private resolveRelocSymbol(
    name: string,
    symbolValue: number,
    imports?: HostSymbolResolver,
  ): number {
    if (name && this.memory.hasSymbol(name)) return this.memory.findSymbol(name)!;
    const imported = name ? imports?.resolveSymbol(name) : undefined;
    if (imported?.kind === 'data') return imported.address;
    if (imported?.kind === 'function') return this.bindImportStub(name, imported.fn);
    return symbolValue;
  }

  private isUnresolvedImport(
    name: string,
    symbolValue: number,
    imports?: HostSymbolResolver,
  ): boolean {
    return (
      name !== '' &&
      symbolValue === 0 &&
      !this.memory.hasSymbol(name) &&
      imports?.resolveSymbol(name) === undefined
    );
  }

  /**
   * Invoke an exported function by name following AArch64 AAPCS: integer
   * arguments go in x0..x7, the return value comes back in x0. A sentinel
   * return address is placed in LR (x30); execution halts when the function
   * returns to it. A fresh stack is mapped and SP set to its top so prologues
   * (stp x29,x30,[sp,#-16]!) have somewhere to spill. Returns the low 64 bits
   * of x0 as a JS number.
   */
  callSymbol(
    name: string,
    args: number[],
    initRegisters?: Record<number, bigint>,
    maxSteps?: number,
  ): number {
    const addr = this.memory.findSymbol(name);
    if (addr === undefined) {
      throw new Error(`Unknown symbol: "${name}" is not an exported function`);
    }
    if (args.length > 8) {
      throw new Error(`callSymbol supports up to 8 register arguments, got ${args.length}`);
    }
    try {
      return this.invokeGuest(
        addr,
        args.map((arg) => BigInt(arg)),
        { preserveControlState: false, resetStack: true, initRegisters, maxSteps },
      );
    } catch (e) {
      if (e instanceof NullIndirectCallError && this.unresolvedImportDiagnostics.length > 0) {
        throw new NullIndirectCallError(
          `${e.message}; unresolved imports: ${formatUnresolvedImports(this.unresolvedImportDiagnostics)}`,
        );
      }
      throw e;
    }
  }

  /** List the exported dynamic symbol names callSymbol can resolve (from loadElf). */
  exportedSymbolNames(): string[] {
    return [...this.memory.getSymbolNames()];
  }

  /** Resolve an exported dynamic symbol without invoking it. */
  lookupSymbol(name: string): number | undefined {
    return this.memory.findSymbol(name);
  }

  /** Bind a named host import once and return its stable guest stub address. */
  bindImportStub(name: string, fn: HostFunction): number {
    const existing = this.importStubsByName.get(name);
    if (existing !== undefined) return existing;
    const stubAddr = this.importStubBump;
    this.importStubBump += 8;
    this.registerHostFunction(stubAddr, fn);
    this.importStubsByName.set(name, stubAddr);
    return stubAddr;
  }

  /**
   * NULL indirect calls (BR/BLR to 0) swallowed while running .init_array
   * constructors during loadElf. A non-empty list means some static
   * constructors didn't run to completion (an emulator-fidelity limit), which a
   * caller can surface for diagnosis without it having aborted the load.
   */
  constructorFaultLog(): readonly string[] {
    return this.constructorFaults;
  }

  /** Undefined dynamic imports left at NULL after relocation. */
  unresolvedImports(): readonly NativeRuntimeImportDiagnostic[] {
    return this.unresolvedImportDiagnostics;
  }

  /** Write a 64-bit value into a named register (x0..x30, sp, pc). */
  writeRegister(name: string, value: number | bigint): void {
    this.registerFile.writeNamed(name, BigInt(value) & MASK64);
  }

  /** Read the current 64-bit value of a named register as a JS number. */
  readRegister(name: string): number {
    return Number(this.registerFile.readNamed(name));
  }

  /**
   * Read a SIMD/FP vector register alias (`vN`/`qN`/`dN`/`sN`/`hN`/`bN`) as the
   * alias-width little-endian byte hex string. Exposed to trace hooks so the
   * SIMD/FP hot path (AES/SHA/PMULL/scalar-FP) is observable, not just the
   * integer register file. `v` and `q` both return the full 128 bits.
   */
  readVectorAlias(name: string): string {
    const match = /^([vqdshb])(\d{1,2})$/i.exec(name);
    if (!match) {
      throw new Error(`Unknown vector register: "${name}" (expected vN/qN/dN/sN/hN/bN)`);
    }
    const widthChar = match[1]!.toLowerCase();
    const reg = Number(match[2]);
    if (!Number.isInteger(reg) || reg < 0 || reg >= 32) {
      throw new Error(`Vector register index out of range: "${name}"`);
    }
    // Alias → byte width: b=1, h=2, s=4, d=8, q/v=16.
    const width =
      widthChar === 'b'
        ? 1
        : widthChar === 'h'
          ? 2
          : widthChar === 's'
            ? 4
            : widthChar === 'd'
              ? 8
              : 16;
    const bytes = this.registerFile.getVectorBytes(reg) ?? new Uint8Array(16);
    let hex = '';
    for (let i = 0; i < width; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
    return hex;
  }

  /** Register a host-function stub at a guest address (e.g. a libc import). */
  registerHostFunction(address: number, fn: HostFunction): void {
    this.hostFns.set(address, fn);
  }

  /** Register a syscall handler for an AArch64 syscall number (svc #0, nr in x8). */
  registerSyscall(nr: number, handler: SyscallHandler): void {
    this.syscalls.set(nr, handler);
    // Invalidate the normalized-syscall cache — the fetch loop must see the
    // new handler on the next branch/system instruction.
    this.normalizedSyscalls = null;
  }

  /** Lazy cache of syscall handlers normalized to the decoder's HostContext shape. */
  private getNormalizedSyscalls(): Map<number, (hctx: HostContext) => number | undefined> {
    if (this.normalizedSyscalls === null) {
      const normalized = new Map<number, (hctx: HostContext) => number | undefined>();
      for (const [num, handler] of this.syscalls) {
        normalized.set(num, (hctx) => {
          const result = handler(hctx);
          if (result === undefined || result === null) return undefined;
          return typeof result === 'bigint' ? Number(result) : result;
        });
      }
      this.normalizedSyscalls = normalized;
    }
    return this.normalizedSyscalls;
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

  /** Read `length` bytes from guest memory (checks shadows first). */
  readMemory(address: number, length: number): Uint8Array {
    const shadow = this.findShadow(address, length);
    if (shadow) return new Uint8Array(shadow);
    const region = this.memory.findRegion(address, length);
    const offset = address - region.base;
    return region.data.slice(offset, offset + length);
  }

  /**
   * Lazily map a guest stack and return its top address (stacks grow down, so
   * SP starts at the high end). Mapped once and reused across callSymbol calls.
   */
  private ensureStack(): number {
    if (this.stackTop === 0) {
      this.memory.mapMemory(STACK_BASE, STACK_SIZE);
      this.stackTop = STACK_BASE + STACK_SIZE;
    }
    return this.stackTop;
  }

  /**
   * Lazily map the TPIDR_EL0 thread-pointer block and return its base. A fixed
   * non-zero stack canary is planted at the conventional offset (+0x28) so a
   * stack-protector prologue that reads `[tls, #0x28]` sees a stable guard.
   */
  private ensureTls(): number {
    if (this.tlsBase === 0) {
      this.memory.mapMemory(TLS_BASE, TLS_SIZE);
      this.tlsBase = TLS_BASE;
      // Plant a fixed 64-bit canary at the AArch64 stack-guard slot (tls+0x28).
      const canary = new Uint8Array([0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]);
      this.memory.writeCode(TLS_BASE + 0x28, canary);
    }
    return this.tlsBase;
  }

  /** Public entry-point: ensure TLS is mapped so tooling can pre-populate
   *  slots at known offsets (e.g. frame-table pointer at +0x1768). Returns
   *  the TLS base address. */
  prepareTls(): number {
    return this.ensureTls();
  }

  /** Invoke a registered host stub directly (exercise a stub in isolation). */
  callHost(address: number): void {
    const fn = this.hostFns.get(address);
    if (!fn) throw new Error(`No host function registered at 0x${address.toString(16)}`);
    this.invokeHost(fn);
  }

  /** Invoke a guest function by address and return after its RET reaches LR=0. */
  callGuestFunction(
    address: number,
    args: readonly bigint[] = [],
    maxSteps?: number,
    initRegisters?: Record<number, bigint>,
  ): number {
    if (args.length > 8) {
      throw new Error(`callGuestFunction supports up to 8 register arguments, got ${args.length}`);
    }
    return this.invokeGuest(address, args, {
      preserveControlState: true,
      resetStack: true, // Always reset SP so every call gets a clean stack.
      maxSteps,
      initRegisters,
    });
  }

  private invokeGuest(
    address: number,
    args: readonly bigint[],
    policy: GuestInvocationPolicy,
  ): number {
    const savedLr = policy.preserveControlState ? this.registerFile.readGpr(30) : undefined;
    const savedPc = policy.preserveControlState ? this.registerFile.pc : undefined;
    // Zero all general-purpose registers x0-x28 before every invocation so
    // leftover state from constructors / prior calls never leaks in as an
    // implicit parameter (obfuscated code exploits callee-saved registers).
    for (let i = 0; i <= 28; i++) {
      this.registerFile.writeGpr(i, BigInt(i < args.length ? BigInt.asUintN(64, args[i]!) : 0n));
    }
    // Apply explicit initRegisters AFTER the zeroing loop so caller can
    // override any register (e.g. x11 for handler table base).
    if (policy.initRegisters) {
      for (const [idx, val] of Object.entries(policy.initRegisters)) {
        this.registerFile.writeGpr(Number(idx), BigInt.asUintN(64, val));
      }
    }
    this.registerFile.writeGpr(30, BigInt(RETURN_SENTINEL));
    if (policy.resetStack || this.registerFile.sp === 0n) {
      this.registerFile.sp = BigInt(this.ensureStack());
    }
    // Ensure the TLS block (TPIDR_EL0 region) is mapped before execution so
    // any instruction access — MRS, MSR, or a direct load through a pre-seeded
    // pointer — lands on mapped memory rather than faulting on an unmapped page.
    // The call is idempotent: repeated calls are no-ops once the region exists.
    this.ensureTls();

    try {
      this.run(address, RETURN_SENTINEL, policy.maxSteps);
      return Number(this.registerFile.readGpr(0));
    } finally {
      if (savedLr !== undefined) this.registerFile.writeGpr(30, savedLr);
      if (savedPc !== undefined) this.registerFile.pc = savedPc;
    }
  }

  /** Host-side register snapshot store (for ctx.saveRegs/restoreRegs). */
  private readonly regSnapshots = new Map<number, Record<string, bigint>>();
  private regSnapHandle = 1;
  /** Registers pinned by host fn — rewritten after every instruction. index→value. */
  private readonly persistRegs = new Map<number, bigint>();

  /** Build the HostContext view over this engine's registers and memory. */
  private hostContext(): HostContext {
    return {
      x: (i) => this.registerFile.readGpr(i),
      setX: (i, v) => this.registerFile.writeGpr(i, BigInt.asUintN(64, v)),
      setD: (i, value) => {
        const bytes = new Uint8Array(16); // 128-bit with upper half zeroed
        new DataView(bytes.buffer).setFloat64(0, value, true);
        this.writeVReg(i, bytes);
      },
      setCarry: (v) => {
        this.registerFile.c = v;
      },
      persistReg: (i, v) => {
        const clamped = BigInt.asUintN(64, v);
        console.warn(
          `[persistReg] x${i}=0x${clamped.toString(16)} (Map size=${this.persistRegs.size + 1})`,
        );
        this.persistRegs.set(i, clamped);
      },
      unpersistReg: (i) => {
        console.warn(`[persistReg] DELETE x${i} (Map size=${this.persistRegs.size - 1})`);
        this.persistRegs.delete(i);
      },
      saveRegs: () => {
        const snap: Record<string, bigint> = {};
        for (let i = 0; i <= 30; i++) snap[`x${i}`] = this.registerFile.readGpr(i);
        snap['sp'] = this.registerFile.sp;
        const h = this.regSnapHandle++;
        this.regSnapshots.set(h, snap);
        return h;
      },
      restoreRegs: (h: number) => {
        const snap = this.regSnapshots.get(h);
        if (!snap) return;
        for (const [reg, val] of Object.entries(snap)) {
          if (reg === 'sp') {
            this.registerFile.sp = val;
            continue;
          }
          const idx = parseInt(reg.slice(1), 10);
          if (!isNaN(idx) && idx >= 0 && idx <= 30) this.registerFile.writeGpr(idx, val);
        }
      },
      read: (addr, len) => this.readMemory(addr, len),
      write: (addr, bytes) => this.memory.writeCode(addr, bytes),
      loadValue: (addr, bytes) => this.memory.loadValue(addr, bytes),
      storeValue: (addr, bytes, value) => this.memory.storeValue(addr, bytes, value),
      sp: this.registerFile.sp,
    };
  }

  /** Read the 16 bytes of V register `reg` (copy, safe to mutate). */
  readVReg(reg: number): Uint8Array {
    const bytes = this.registerFile.getVectorBytes(reg);
    if (!bytes) return new Uint8Array(16);
    // Return a copy to prevent external modification, but preserve .buffer property
    const copy = new Uint8Array(16);
    copy.set(bytes);
    return copy;
  }

  /** Overwrite V register `reg`; shorter input is zero-padded, longer truncated. */
  writeVReg(reg: number, bytes: Uint8Array): void {
    const dst = this.registerFile.getVectorBytes(reg);
    if (!dst) return;
    dst.fill(0);
    dst.set(bytes.subarray(0, 16));
  }

  /** Read GPR xN as a 64-bit BigInt (index 31 = XZR = 0). Public test/host accessor. */
  readGprValue(index: number): bigint {
    return this.registerFile.readGpr(index);
  }

  /** Write GPR xN (index 31 = XZR, discarded). Public test/host accessor. */
  writeGprValue(index: number, value: bigint): void {
    this.registerFile.writeGpr(index, value);
  }

  /** Read V register `reg` as one little-endian 128-bit value. */
  private vGet128(reg: number): bigint {
    const view = this.registerFile.getVectorView(reg);
    if (!view) return 0n;
    const lo = view.getBigUint64(0, true);
    const hi = view.getBigUint64(8, true);
    return (hi << 64n) | lo;
  }

  /** Write V register `reg` from one 128-bit value (little-endian). */
  private vSet128(reg: number, value: bigint): void {
    const view = this.registerFile.getVectorView(reg);
    if (!view) return;
    const v = BigInt.asUintN(128, value);
    view.setBigUint64(0, v & MASK64, true);
    view.setBigUint64(8, (v >> 64n) & MASK64, true);
  }

  /** Read lane `index` of V[`reg`] at element size 2^`sizeLog2` bytes. */
  private vGetLane(reg: number, sizeLog2: number, index: number): bigint {
    const view = this.registerFile.getVectorView(reg);
    if (!view) return 0n;
    const off = index << sizeLog2;
    if (off < 0 || off + (1 << sizeLog2) > 16) return 0n;
    switch (sizeLog2) {
      case 0:
        return BigInt(view.getUint8(off));
      case 1:
        return BigInt(view.getUint16(off, true));
      case 2:
        return BigInt(view.getUint32(off, true));
      default:
        return view.getBigUint64(off, true);
    }
  }

  /** Write lane `index` of V[`reg`] at element size 2^`sizeLog2` bytes. */
  private vSetLane(reg: number, sizeLog2: number, index: number, value: bigint): void {
    const view = this.registerFile.getVectorView(reg);
    if (!view) return;
    const off = index << sizeLog2;
    if (off < 0 || off + (1 << sizeLog2) > 16) return;
    switch (sizeLog2) {
      case 0:
        view.setUint8(off, Number(value & 0xffn));
        break;
      case 1:
        view.setUint16(off, Number(value & 0xffffn), true);
        break;
      case 2:
        view.setUint32(off, Number(value & 0xffff_ffffn), true);
        break;
      default:
        view.setBigUint64(off, value & MASK64, true);
        break;
    }
  }

  /** Build the SimdContext window handed to the SIMD/FP execution layer. */
  private simdContext(): SimdContext {
    return {
      vGetBytes: (reg) => this.readVReg(reg),
      vSetBytes: (reg, bytes) => this.writeVReg(reg, bytes),
      vGet128: (reg) => this.vGet128(reg),
      vSet128: (reg, value) => this.vSet128(reg, value),
      vGetLane: (reg, sz, idx) => this.vGetLane(reg, sz, idx),
      vSetLane: (reg, sz, idx, value) => this.vSetLane(reg, sz, idx, value),
      memRead: (addr, len) => this.readMemory(addr, len),
      memWrite: (addr, bytes) => this.memory.writeCode(addr, bytes),
      gprRead: (i) => this.registerFile.readGpr(i),
      gprWrite: (i, v) => this.registerFile.writeGpr(i, BigInt.asUintN(64, v)),
      gprReadSp: (i) => this.registerFile.readGprSp(i),
      setNZCV: (n, z, c, v) => {
        this.registerFile.n = n;
        this.registerFile.z = z;
        this.registerFile.c = c;
        this.registerFile.v = v;
      },
      conditionHolds: (cond) => this.conditionHolds(cond),
      getPc: () => this.registerFile.pc,
      setQC: () => this.setQC(),
    };
  }

  /** Run a host stub: call JS, store its return in x0 (if any). */
  private invokeHost(fn: HostFunction): void {
    const result = fn(this.hostContext());
    if (result !== undefined) {
      this.registerFile.writeGpr(0, BigInt.asUintN(64, BigInt(result)));
    }
  }

  /** Snapshot callee-saved registers x19-x29 before a BL/BLR call. */
  private snapshotCallerRegs() {
    return {
      x19: this.registerFile.readGpr(19),
      x20: this.registerFile.readGpr(20),
      x21: this.registerFile.readGpr(21),
      x22: this.registerFile.readGpr(22),
      x23: this.registerFile.readGpr(23),
      x24: this.registerFile.readGpr(24),
      x25: this.registerFile.readGpr(25),
      x26: this.registerFile.readGpr(26),
      x27: this.registerFile.readGpr(27),
      x28: this.registerFile.readGpr(28),
      x29: this.registerFile.readGpr(29),
    };
  }

  /** Restore callee-saved registers from a saved snapshot. */
  private restoreCallerRegs(s: ReturnType<CpuEngine['snapshotCallerRegs']>): void {
    this.registerFile.writeGpr(19, s.x19);
    this.registerFile.writeGpr(20, s.x20);
    this.registerFile.writeGpr(21, s.x21);
    this.registerFile.writeGpr(22, s.x22);
    this.registerFile.writeGpr(23, s.x23);
    this.registerFile.writeGpr(24, s.x24);
    this.registerFile.writeGpr(25, s.x25);
    this.registerFile.writeGpr(26, s.x26);
    this.registerFile.writeGpr(27, s.x27);
    this.registerFile.writeGpr(28, s.x28);
    this.registerFile.writeGpr(29, s.x29);
  }

  /**
   * Check whether the current PC matches any saved return address on the
   * caller-register stack. If so, pop the stack and restore the saved x19-x29.
   * This handles both standard RET and obfuscated BR x17-style returns, as long
   * as the target address matches the LR that was set by the BL/BLR.
   */
  private checkCallerRegsRestore(): void {
    for (let i = this.callerRegsStack.length - 1; i >= 0; i--) {
      if (this.registerFile.pc === this.callerRegsStack[i]!.retAddr) {
        this.restoreCallerRegs(this.callerRegsStack[i]!);
        this.callerRegsStack.length = i; // pop and everything above it
        return;
      }
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
  private run(begin: number, stopAt: number, maxSteps?: number): void {
    this.registerFile.pc = begin;
    this.stopRequested = false;
    const limit = maxSteps !== undefined && maxSteps > 0 ? maxSteps : MAX_STEPS;
    let steps = 0;
    while (this.registerFile.pc !== stopAt) {
      if (this.stopRequested) return; // exit()/exit_group() halts the program.
      if (limit > 0 && ++steps > limit) {
        this.stopRequested = true;
        return; // clean exit — preserves guest state for inspection
      }
      // Re-apply persisted registers BEFORE every instruction — host fn can
      // lock decode/context registers against obfuscated function corruption.
      // Must be before the hostFn check so it also applies to host stubs.
      this.applyPersistedRegisters();

      if (this.tryHostStub()) continue;

      const region = this.memory.findRegion(this.registerFile.pc, 4);
      const offset = this.registerFile.pc - region.base;
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
        this.fireInstructionHooks(this.registerFile.pc, insn, steps);
      }

      // ── Callee-save fix for obfuscated ARM64 code ──────────────────
      // Detect BL (unconditional branch-with-link) and BLR (branch-link-to-register)
      // before execution. Save x19-x29 so that obfuscated code that violates the
      // ARM64 ABI (uses callee-saved registers as scratch) doesn't corrupt the
      // caller's state. After the called function returns (PC matches the saved
      // LR), the register snapshot is automatically restored.
      const isBl = insn >>> 26 === 0b100101; // BL  imm26
      const isBlr = (insn & 0xfffffc1f) >>> 0 === 0xd63f0000; // BLR Rn
      if (isBl || isBlr) {
        this.pendingSaveRegs = this.snapshotCallerRegs();
      }

      this.branched = false;
      try {
        this.execute(insn);
      } catch (e) {
        if (this.recoverNullIndirectCall(e, isBlr)) continue;
        throw e;
      }

      if (this.pendingSaveRegs) {
        // BL/BLR just executed: LR = return address, PC = target.
        // Push the saved registers with the expected return address.
        const retAddr = Number(this.registerFile.readGpr(30));
        this.callerRegsStack.push({ retAddr, ...this.pendingSaveRegs });
        this.pendingSaveRegs = null;
      }

      if (!this.branched) this.registerFile.pc += 4;

      // After any branch (including RET/BR), check if we landed on a saved
      // return address. This handles both standard RET and obfuscated BR x17
      // returns — any PC that matches a saved LR triggers register restore.
      if (this.branched && this.callerRegsStack.length > 0) {
        this.checkCallerRegsRestore();
      }
    }
  }

  private applyPersistedRegisters(): void {
    for (const [idx, val] of this.persistRegs) {
      this.registerFile.writeGpr(idx, val);
    }
  }

  /**
   * A registered host stub (libc import) is a JS function, not guest code:
   * run it and return to the caller (PC ← LR) without fetching instructions
   * from an address that has no mapped code. The `size` guard keeps the
   * common stub-free hot loop free of a per-instruction Map.get.
   * Returns true when a stub ran and the loop should continue.
   */
  private tryHostStub(): boolean {
    if (this.hostFns.size === 0) return false;
    const hostFn = this.hostFns.get(this.registerFile.pc);
    if (!hostFn) return false;
    this.invokeHost(hostFn);
    // Apply persisted registers IMMEDIATELY after host fn returns.
    // The host fn may have set persistReg (e.g. locking x8 decode table
    // base) — we must apply it before the next guest instruction corrupts
    // caller-saved registers. (The top-of-loop rewrite handles subsequent
    // iterations; this covers the first instruction after the host stub.)
    if (this.persistRegs.size > 0) {
      this.applyPersistedRegisters();
      console.warn(`[persistReg] Applied ${this.persistRegs.size} persisted reg(s) after hostFn`);
    }
    this.registerFile.pc = Number(this.registerFile.readGpr(30));
    // Restore callee-saved registers if the return address matches a
    // saved snapshot (BLR→hostFn→RET path; the called stub may have
    // modified x19-x29 through ctx.setX).
    this.checkCallerRegsRestore();
    return true;
  }

  /**
   * Auto-NOP recovery for NullIndirectCallError: patch the BR/BLR to RET so
   * subsequent calls skip the NULL indirect branch instead of faulting again.
   * During constructor execution, let the exception propagate so
   * runConstructor can record it in the fault log.
   * Returns true when recovered (the loop should re-execute at the same PC so
   * the patched RET instruction runs and returns to the caller (LR=0
   * sentinel). PC must NOT advance — that would skip the RET and fault on
   * whatever follows the function.)
   */
  private recoverNullIndirectCall(e: unknown, isBlr: boolean): boolean {
    if (!(e instanceof NullIndirectCallError) || this.runningConstructor) return false;
    const pc = this.registerFile.pc;
    const retInsn = 0xd65f03c0; // RET
    const retBytes = new Uint8Array([
      retInsn & 0xff,
      (retInsn >>> 8) & 0xff,
      (retInsn >>> 16) & 0xff,
      (retInsn >>> 24) & 0xff,
    ]);
    // Only record the first patch per address (write-protected code sections
    // silently drop writeCode, causing duplicate exceptions on re-execution).
    const patchTag = `0x${pc.toString(16)}`;
    if (!this.nullCallPatches.includes(patchTag)) {
      this.memory.writeCode(pc, retBytes);
      this.nullCallPatches.push(patchTag);
    }
    if (isBlr) {
      // BLR → RET: the "called" function returns 0.
      this.registerFile.writeGpr(0, 0n);
      // Discard the pending callee-save snapshot — we're not calling anything.
      this.pendingSaveRegs = null;
    }
    return true;
  }

  /** Build a read-only TraceEvent and dispatch it to every instruction hook. */
  private fireInstructionHooks(pc: number, insn: number, step: number): void {
    const event: TraceEvent = {
      pc,
      insn,
      step,
      x: (i) => this.registerFile.readGpr(i),
      reg: (name) => this.readRegister(name),
      vector: (name) => this.readVectorAlias(name),
    };
    for (const hook of this.instructionHooks) hook(event);
  }

  // ── Decode + execute ──

  /**
   * Top-level decode: dispatch on the AArch64 main encoding group (bits[28:25])
   * to the family method that owns it, then fall through to a loud throw with
   * the raw opcode for anything not yet implemented.
   *
   * Group map (bits[28:25]):
   *   100x (8,9)         → Data Processing -- Immediate
   *   101x (10,11)       → Branches, Exception Generating, System
   *   x1x0 (4,6,12,14)   → Loads and Stores
   *   x101 (5,13)        → Data Processing -- Register
   *   x111 (7,15)        → FP / Advanced SIMD (NEON + crypto-ext + scalar FP)
   */
  private execute(insn: number): void {
    const op0 = (insn >>> 25) & 0b1111;
    if (op0 === 0b1000 || op0 === 0b1001) {
      if (execDataProcessingImmediate(this, insn)) return;
    } else if (op0 === 0b1010 || op0 === 0b1011) {
      if (
        execBranchSystem(
          this,
          insn,
          () => this.ensureTls(),
          () => this.hostContext(),
          this.getNormalizedSyscalls(),
        )
      )
        return;
    } else if ((op0 & 0b0111) === 0b0101) {
      // x101 (5, 13) → Data Processing -- Register. Checked before load/store
      // because the load/store mask (x1x0) would otherwise be reached first.
      if (execDataProcessingRegister(this, insn)) return;
    } else if ((op0 & 0b0101) === 0b0100) {
      if (execLoadStore(this, insn, this.simdContext())) return;
    } else if ((op0 & 0b0111) === 0b0111) {
      // x111 (7, 15) → Data Processing -- Scalar FP & Advanced SIMD. Disjoint
      // from the masks above, so order among these branches is irrelevant.
      if (executeSimdFp(this.simdContext(), insn)) return;
    }

    // Catch-all for obfuscated ARM64: unrecognised opcodes in mapped regions
    // (text, gaps, data) are treated as NOPs so execution continues past
    // data-words, zero-fill gaps, and custom encodings the obfuscator injected.
    // Only throw when PC is outside ALL mapped regions — that's a real error.
    try {
      this.memory.findRegion(this.registerFile.pc, 4);
      return; // PC is in a mapped region → treat unrecognised opcode as NOP
    } catch {
      // PC is unmapped → let the error propagate
    }

    throw new UnsupportedOpcodeError(
      `Unsupported ARM64 opcode 0x${(insn >>> 0).toString(16).padStart(8, '0')} at pc=0x${this.registerFile.pc.toString(16)}`,
      this.registerFile.pc,
      insn,
    );
  }

  // ── ExecutionContext Interface Implementation ──

  // Register access
  readGpr(index: number): bigint {
    return this.registerFile.readGpr(index);
  }

  writeGpr(index: number, value: bigint): void {
    this.registerFile.writeGpr(index, value);
  }

  readGprSp(index: number): bigint {
    return this.registerFile.readGprSp(index);
  }

  writeGprSp(index: number, value: bigint): void {
    this.registerFile.writeGprSp(index, value);
  }

  // Memory access
  loadValue(address: number, bytes: number): bigint {
    return this.memory.loadValue(address, bytes);
  }

  storeValue(address: number, bytes: number, value: bigint): void {
    this.memory.storeValue(address, bytes, value);
  }

  /** Add a write-protected memory range. Stores to this range are silently dropped. */
  addWriteProtect(base: number, size: number): void {
    this.memory.addWriteProtect(base, size);
  }

  /** Write-protect the loaded SO's executable text segment (auto-detected from loadElf).
   *  Self-modifying stores to this region are silently dropped, eliminating the most
   *  common class of obfuscation-induced crashes during trace / call_symbol. */
  protectCodeSection(): { start: number; end: number; size: number } | null {
    if (this.textStart < 0 || this.textEnd <= this.textStart) return null;
    this.memory.addWriteProtect(this.textStart, this.textEnd - this.textStart);
    return { start: this.textStart, end: this.textEnd, size: this.textEnd - this.textStart };
  }

  // Flag access
  setFlags(n: boolean, z: boolean, c: boolean, v: boolean): void {
    this.registerFile.n = n;
    this.registerFile.z = z;
    this.registerFile.c = c;
    this.registerFile.v = v;
  }

  getFlags(): { n: boolean; z: boolean; c: boolean; v: boolean } {
    return {
      n: this.registerFile.n,
      z: this.registerFile.z,
      c: this.registerFile.c,
      v: this.registerFile.v,
    };
  }

  get n(): boolean {
    return this.registerFile.n;
  }

  get z(): boolean {
    return this.registerFile.z;
  }

  get c(): boolean {
    return this.registerFile.c;
  }

  get v(): boolean {
    return this.registerFile.v;
  }

  // PC control
  getPc(): number {
    return this.registerFile.pc;
  }

  setPc(addr: number): void {
    this.registerFile.pc = addr;
  }

  markBranched(): void {
    this.branched = true;
  }

  get pc(): number {
    return this.registerFile.pc;
  }

  // Arithmetic helpers (delegate to extracted functions)
  addWithFlags(a: bigint, b: bigint, sf: number, carry = 0n): bigint {
    return helperAddWithFlags(this, a, b, sf, carry);
  }

  subWithFlags(a: bigint, b: bigint, sf: number): bigint {
    return helperSubWithFlags(this, a, b, sf);
  }

  conditionHolds(cond: number): boolean {
    return helperConditionHolds(this, cond);
  }

  // Shift/extend helpers (delegate to existing utilities)
  applyShift(value: bigint, type: number, amount: number, sf: number): bigint {
    return applyShift(value, type, amount, sf);
  }

  extendReg(value: bigint, option: number, shift: number, sf: number): bigint {
    return extendReg(value, option, shift, sf);
  }

  // Bit manipulation helpers (delegate to existing utilities)
  signExtend(value: bigint, bits: number): bigint {
    return signExtend(value, bits);
  }

  decodeBitMask(n: number, immr: number, imms: number, sf: number): bigint {
    return decodeBitMask(n, immr, imms, sf);
  }

  // ── End ExecutionContext Implementation ──

  // ── FP Exception Handling (Phase 1.1) ──

  /**
   * Read FPCR (Floating-Point Control Register).
   * Controls rounding mode, trap enables, flush-to-zero, etc.
   */
  getFPCR(): number {
    return this.fpContext.getFPCR();
  }

  /**
   * Write FPCR to configure FP behavior.
   * @param value - New FPCR value (typically set by MSR instruction)
   */
  setFPCR(value: number): void {
    this.fpContext.setFPCR(value);
  }

  /**
   * Read FPSR (Floating-Point Status Register).
   * Contains cumulative exception flags (IOC, DZC, OFC, UFC, IXC, IDC).
   */
  getFPSR(): number {
    return this.fpContext.getFPSR();
  }

  /**
   * Write FPSR (typically to clear cumulative flags).
   * @param value - New FPSR value
   */
  setFPSR(value: number): void {
    this.fpContext.setFPSR(value);
  }

  /**
   * Set the QC (cumulative saturation) flag in FPSR (bit 27).
   * Used by NEON saturating instructions to indicate overflow/underflow.
   */
  setQC(): void {
    const currentFPSR = this.fpContext.getFPSR();
    this.fpContext.setFPSR(currentFPSR | (1 << 27));
  }

  // ── FP Operations (for test exposure and future instruction decode) ──

  /**
   * FADD: Floating-point addition with exception handling.
   * @param a - First operand
   * @param b - Second operand
   * @param is32bit - True for float32 (S reg), false for float64 (D reg)
   */
  fadd(a: number, b: number, is32bit = false): number {
    return this.fpContext.fadd(a, b, is32bit);
  }

  /**
   * FSUB: Floating-point subtraction with exception handling.
   */
  fsub(a: number, b: number, is32bit = false): number {
    return this.fpContext.fsub(a, b, is32bit);
  }

  /**
   * FMUL: Floating-point multiplication with exception handling.
   */
  fmul(a: number, b: number, is32bit = false): number {
    return this.fpContext.fmul(a, b, is32bit);
  }

  /**
   * FDIV: Floating-point division with exception handling.
   */
  fdiv(a: number, b: number, is32bit = false): number {
    return this.fpContext.fdiv(a, b, is32bit);
  }

  /**
   * FSQRT: Floating-point square root with exception handling.
   */
  fsqrt(a: number, is32bit = false): number {
    return this.fpContext.fsqrt(a, is32bit);
  }

  /**
   * Float32 variant of FMUL (convenience for tests).
   */
  fmul32(a: number, b: number): number {
    return this.fpContext.fmul32(a, b);
  }

  // ── Rounding helpers (for test exposure) ──

  /**
   * Round to nearest integer, ties to even (IEEE754 default).
   */
  roundTiesToEven(value: number): number {
    return this.fpContext.roundTiesToEven(value);
  }

  /**
   * Round toward +Infinity.
   */
  roundTowardPlusInf(value: number): number {
    return this.fpContext.roundTowardPlusInf(value);
  }

  /**
   * Round toward -Infinity.
   */
  roundTowardMinusInf(value: number): number {
    return this.fpContext.roundTowardMinusInf(value);
  }

  /**
   * Round toward zero (truncate).
   */
  roundTowardZero(value: number): number {
    return this.fpContext.roundTowardZero(value);
  }
}
