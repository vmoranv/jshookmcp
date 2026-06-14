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
import type { BionicLibrary } from './bionic';
import type { SimdContext } from './simd';
import { executeSimdFp, executeSimdLoadStore } from './simd';

/**
 * A jump/call through a register holding 0 (BR/BLR to address 0). Carried as a
 * distinct class so callers can tell a NULL indirect call apart from any other
 * throw: the `callSymbol` path lets it propagate (the user invoked a function
 * that dereferenced an uninitialised pointer — a real bug), while the
 * constructor path tolerates it (a C++ static-ctor that wanders into a NULL
 * call is an emulator-fidelity limit, not a reason to fail the whole load).
 */
export class NullIndirectCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NullIndirectCallError';
  }
}

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
const MASK64 = (1n << 64n) - 1n;
const MASK32 = (1n << 32n) - 1n;
const GPR_COUNT = 31; // x0..x30; encoding 31 means XZR/SP depending on context.
const MAX_STEPS = 1_000_000; // Runaway guard for the M0 linear executor.
const RETURN_SENTINEL = 0; // LR value that marks "return out of callSymbol".
const STACK_BASE = 0x7fff_0000; // Guest stack region base (grows down from the top).
const STACK_SIZE = 0x10000; // 64 KiB default emulated stack.
/** Base of the lazily-grown region holding one host stub per resolved import. */
const IMPORT_STUB_BASE = 0x6800_0000;
/**
 * Thread-pointer (TPIDR_EL0) region. A modern stack-protector prologue reads the
 * stack canary via `mrs x, TPIDR_EL0` then loads `[x, #0x28]`; pointing TPIDR_EL0
 * at a mapped block (with a fixed non-zero canary) lets those prologues run
 * instead of faulting on an unmapped read.
 */
const TLS_BASE = 0x7000_0000;
const TLS_SIZE = 0x1000;

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

export class CpuEngine {
  private readonly gpr: bigint[] = Array.from({ length: GPR_COUNT }, () => 0n);
  private sp = 0n;
  /** PC and SP are addresses (< 2^53), kept as JS numbers to avoid BigInt churn in the fetch loop. */
  private pc = 0;
  private readonly regions: MappedRegion[] = [];
  private readonly regionsByBase: MappedRegion[] = [];
  private lastRegion: MappedRegion | undefined;
  private regionFastPathSafe = true;
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
  /** Base of the lazily-mapped thread-local (TPIDR_EL0) block (0 = none yet). */
  private tlsBase = 0;
  /** Next free address in the import-stub region (bumped per resolved import). */
  private importStubBump = IMPORT_STUB_BASE;
  /** Stable import-stub address per symbol, shared by relocations and dlsym. */
  private readonly importStubsByName = new Map<string, number>();
  /** Instruction observers (trace/breakpoint). Empty ⇒ hot loop pays nothing. */
  private readonly instructionHooks: InstructionHook[] = [];
  /** NULL indirect calls swallowed while running .init_array constructors. */
  private readonly constructorFaults: string[] = [];
  /** Undefined dynamic imports that could not be resolved to built-in stubs. */
  private readonly unresolvedImportDiagnostics: NativeRuntimeImportDiagnostic[] = [];
  /** Set by exit/exit_group (or a host stub) to halt the run loop at once. */
  private stopRequested = false;
  /**
   * The SIMD/FP V register file: 32 × 128-bit vectors (V0..V31), each the
   * backing store for its Q/D/S/H/B aliases. Held here (not in simd.ts) so a
   * session snapshots cleanly; a DataView per register gives multi-width lane
   * access without re-wrapping. AArch64 is little-endian, so byte 0 is least
   * significant.
   */
  private readonly vreg: Uint8Array[] = Array.from({ length: 32 }, () => new Uint8Array(16));
  private readonly vview: DataView[] = this.vreg.map((b) => new DataView(b.buffer));

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

  /** Map a zero-filled region of guest memory. */
  mapMemory(address: number, size: number): void {
    this.addRegion({ base: address, size, data: new Uint8Array(size) });
  }

  /** Write bytes (machine code or data) into a mapped region. */
  writeCode(address: number, bytes: Uint8Array): void {
    const region = this.findRegion(address, bytes.length);
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
    bionic?: BionicLibrary,
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
    for (const seg of elf.loadableSegments()) {
      this.addRegion({ base: bias + seg.vaddr, size: seg.data.length, data: seg.data });
    }
    const exported = elf.exportedSymbols();
    if (mergeSymbols) {
      for (const [name, vaddr] of exported) this.symbols.set(name, bias + vaddr);
    }
    this.applyRelocations(elf, bionic, bias, exported);
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
    bionic?: BionicLibrary,
  ): {
    entry: number;
    unresolvedImports: readonly NativeRuntimeImportDiagnostic[];
    constructorFaults: readonly string[];
  } {
    const BIAS_START = 0x10000000;
    const BIAS_STEP = 0x4000000; // 64 MB per library (generous for real .so)
    // Load each dependency at its own bias, merging exports into the global table.
    for (let i = 0; i < dependencies.length; i++) {
      const depBias = BIAS_START + i * BIAS_STEP;
      this.loadElf(dependencies[i], bionic, depBias, true);
    }
    // Load the primary at bias 0 (traditional single-library behaviour): it
    // inherits the merged dependency exports and runs its own constructors.
    this.constructorFaults.length = 0;
    this.unresolvedImportDiagnostics.length = 0;
    const { entry } = this.loadElf(primary, bionic, 0, true);
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
      const fn = Number(this.loadValue(bias + slot, 8)); // slot holds the (relocated) ptr.
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
    this.gpr[0] = 0n;
    this.gpr[1] = 0n;
    this.gpr[2] = 0n;
    this.gpr[30] = BigInt(RETURN_SENTINEL); // LR → halt marker
    this.sp = BigInt(this.ensureStack());
    try {
      this.run(addr, RETURN_SENTINEL);
    } catch (e) {
      if (e instanceof NullIndirectCallError) {
        this.constructorFaults.push(`ctor@0x${addr.toString(16)}: ${e.message}`);
        return;
      }
      throw e;
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
    bionic?: BionicLibrary,
    bias = 0,
    exported?: Map<string, number>,
  ): void {
    const ownExports = exported ?? elf.exportedSymbols();
    for (const rel of elf.relocations()) {
      const patchedOffset = bias + rel.offset;
      switch (rel.type) {
        case R_AARCH64_RELATIVE:
          // *(bias+offset) = bias + addend.
          this.storeValue(patchedOffset, 8, BigInt(bias + rel.addend));
          break;
        case R_AARCH64_ABS64:
        case R_AARCH64_GLOB_DAT:
        case R_AARCH64_JUMP_SLOT: {
          if (this.isUnresolvedImport(rel.symbolName, rel.symbolValue, bionic)) {
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
              : this.resolveRelocSymbol(rel.symbolName, rel.symbolValue, bionic);
          this.storeValue(patchedOffset, 8, BigInt(resolved + rel.addend));
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
            const sourceData = this.readMemory(rel.symbolValue, copySize);
            this.writeMemory(patchedOffset, sourceData);
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
  private resolveRelocSymbol(name: string, symbolValue: number, bionic?: BionicLibrary): number {
    if (name && this.symbols.has(name)) return this.symbols.get(name)!;
    if (name && bionic?.has(name)) {
      return this.bindImportStub(name, bionic.get(name)!);
    }
    return symbolValue;
  }

  private isUnresolvedImport(name: string, symbolValue: number, bionic?: BionicLibrary): boolean {
    return name !== '' && symbolValue === 0 && !this.symbols.has(name) && !bionic?.has(name);
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
    try {
      this.run(addr, RETURN_SENTINEL);
    } catch (e) {
      if (e instanceof NullIndirectCallError && this.unresolvedImportDiagnostics.length > 0) {
        throw new NullIndirectCallError(
          `${e.message}; unresolved imports: ${formatUnresolvedImports(this.unresolvedImportDiagnostics)}`,
        );
      }
      throw e;
    }
    return Number(this.gpr[0]);
  }

  /** List the exported dynamic symbol names callSymbol can resolve (from loadElf). */
  exportedSymbolNames(): string[] {
    return [...this.symbols.keys()];
  }

  /** Resolve an exported dynamic symbol without invoking it. */
  lookupSymbol(name: string): number | undefined {
    return this.symbols.get(name);
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
  writeRegister(name: string, value: number): void {
    this.writeNamed(name, BigInt(value) & MASK64);
  }

  /** Read the current 64-bit value of a named register as a JS number. */
  readRegister(name: string): number {
    return Number(this.readNamed(name));
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
    const bytes = this.vreg[reg] ?? new Uint8Array(16);
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

  /**
   * Lazily map the TPIDR_EL0 thread-pointer block and return its base. A fixed
   * non-zero stack canary is planted at the conventional offset (+0x28) so a
   * stack-protector prologue that reads `[tls, #0x28]` sees a stable guard.
   */
  private ensureTls(): number {
    if (this.tlsBase === 0) {
      this.mapMemory(TLS_BASE, TLS_SIZE);
      this.tlsBase = TLS_BASE;
      // Plant a fixed 64-bit canary at the AArch64 stack-guard slot (tls+0x28).
      const canary = new Uint8Array([0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]);
      this.writeCode(TLS_BASE + 0x28, canary);
    }
    return this.tlsBase;
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

  /** Read the 16 bytes of V register `reg` (copy, safe to mutate). */
  readVReg(reg: number): Uint8Array {
    return Uint8Array.from(this.vreg[reg] ?? new Uint8Array(16));
  }

  /** Overwrite V register `reg`; shorter input is zero-padded, longer truncated. */
  writeVReg(reg: number, bytes: Uint8Array): void {
    const dst = this.vreg[reg];
    if (!dst) return;
    dst.fill(0);
    dst.set(bytes.subarray(0, 16));
  }

  /** Read GPR xN as a 64-bit BigInt (index 31 = XZR = 0). Public test/host accessor. */
  readGprValue(index: number): bigint {
    return this.readGpr(index);
  }

  /** Write GPR xN (index 31 = XZR, discarded). Public test/host accessor. */
  writeGprValue(index: number, value: bigint): void {
    this.writeGpr(index, value);
  }

  /** Read V register `reg` as one little-endian 128-bit value. */
  private vGet128(reg: number): bigint {
    const view = this.vview[reg];
    if (!view) return 0n;
    const lo = view.getBigUint64(0, true);
    const hi = view.getBigUint64(8, true);
    return (hi << 64n) | lo;
  }

  /** Write V register `reg` from one 128-bit value (little-endian). */
  private vSet128(reg: number, value: bigint): void {
    const view = this.vview[reg];
    if (!view) return;
    const v = BigInt.asUintN(128, value);
    view.setBigUint64(0, v & MASK64, true);
    view.setBigUint64(8, (v >> 64n) & MASK64, true);
  }

  /** Read lane `index` of V[`reg`] at element size 2^`sizeLog2` bytes. */
  private vGetLane(reg: number, sizeLog2: number, index: number): bigint {
    const view = this.vview[reg];
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
    const view = this.vview[reg];
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
      memWrite: (addr, bytes) => this.writeCode(addr, bytes),
      gprRead: (i) => this.readGpr(i),
      gprWrite: (i, v) => this.writeGpr(i, BigInt.asUintN(64, v)),
      gprReadSp: (i) => this.readGprSp(i),
      setNZCV: (n, z, c, v) => {
        this.flagN = n;
        this.flagZ = z;
        this.flagC = c;
        this.flagV = v;
      },
      conditionHolds: (cond) => this.conditionHolds(cond),
      getPc: () => this.pc,
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
    this.stopRequested = false;
    let steps = 0;
    while (this.pc !== stopAt) {
      if (this.stopRequested) return; // exit()/exit_group() halts the program.
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
      if (this.execDataProcessingImmediate(insn)) return;
    } else if (op0 === 0b1010 || op0 === 0b1011) {
      if (this.execBranchSystem(insn)) return;
    } else if ((op0 & 0b0111) === 0b0101) {
      // x101 (5, 13) → Data Processing -- Register. Checked before load/store
      // because the load/store mask (x1x0) would otherwise be reached first.
      if (this.execDataProcessingRegister(insn)) return;
    } else if ((op0 & 0b0101) === 0b0100) {
      if (this.execLoadStore(insn)) return;
    } else if ((op0 & 0b0111) === 0b0111) {
      // x111 (7, 15) → Data Processing -- Scalar FP & Advanced SIMD. Disjoint
      // from the masks above, so order among these branches is irrelevant.
      if (executeSimdFp(this.simdContext(), insn)) return;
    }

    throw new Error(
      `Unsupported ARM64 opcode 0x${(insn >>> 0).toString(16).padStart(8, '0')} at pc=0x${this.pc.toString(16)}`,
    );
  }

  /**
   * Data Processing -- Immediate (bits[28:25] = 100x): ADD/SUB/SUBS immediate
   * and MOVZ. Returns true when handled, false to fall through to the throw.
   */
  private execDataProcessingImmediate(insn: number): boolean {
    const op2829 = (insn >>> 29) & 0b11;

    // ADR / ADRP: op | immlo(2) | 10000 | immhi(19) | Rd
    //   ADR (op=0): Rd = PC + SignExtend(immhi:immlo). ADRP (op=1): Rd = (PC &
    //   ~0xfff) + SignExtend(immhi:immlo) << 12. The workhorse of PIC addressing.
    if (((insn >>> 24) & 0b11111) === 0b10000) {
      const op = insn >>> 31;
      const immlo = (insn >>> 29) & 0b11;
      const immhi = (insn >>> 5) & 0x7ffff;
      const rd = insn & 0b11111;
      const imm = this.signExtend(BigInt((immhi << 2) | immlo), 21);
      const value = op === 1 ? BigInt(this.pc & ~0xfff) + (imm << 12n) : BigInt(this.pc) + imm;
      this.writeGpr(rd, BigInt.asUintN(64, value));
      return true;
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
      return true;
    }

    // ADDS (immediate): sf | 0 | 1 | 100010 | sh | imm12 | Rn | Rd  (S=1 sets flags)
    //   CMN is ADDS with Rd=XZR. Rn uses SP semantics.
    if (op2829 === 0b01 && ((insn >>> 23) & 0b111111) === 0b100010) {
      const sf = insn >>> 31;
      const sh = (insn >>> 22) & 1;
      let imm12 = (insn >>> 10) & 0xfff;
      if (sh === 1) imm12 <<= 12;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const result = this.addWithFlags(this.readGprSp(rn), BigInt(imm12), sf);
      this.writeGpr(rd, result);
      return true;
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
      return true;
    }

    // MOVN (move wide immediate, inverted): sf | 00 | 100101 | hw | imm16 | Rd
    if (op2829 === 0b00 && ((insn >>> 23) & 0b111111) === 0b100101) {
      const sf = insn >>> 31;
      const hw = (insn >>> 21) & 0b11;
      const imm16 = (insn >>> 5) & 0xffff;
      const rd = insn & 0b11111;
      const value = ~(BigInt(imm16) << BigInt(hw * 16));
      this.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value));
      return true;
    }

    // MOVZ (move wide immediate): sf | 10 | 100101 | hw | imm16 | Rd
    if (op2829 === 0b10 && ((insn >>> 23) & 0b111111) === 0b100101) {
      const sf = insn >>> 31;
      const hw = (insn >>> 21) & 0b11;
      const imm16 = (insn >>> 5) & 0xffff;
      const rd = insn & 0b11111;
      const value = BigInt(imm16) << BigInt(hw * 16);
      this.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value));
      return true;
    }

    // MOVK (move wide immediate, keep): sf | 11 | 100101 | hw | imm16 | Rd
    //   Insert imm16 into the hw-th 16-bit lane, preserving the other bits.
    if (op2829 === 0b11 && ((insn >>> 23) & 0b111111) === 0b100101) {
      const sf = insn >>> 31;
      const hw = (insn >>> 21) & 0b11;
      const imm16 = (insn >>> 5) & 0xffff;
      const rd = insn & 0b11111;
      const shift = BigInt(hw * 16);
      const current = this.readGpr(rd);
      const cleared = current & ~(0xffffn << shift);
      const value = cleared | (BigInt(imm16) << shift);
      this.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value));
      return true;
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
      return true;
    }

    // Logical (immediate): sf | opc(2) | 100100 | N | immr(6) | imms(6) | Rn | Rd
    //   opc: 00 AND, 01 ORR, 10 EOR, 11 ANDS. AND/ORR/EOR write Rd with SP
    //   semantics (enc 31 = SP); ANDS uses XZR and sets NZCV (C=V=0).
    if (((insn >>> 23) & 0b111111) === 0b100100) {
      const sf = insn >>> 31;
      const opc = (insn >>> 29) & 0b11;
      const nBit = (insn >>> 22) & 1;
      const immr = (insn >>> 16) & 0x3f;
      const imms = (insn >>> 10) & 0x3f;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      if (sf === 0 && nBit === 1) return false; // reserved for 32-bit
      const imm = this.decodeBitMask(nBit, immr, imms, sf);
      const a = this.readGpr(rn);
      let value: bigint;
      switch (opc) {
        case 0b00:
        case 0b11:
          value = a & imm;
          break;
        case 0b01:
          value = a | imm;
          break;
        default:
          value = a ^ imm;
          break;
      }
      value = sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value);
      if (opc === 0b11) {
        // ANDS / TST: set NZ from the result, clear C and V.
        const width = sf === 1 ? 64n : 32n;
        this.flagN = value >> (width - 1n) === 1n;
        this.flagZ = value === 0n;
        this.flagC = false;
        this.flagV = false;
        this.writeGpr(rd, value);
      } else {
        this.writeGprSp(rd, value);
      }
      return true;
    }

    // Bitfield: sf | opc(2) | 100110 | N | immr(6) | imms(6) | Rn | Rd
    //   opc: 00 SBFM, 01 BFM, 10 UBFM. Covers LSL/LSR/ASR imm, [SU]XT[BHW],
    //   [SU]BFX, BFI/BFXIL via the standard immr/imms field algorithm.
    if (((insn >>> 23) & 0b111111) === 0b100110) {
      const sf = insn >>> 31;
      const opc = (insn >>> 29) & 0b11;
      if (opc === 0b11) return false; // reserved
      const immr = (insn >>> 16) & 0x3f;
      const imms = (insn >>> 10) & 0x3f;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const width = sf === 1 ? 64 : 32;
      const src = this.readGpr(rn) & (sf === 1 ? MASK64 : MASK32);
      const r = immr % width;
      const sBits = imms;
      // UBFM field extraction (ARMv8 ARM C4.1.6). The canonical rotate-then-mask
      // only holds when imms >= immr; otherwise the field wraps and the result is
      // the low (imms+1) bits of ROR(src, r). The previous single rotate+full-mask
      // form mishandled the common LSR alias (imms == width-1): it kept the
      // high bits reintroduced by the `src << (width-r)` half of the rotate,
      // so LSR #36 of 0x73 returned 0x730000000 instead of 0 — corrupting every
      // downstream address derived from such a shift.
      const wB = BigInt(width);
      let bottom: bigint;
      let fieldLen: number;
      if (sBits >= r) {
        // Non-wrapping: take (sBits-r+1) bits of (src >> r).
        fieldLen = sBits - r + 1;
        bottom = (src >> BigInt(r)) & ((1n << BigInt(fieldLen)) - 1n);
      } else {
        // Wrapping: ROR(src, r), take low (sBits+1) bits.
        const rotated =
          ((src >> BigInt(r)) | (src << (wB - BigInt(r)))) & (sf === 1 ? MASK64 : MASK32);
        fieldLen = sBits + 1;
        bottom = rotated & ((1n << BigInt(fieldLen)) - 1n);
      }
      const fieldMask = (1n << BigInt(fieldLen)) - 1n;
      let result: bigint;
      if (opc === 0b01) {
        // BFM: merge bottom into the existing Rd, preserving bits outside the field.
        const dstOld = this.readGpr(rd) & (sf === 1 ? MASK64 : MASK32);
        result = (dstOld & ~fieldMask) | bottom;
      } else if (opc === 0b10) {
        // UBFM: zero-extend the extracted field.
        result = bottom;
      } else {
        // SBFM: sign-extend from bit (fieldLen-1) of the extracted field.
        result = this.signExtend(bottom, fieldLen);
        result = BigInt.asUintN(64, result);
      }
      this.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, result) : BigInt.asUintN(32, result));
      return true;
    }

    // EXTR: sf | 00 | 100111 | N | 0 | Rm | imms(6) | Rn | Rd  (ROR alias when Rn==Rm)
    if (((insn >>> 23) & 0b111111) === 0b100111) {
      const sf = insn >>> 31;
      const rm = (insn >>> 16) & 0b11111;
      const imms = (insn >>> 10) & 0x3f;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const width = sf === 1 ? 64 : 32;
      const hi = this.readGpr(rn) & (sf === 1 ? MASK64 : MASK32);
      const lo = this.readGpr(rm) & (sf === 1 ? MASK64 : MASK32);
      const concat = (hi << BigInt(width)) | lo;
      const result = (concat >> BigInt(imms)) & (sf === 1 ? MASK64 : MASK32);
      this.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, result) : BigInt.asUintN(32, result));
      return true;
    }

    return false;
  }

  /**
   * Guard an indirect branch/call target (BR/BLR). callSymbol/runInitializers
   * seed LR with the sentinel 0 so a genuine RET halts the run loop. A target of
   * 0 here is therefore NOT a return — it is a jump/call through an
   * uninitialised function pointer (a real-hardware SIGSEGV). Without this
   * guard, PC=0 silently trips the loop's stop condition and the failure
   * masquerades as a clean return — the exact effect that hid the STUR
   * write-loss bug behind a fake "ran-to-return".
   */
  private assertIndirectTarget(target: number, kind: 'BR' | 'BLR'): void {
    if (target === 0) {
      throw new NullIndirectCallError(
        `NULL indirect call: ${kind} to address 0 at pc=0x${this.pc.toString(16)} ` +
          `(likely an uninitialised function pointer)`,
      );
    }
  }

  /**
   * Branches, Exception Generating and System (bits[28:25] = 101x): B, BL, RET,
   * BR, BLR, CBZ/CBNZ, B.cond, SVC. Returns true when handled.
   */
  private execBranchSystem(insn: number): boolean {
    // B (unconditional branch): 000101 | imm26   → PC += SignExtend(imm26 << 2)
    if (insn >>> 26 === 0b000101) {
      this.pc += this.branchOffset(insn);
      this.branched = true;
      return true;
    }

    // BL (branch with link): 100101 | imm26   → LR = PC+4; PC += offset
    if (insn >>> 26 === 0b100101) {
      this.gpr[30] = BigInt(this.pc + 4);
      this.pc += this.branchOffset(insn);
      this.branched = true;
      return true;
    }

    // RET: 1101011 0 0 10 11111 000000 Rn 00000   → PC = X[Rn] (default LR)
    if ((insn & 0xfffffc1f) >>> 0 === 0xd65f0000) {
      const rn = (insn >>> 5) & 0b11111;
      this.pc = Number(this.readGpr(rn));
      this.branched = true;
      return true;
    }

    // BR Rn: 1101011 0 0 00 11111 000000 Rn 00000  → PC = X[Rn] (indirect branch)
    if ((insn & 0xfffffc1f) >>> 0 === 0xd61f0000) {
      const rn = (insn >>> 5) & 0b11111;
      const target = Number(this.readGpr(rn));
      this.assertIndirectTarget(target, 'BR');
      this.pc = target;
      this.branched = true;
      return true;
    }

    // BLR Rn: 1101011 0 0 01 11111 000000 Rn 00000  → LR = PC+4; PC = X[Rn]
    if ((insn & 0xfffffc1f) >>> 0 === 0xd63f0000) {
      const rn = (insn >>> 5) & 0b11111;
      const target = Number(this.readGpr(rn));
      this.assertIndirectTarget(target, 'BLR');
      this.gpr[30] = BigInt(this.pc + 4);
      this.pc = target;
      this.branched = true;
      return true;
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
      return true;
    }

    // B.cond: 0101010 0 | imm19 | 0 | cond
    if (insn >>> 24 === 0b01010100 && ((insn >>> 4) & 1) === 0) {
      const cond = insn & 0b1111;
      if (this.conditionHolds(cond)) {
        this.pc += this.imm19Offset(insn);
        this.branched = true;
      }
      return true;
    }

    // TBZ/TBNZ: b5 | 011011 | op | b40(5) | imm14 | Rt   (op: 0=TBZ 1=TBNZ)
    //   Tests bit (b5:b40) of Rt; branches by SignExtend(imm14 << 2) when the
    //   condition holds. b5 is the high bit of the 6-bit position (so 0..63).
    if (((insn >>> 25) & 0b111111) === 0b011011) {
      const op = (insn >>> 24) & 1;
      const b5 = insn >>> 31;
      const b40 = (insn >>> 19) & 0b11111;
      const bitPos = (b5 << 5) | b40;
      const rt = insn & 0b11111;
      const imm14 = (insn >>> 5) & 0x3fff;
      const offset = Number(this.signExtend(BigInt(imm14), 14)) * 4;
      const bitSet = ((this.readGpr(rt) >> BigInt(bitPos)) & 1n) === 1n;
      if (op === 0 ? !bitSet : bitSet) {
        this.pc += offset;
        this.branched = true;
      }
      return true;
    }

    // HINT space (NOP, PACIASP/AUTIASP, BTI, YIELD, …): 1101010100 0 00 011 0010 …
    //   Treat the whole hint space as a no-op so compiler-emitted prologue/landing
    //   pads (PAC/BTI) don't fault. NOP itself is 0xD503201F.
    if ((insn & 0xfffff01f) >>> 0 === 0xd503201f) {
      return true;
    }

    // Barrier space (DMB/DSB/ISB): 1101010100 0 00 011 0011 CRm op2 11111, where
    //   op2 selects DSB(4)/DMB(5)/ISB(6) and CRm the shareability domain. This
    //   interpreter executes a single guest thread in program order, so memory
    //   barriers have no observable effect — model them as no-ops (the alternative
    //   is an honest fault that would stop real libc/SQLite code that fences
    //   around lock-free sequences). The CRn=0011 group bit distinguishes these
    //   from the HINT space (CRn=0010) above.
    if ((insn & 0xfffff01f) >>> 0 === 0xd503301f) {
      return true;
    }

    // MRS Xt, <sysreg>: 1101 0101 0011 1 o0 op1 CRn CRm op2 Rt (read; the 0xd53
    //   prefix is the read direction). Modelled minimally: TPIDR_EL0
    //   (S3_3_C13_C0_2) returns the thread-pointer block base (lazily mapped,
    //   carrying a fixed stack canary at +0x28); every other system register
    //   reads as 0. This lets stack-protector and TLS prologues run instead of
    //   faulting, without modelling the full processor-element state.
    if (insn >>> 20 === 0xd53) {
      const rt = insn & 0b11111;
      const op1 = (insn >>> 16) & 0b111;
      const crn = (insn >>> 12) & 0b1111;
      const crm = (insn >>> 8) & 0b1111;
      const op2 = (insn >>> 5) & 0b111;
      const isTpidrEl0 = op1 === 3 && crn === 13 && crm === 0 && op2 === 2;
      this.gpr[rt] = isTpidrEl0 ? BigInt(this.ensureTls()) : 0n;
      return true;
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
      return true;
    }

    return false;
  }

  /**
   * Data Processing -- Register (bits[28:25] = x101): ADD/SUB/SUBS shifted
   * register, ORR, EOR. Returns true when handled.
   */
  private execDataProcessingRegister(insn: number): boolean {
    const op2829 = (insn >>> 29) & 0b11;

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
      return true;
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
      return true;
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
      return true;
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
      return true;
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
      return true;
    }

    // ADDS (shifted register): sf | 0 | 1 | 01011 | shift | 0 | Rm | imm6 | Rn | Rd
    if (op2829 === 0b01 && ((insn >>> 24) & 0b11111) === 0b01011 && ((insn >>> 21) & 1) === 0) {
      const sf = insn >>> 31;
      const shiftType = (insn >>> 22) & 0b11;
      const rm = (insn >>> 16) & 0b11111;
      const imm6 = (insn >>> 10) & 0b111111;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const operand2 = this.applyShift(this.readGpr(rm), shiftType, imm6, sf);
      const result = this.addWithFlags(this.readGpr(rn), operand2, sf);
      this.writeGpr(rd, result);
      return true;
    }

    // Logical (shifted register), N-bit selects the complement variants:
    //   opc 00 + N0 = AND, N1 = BIC; opc 01 + N0 = ORR (handled above), N1 = ORN;
    //   opc 10 + N0 = EOR (handled above), N1 = EON; opc 11 + N0 = ANDS, N1 = BICS.
    //   sf | opc(2) | 01010 | shift(2) | N | Rm | imm6 | Rn | Rd
    if (((insn >>> 24) & 0b11111) === 0b01010) {
      const sf = insn >>> 31;
      const opc = (insn >>> 29) & 0b11;
      const nBit = (insn >>> 21) & 1;
      // ORR/EOR with N=0 are already handled above; only take the remaining forms.
      const alreadyHandled = nBit === 0 && (opc === 0b01 || opc === 0b10);
      if (!alreadyHandled) {
        const shiftType = (insn >>> 22) & 0b11;
        const rm = (insn >>> 16) & 0b11111;
        const imm6 = (insn >>> 10) & 0b111111;
        const rn = (insn >>> 5) & 0b11111;
        const rd = insn & 0b11111;
        let operand2 = this.applyShift(this.readGpr(rm), shiftType, imm6, sf);
        if (nBit === 1) operand2 = ~operand2; // BIC/ORN/EON/BICS invert operand2
        const a = this.readGpr(rn);
        let value: bigint;
        if (opc === 0b00 || opc === 0b11)
          value = a & operand2; // AND/BIC/ANDS/BICS
        else if (opc === 0b01)
          value = a | operand2; // ORN
        else value = a ^ operand2; // EON
        value = sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value);
        if (opc === 0b11) {
          const width = sf === 1 ? 64n : 32n;
          this.flagN = value >> (width - 1n) === 1n;
          this.flagZ = value === 0n;
          this.flagC = false;
          this.flagV = false;
        }
        this.writeGpr(rd, value);
        return true;
      }
    }

    // Add/subtract (extended register): sf | op | S | 01011 | 00 | 1 | Rm |
    //   option(3) | imm3 | Rn | Rd. Used for SP-relative arithmetic with a
    //   zero/sign-extended Rm (e.g. add x0, sp, w1, uxtw #2). Rn uses SP semantics.
    if (((insn >>> 24) & 0b11111) === 0b01011 && ((insn >>> 21) & 0b111) === 0b001) {
      const sf = insn >>> 31;
      const op = (insn >>> 30) & 1; // 0 add, 1 sub
      const s = (insn >>> 29) & 1; // set flags
      const rm = (insn >>> 16) & 0b11111;
      const option = (insn >>> 13) & 0b111;
      const imm3 = (insn >>> 10) & 0b111;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const operand2 = this.extendReg(this.readGpr(rm), option, imm3, sf);
      if (s === 1) {
        const result =
          op === 0
            ? this.addWithFlags(this.readGprSp(rn), operand2, sf)
            : this.subWithFlags(this.readGprSp(rn), operand2, sf);
        this.writeGpr(rd, result);
      } else {
        const base = this.readGprSp(rn);
        const value = op === 0 ? base + operand2 : base - operand2;
        this.writeGprSp(rd, sf === 1 ? BigInt.asUintN(64, value) : BigInt.asUintN(32, value));
      }
      return true;
    }

    // Add/subtract (with carry): sf | op | S | 11010000 | Rm | 000000 | Rn | Rd
    //   ADC/ADCS (op=0) and SBC/SBCS (op=1). Carry-in from flagC.
    if (((insn >>> 21) & 0xff) === 0b11010000) {
      const sf = insn >>> 31;
      const op = (insn >>> 30) & 1;
      const s = (insn >>> 29) & 1;
      const rm = (insn >>> 16) & 0b11111;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const carry = this.flagC ? 1n : 0n;
      if (op === 0) {
        // ADC: Rn + Rm + C
        const result =
          s === 1
            ? this.addWithFlags(this.readGpr(rn), this.readGpr(rm), sf, carry)
            : this.readGpr(rn) + this.readGpr(rm) + carry;
        this.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, result) : BigInt.asUintN(32, result));
      } else {
        // SBC: Rn - Rm - (1 - C) = Rn + ~Rm + C
        const notRm = ~this.readGpr(rm);
        const result =
          s === 1
            ? this.addWithFlags(this.readGpr(rn), notRm, sf, carry)
            : this.readGpr(rn) + notRm + carry;
        this.writeGpr(rd, sf === 1 ? BigInt.asUintN(64, result) : BigInt.asUintN(32, result));
      }
      return true;
    }

    // Data-processing (3 source): sf | 00 | 11011 | op31(3) | Rm | o0 | Ra | Rn | Rd
    //   MADD/MSUB (Rd = Ra ± Rn*Rm), SMULH/UMULH (high 64 bits of 64×64).
    if (((insn >>> 24) & 0b11111) === 0b11011) {
      const sf = insn >>> 31;
      const op31 = (insn >>> 21) & 0b111;
      const o0 = (insn >>> 15) & 1;
      const rm = (insn >>> 16) & 0b11111;
      const ra = (insn >>> 10) & 0b11111;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      if (op31 === 0b000) {
        // MADD (o0=0) / MSUB (o0=1).
        // 32-bit form (sf=0) operates on W-regs: operands are truncated to
        // their low 32 bits BEFORE the multiply. Folding in dirty high bits of
        // Rn/Rm (common when a value was narrowed earlier but the full X reg
        // still holds garbage above bit 31) produced a wrong product whose
        // low-32 leaked into an indexed load address — crashing real .so code.
        if (sf === 0) {
          const wn = this.readGpr(rn) & MASK32;
          const wm = this.readGpr(rm) & MASK32;
          const wa = this.readGpr(ra) & MASK32;
          const product = wn * wm;
          const value = o0 === 0 ? wa + product : wa - product;
          this.writeGpr(rd, BigInt.asUintN(32, value));
        } else {
          const product = this.readGpr(rn) * this.readGpr(rm);
          const acc = this.readGpr(ra);
          const value = o0 === 0 ? acc + product : acc - product;
          this.writeGpr(rd, BigInt.asUintN(64, value));
        }
        return true;
      }
      if (op31 === 0b010 && o0 === 0) {
        // SMULH: signed high 64 bits of the 128-bit product.
        const a = BigInt.asIntN(64, this.readGpr(rn));
        const b = BigInt.asIntN(64, this.readGpr(rm));
        this.writeGpr(rd, BigInt.asUintN(64, (a * b) >> 64n));
        return true;
      }
      if (op31 === 0b110 && o0 === 0) {
        // UMULH: unsigned high 64 bits of the 128-bit product.
        const a = this.readGpr(rn) & MASK64;
        const b = this.readGpr(rm) & MASK64;
        this.writeGpr(rd, ((a * b) >> 64n) & MASK64);
        return true;
      }
      if (op31 === 0b001) {
        // SMADDL/SMSUBL: Xd = Xa ± (SignExtend(Wn) * SignExtend(Wm)).
        const a = BigInt.asIntN(32, this.readGpr(rn) & MASK32);
        const b = BigInt.asIntN(32, this.readGpr(rm) & MASK32);
        const acc = BigInt.asIntN(64, this.readGpr(ra));
        const value = o0 === 0 ? acc + a * b : acc - a * b;
        this.writeGpr(rd, BigInt.asUintN(64, value));
        return true;
      }
      if (op31 === 0b101) {
        // UMADDL/UMSUBL: Xd = Xa ± (ZeroExtend(Wn) * ZeroExtend(Wm)).
        const a = this.readGpr(rn) & MASK32;
        const b = this.readGpr(rm) & MASK32;
        const acc = this.readGpr(ra) & MASK64;
        const value = o0 === 0 ? acc + a * b : acc - a * b;
        this.writeGpr(rd, BigInt.asUintN(64, value));
        return true;
      }
    }

    // Data-processing (2 source): sf | 0 | S | 11010110 | Rm | opcode(6) | Rn | Rd
    //   UDIV/SDIV and the variable shifts LSLV/LSRV/ASRV/RORV. bit30=0 here
    //   (bit30=1 is the 1-source class below, same 11010110 discriminant).
    if (((insn >>> 21) & 0xff) === 0b11010110 && ((insn >>> 30) & 1) === 0) {
      const sf = insn >>> 31;
      const opcode = (insn >>> 10) & 0b111111;
      const rm = (insn >>> 16) & 0b11111;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const width = sf === 1 ? 64 : 32;
      const wMask = sf === 1 ? MASK64 : MASK32;
      const dividend = this.readGpr(rn) & wMask;
      const divisor = this.readGpr(rm) & wMask;
      switch (opcode) {
        case 0b000010: {
          // UDIV — division by zero yields 0 (AArch64 semantics).
          const q = divisor === 0n ? 0n : dividend / divisor;
          this.writeGpr(rd, q & wMask);
          return true;
        }
        case 0b000011: {
          // SDIV — signed; division by zero yields 0.
          const a = BigInt.asIntN(width, dividend);
          const b = BigInt.asIntN(width, divisor);
          const q = b === 0n ? 0n : a / b; // BigInt division truncates toward zero
          this.writeGpr(rd, BigInt.asUintN(width, q));
          return true;
        }
        case 0b001000: // LSLV
          this.writeGpr(rd, this.applyShift(dividend, 0b00, Number(divisor % BigInt(width)), sf));
          return true;
        case 0b001001: // LSRV
          this.writeGpr(rd, this.applyShift(dividend, 0b01, Number(divisor % BigInt(width)), sf));
          return true;
        case 0b001010: // ASRV
          this.writeGpr(rd, this.applyShift(dividend, 0b10, Number(divisor % BigInt(width)), sf));
          return true;
        case 0b001011: // RORV
          this.writeGpr(rd, this.applyShift(dividend, 0b11, Number(divisor % BigInt(width)), sf));
          return true;
        default:
          break;
      }
    }

    // Conditional select: sf | op | S | 11010100 | Rm | cond(4) | op2(2) | Rn | Rd
    //   CSEL/CSINC/CSINV/CSNEG. The op2 low bit selects increment/negate, op
    //   (bit30) selects invert/negate. Covers CSET/CSETM/CINC/CINV aliases.
    if (((insn >>> 21) & 0xff) === 0b11010100) {
      const sf = insn >>> 31;
      const op = (insn >>> 30) & 1;
      const rm = (insn >>> 16) & 0b11111;
      const cond = (insn >>> 12) & 0b1111;
      const op2 = (insn >>> 10) & 0b11;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const wMask = sf === 1 ? MASK64 : MASK32;
      let value: bigint;
      if (this.conditionHolds(cond)) {
        value = this.readGpr(rn) & wMask;
      } else {
        // op:op2 selects the transform applied to Rm: 0:00 CSEL, 0:01 CSINC,
        // 1:00 CSINV, 1:01 CSNEG.
        let other = this.readGpr(rm) & wMask;
        if (op === 0 && op2 === 0b01)
          other = (other + 1n) & wMask; // CSINC
        else if (op === 1 && op2 === 0b00)
          other = ~other & wMask; // CSINV
        else if (op === 1 && op2 === 0b01) other = (~other + 1n) & wMask; // CSNEG
        value = other;
      }
      this.writeGpr(rd, value);
      return true;
    }

    // Conditional compare (register): sf | op | 1 | 11010010 | Rm | cond | 0 | Rn | 0 | nzcv
    //   CCMP (op=1) / CCMN (op=0). If cond holds, compare Rn vs Rm and set NZCV;
    //   else load the immediate nzcv field into the flags.
    if (
      ((insn >>> 21) & 0xff) === 0b11010010 &&
      ((insn >>> 11) & 1) === 0 &&
      ((insn >>> 4) & 1) === 0
    ) {
      const sf = insn >>> 31;
      const op = (insn >>> 30) & 1;
      const rm = (insn >>> 16) & 0b11111;
      const cond = (insn >>> 12) & 0b1111;
      const rn = (insn >>> 5) & 0b11111;
      const nzcv = insn & 0b1111;
      if (this.conditionHolds(cond)) {
        if (op === 1) this.subWithFlags(this.readGpr(rn), this.readGpr(rm), sf);
        else this.addWithFlags(this.readGpr(rn), this.readGpr(rm), sf);
      } else {
        this.flagN = ((nzcv >> 3) & 1) === 1;
        this.flagZ = ((nzcv >> 2) & 1) === 1;
        this.flagC = ((nzcv >> 1) & 1) === 1;
        this.flagV = (nzcv & 1) === 1;
      }
      return true;
    }

    // Conditional compare (immediate): sf | op | 1 | 11010010 | imm5 | cond | 1 | Rn | 0 | nzcv
    //   Same as the register form but the second operand is a 5-bit zero-extended
    //   immediate. Distinguished from the register form by bit11 = 1.
    if (
      ((insn >>> 21) & 0xff) === 0b11010010 &&
      ((insn >>> 11) & 1) === 1 &&
      ((insn >>> 4) & 1) === 0
    ) {
      const sf = insn >>> 31;
      const op = (insn >>> 30) & 1;
      const imm5 = BigInt((insn >>> 16) & 0b11111);
      const cond = (insn >>> 12) & 0b1111;
      const rn = (insn >>> 5) & 0b11111;
      const nzcv = insn & 0b1111;
      if (this.conditionHolds(cond)) {
        if (op === 1) this.subWithFlags(this.readGpr(rn), imm5, sf);
        else this.addWithFlags(this.readGpr(rn), imm5, sf);
      } else {
        this.flagN = ((nzcv >> 3) & 1) === 1;
        this.flagZ = ((nzcv >> 2) & 1) === 1;
        this.flagC = ((nzcv >> 1) & 1) === 1;
        this.flagV = (nzcv & 1) === 1;
      }
      return true;
    }

    // Data-processing (1 source): sf | 1 | S | 11010110 | opcode2(5) | opcode(6) | Rn | Rd
    //   RBIT/REV16/REV32/REV, CLZ/CLS. Distinguished from 2-source by bit30=1.
    if (((insn >>> 21) & 0xff) === 0b11010110 && ((insn >>> 30) & 1) === 1) {
      const sf = insn >>> 31;
      const opcode = (insn >>> 10) & 0b111111;
      const rn = (insn >>> 5) & 0b11111;
      const rd = insn & 0b11111;
      const width = sf === 1 ? 64 : 32;
      const src = this.readGpr(rn) & (sf === 1 ? MASK64 : MASK32);
      switch (opcode) {
        case 0b000000: // RBIT
          this.writeGpr(rd, this.reverseBits(src, width));
          return true;
        case 0b000001: // REV16
          this.writeGpr(rd, this.reverseBytes(src, width, 2));
          return true;
        case 0b000010: // REV32 (or REV for 32-bit when sf=0)
          this.writeGpr(rd, this.reverseBytes(src, width, sf === 1 ? 4 : width / 8));
          return true;
        case 0b000011: // REV (64-bit)
          this.writeGpr(rd, this.reverseBytes(src, width, width / 8));
          return true;
        case 0b000100: // CLZ
          this.writeGpr(rd, BigInt(this.countLeadingZeros(src, width)));
          return true;
        default:
          break;
      }
    }

    return false;
  }

  /**
   * Loads and Stores (bits[28:25] = x1x0): LDR/STR immediate (unsigned offset
   * and pre/post-index) and LDP/STP. Returns true when handled.
   */
  private execLoadStore(insn: number): boolean {
    // FP/SIMD register transfers (V=1, bit 26) split off to the SIMD layer —
    // LDR/STR/LDP/STP of B/H/S/D/Q move bytes between guest memory and the V
    // register file, not the GPRs the rest of this method serves.
    if (((insn >>> 26) & 1) === 1) {
      return executeSimdLoadStore(this.simdContext(), insn);
    }

    // Load/store exclusive (LDXR/LDAXR/STXR/STLXR, byte/half/word/dword):
    //   size(31:30) | 001000 | o2 | L(22) | o1 | Rs(20:16) | o0 | Rt2 | Rn | Rt
    // The emulator is single-threaded, so an exclusive pair can never be broken
    // by another agent: a load reads normally, and a store always succeeds and
    // reports status 0 in Rs. This is what lets a stdlib guarding shared state
    // with LDAXR/STLXR (or a refcount) run to completion here.
    if (((insn >>> 24) & 0b111111) === 0b001000) {
      const size = insn >>> 30;
      const bytes = 1 << size;
      const isLoad = ((insn >>> 22) & 1) === 1;
      const rs = (insn >>> 16) & 0b11111;
      const rn = (insn >>> 5) & 0b11111;
      const rt = insn & 0b11111;
      const addr = Number(this.readGprSp(rn));
      if (isLoad) {
        this.writeGpr(rt, this.loadValue(addr, bytes));
      } else {
        this.storeValue(addr, bytes, this.readGpr(rt));
        this.writeGpr(rs, 0n); // exclusive store status: 0 = success
      }
      return true;
    }

    // LDR/STR family (integer): size(31:30) | 111 | V(26)=0 | b25:24 | opc(23:22) | …
    //   opc encodes load/store + signedness: 00 STR, 01 LDR (zero-extend),
    //   10 LDRS→64-bit (sign-extend), 11 LDRS→32-bit. bits 25:24 select the form:
    //     0b01 unsigned offset; 0b00 with bit21=0 → unscaled/pre/post-index;
    //     0b00 with bit21=1 → register offset.
    if (((insn >>> 27) & 0b111) === 0b111 && ((insn >>> 26) & 1) === 0) {
      const size = insn >>> 30; // 0=byte 1=half 2=word 3=dword
      const opc = (insn >>> 22) & 0b11;
      const form = (insn >>> 24) & 0b11;
      const rn = (insn >>> 5) & 0b11111;
      const rt = insn & 0b11111;
      const bytes = 1 << size;
      const isLoad = opc !== 0b00; // 00 = store; 01/10/11 = loads
      const signed = opc === 0b10 || opc === 0b11; // sign-extended loads
      // Sign-extended load target width: opc 10 → 64-bit, opc 11 → 32-bit.
      const loadWidth = opc === 0b11 ? 32 : 64;

      const doLoad = (addr: number): void => {
        const raw = this.loadValue(addr, bytes);
        const value = signed ? BigInt.asUintN(loadWidth, this.signExtend(raw, bytes * 8)) : raw;
        this.writeGpr(rt, value);
      };

      if (form === 0b01) {
        // Unsigned offset: imm12 scaled by access size.
        const imm12 = (insn >>> 10) & 0xfff;
        const addr = Number(BigInt.asUintN(64, this.readGprSp(rn) + BigInt(imm12 * bytes)));
        if (isLoad) doLoad(addr);
        else this.storeValue(addr, bytes, this.readGpr(rt));
        return true;
      }

      if (form === 0b00 && ((insn >>> 21) & 1) === 1 && ((insn >>> 10) & 0b11) === 0b10) {
        // Register offset: [Xn, Rm{, extend {amount}}]. option(15:13), S(12) →
        // shift amount = S ? size : 0. The common case is LSL #size (option 011).
        const rm = (insn >>> 16) & 0b11111;
        const option = (insn >>> 13) & 0b111;
        const s = (insn >>> 12) & 1;
        const shift = s === 1 ? size : 0;
        const offset = this.extendReg(this.readGpr(rm), option, shift, 1);
        // BUGFIX: Do address arithmetic in bigint space. Offset is ALREADY
        // correctly extended by extendReg (sign or zero), so just add as-is.
        const base = this.readGprSp(rn);
        const addr = Number(BigInt.asUintN(64, base + offset));
        if (isLoad) doLoad(addr);
        else this.storeValue(addr, bytes, this.readGpr(rt));
        return true;
      }

      if (form === 0b00) {
        // imm9-offset forms, distinguished by idx (bits 11:10):
        //   00 unscaled (LDUR/STUR): address = base + imm9, no writeback.
        //   01 post-index: access at base, then writeback base + imm9.
        //   11 pre-index: access at base + imm9, with writeback.
        // (Only post-index uses the bare base; unscaled and pre-index both add
        // imm9 to form the effective address — the earlier code applied imm9 to
        // pre-index only, so every STUR/LDUR with a non-zero offset hit the wrong
        // address and silently lost the access.)
        const imm9raw = (insn >>> 12) & 0x1ff;
        const imm9 = imm9raw & 0x100 ? imm9raw - 0x200 : imm9raw;
        const idx = (insn >>> 10) & 0b11;
        const base = this.readGprSp(rn);
        // BUGFIX: Do address arithmetic in bigint space
        const addr = idx === 0b01 ? Number(base) : Number(BigInt.asUintN(64, base + BigInt(imm9)));
        if (isLoad) doLoad(addr);
        else this.storeValue(addr, bytes, this.readGpr(rt));
        if (idx === 0b11 || idx === 0b01) {
          this.writeGprSp(rn, BigInt.asUintN(64, base + BigInt(imm9))); // writeback (pre/post only)
        }
        return true;
      }
    }

    // LDR (literal): opc(31:30) | 011 | V(26)=0 | 00 | imm19 | Rt
    //   PC-relative load: Rt = *(PC + SignExtend(imm19 << 2)). opc 00 → 32-bit,
    //   01 → 64-bit. Used for large constants the compiler pools after a function.
    if (((insn >>> 24) & 0b111111) === 0b011000 && ((insn >>> 26) & 1) === 0) {
      const opc = insn >>> 30;
      const bytes = opc === 0b01 ? 8 : 4;
      const rt = insn & 0b11111;
      const addr = this.pc + this.imm19Offset(insn);
      this.writeGpr(rt, this.loadValue(addr, bytes));
      return true;
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
      const base = this.readGprSp(rn);
      // BUGFIX: Do address arithmetic in bigint space
      const addr = idx === 0b01 ? Number(base) : Number(BigInt.asUintN(64, base + BigInt(imm7)));
      if (isLoad) {
        this.writeGpr(rt, this.loadValue(addr, bytes));
        this.writeGpr(rt2, this.loadValue(addr + bytes, bytes));
      } else {
        this.storeValue(addr, bytes, this.readGpr(rt));
        this.storeValue(addr + bytes, bytes, this.readGpr(rt2));
      }
      if (idx !== 0b10) {
        // pre/post-index write the updated base back; signed-offset (0b10) does not.
        this.writeGprSp(rn, BigInt.asUintN(64, base + BigInt(imm7)));
      }
      return true;
    }

    return false;
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
      case 0b11: {
        // ROR — rotate right within the operand width (logical shifted-register).
        const v = value & mask;
        const a = amt % width;
        return ((v >> a) | (v << (width - a))) & mask;
      }
      default:
        throw new Error(`Unsupported shift type ${shiftType}`);
    }
  }

  /**
   * Compute operand1 + operand2 at the given width, update NZCV, and return the
   * (width-masked) result. C = unsigned carry-out, V = signed overflow, matching
   * AArch64 ADDS semantics. ADC adds an incoming carry bit.
   */
  private addWithFlags(operand1: bigint, operand2: bigint, sf: number, carryIn = 0n): bigint {
    const width = sf === 1 ? 64n : 32n;
    const mask = (1n << width) - 1n;
    const a = operand1 & mask;
    const b = operand2 & mask;
    const full = a + b + carryIn;
    const result = full & mask;
    this.flagN = result >> (width - 1n) === 1n;
    this.flagZ = result === 0n;
    this.flagC = full > mask; // unsigned carry-out
    const signA = (a >> (width - 1n)) & 1n;
    const signB = (b >> (width - 1n)) & 1n;
    const signR = (result >> (width - 1n)) & 1n;
    this.flagV = signA === signB && signA !== signR; // signed overflow
    return result;
  }

  /**
   * Decode a logical-immediate (N:immr:imms) into the replicated bitmask, per the
   * ARM ARM `DecodeBitMasks` pseudocode (immediate-only path, no tmask needed).
   * Used by AND/ORR/EOR/ANDS immediate. Throws on the reserved encoding.
   */
  private decodeBitMask(n: number, immr: number, imms: number, sf: number): bigint {
    // len = highest set bit of (N:NOT(imms)); element size esize = 2^len.
    const combined = (n << 6) | (~imms & 0x3f);
    let len = -1;
    for (let i = 6; i >= 0; i--) {
      if ((combined >> i) & 1) {
        len = i;
        break;
      }
    }
    if (len < 1)
      throw new Error(`Reserved logical-immediate encoding (N=${n}, imms=0x${imms.toString(16)})`);
    const esize = 1 << len;
    const levels = esize - 1;
    const s = imms & levels;
    const r = immr & levels;
    if (s === levels) throw new Error('Reserved logical-immediate encoding (imms all-ones)');
    // welem = Ones(S+1), rotated right by R within the element, then replicated.
    const esizeB = BigInt(esize);
    const welem = (1n << BigInt(s + 1)) - 1n;
    const rB = BigInt(r);
    const rotated = ((welem >> rB) | (welem << (esizeB - rB))) & ((1n << esizeB) - 1n);
    // Replicate the element across the 64- or 32-bit register width.
    const regWidth = sf === 1 ? 64 : 32;
    let result = 0n;
    for (let pos = 0; pos < regWidth; pos += esize) {
      result |= rotated << BigInt(pos);
    }
    const mask = sf === 1 ? MASK64 : MASK32;
    return result & mask;
  }

  /** Sign-extend the low `bits` of `value` to a signed JS-number-safe BigInt. */
  private signExtend(value: bigint, bits: number): bigint {
    const b = BigInt(bits);
    const signBit = 1n << (b - 1n);
    const masked = value & ((1n << b) - 1n);
    return masked & signBit ? masked - (1n << b) : masked;
  }

  /**
   * Apply an extended-register operation (UXTB..SXTX) used by ADD/SUB extended
   * register and the LDR/STR register-offset form: extract the low byte/half/
   * word/dword, zero- or sign-extend it, then left-shift by `shift`.
   */
  private extendReg(value: bigint, option: number, shift: number, sf: number): bigint {
    const mask = sf === 1 ? MASK64 : MASK32;
    let extracted: bigint;
    switch (option) {
      case 0b000: // UXTB
        extracted = value & 0xffn;
        break;
      case 0b001: // UXTH
        extracted = value & 0xffffn;
        break;
      case 0b010: // UXTW
        extracted = value & 0xffffffffn;
        break;
      case 0b011: // UXTX (no extension)
        extracted = value & MASK64;
        break;
      case 0b100: // SXTB
        extracted = BigInt.asUintN(64, this.signExtend(value, 8));
        break;
      case 0b101: // SXTH
        extracted = BigInt.asUintN(64, this.signExtend(value, 16));
        break;
      case 0b110: // SXTW
        extracted = BigInt.asUintN(64, this.signExtend(value, 32));
        break;
      default: // SXTX (0b111)
        extracted = value & MASK64;
        break;
    }
    return (extracted << BigInt(shift)) & mask;
  }

  /** Reverse the bit order of the low `width` bits of `value`. */
  private reverseBits(value: bigint, width: number): bigint {
    let result = 0n;
    let v = value;
    for (let i = 0; i < width; i++) {
      result = (result << 1n) | (v & 1n);
      v >>= 1n;
    }
    return result;
  }

  /** Count leading zeros of the low `width` bits of `value`. */
  private countLeadingZeros(value: bigint, width: number): number {
    for (let i = width - 1; i >= 0; i--) {
      if ((value >> BigInt(i)) & 1n) return width - 1 - i;
    }
    return width;
  }

  /** Reverse `value` byte-wise within each `groupBytes`-sized lane of `width` bits. */
  private reverseBytes(value: bigint, width: number, groupBytes: number): bigint {
    const totalBytes = width / 8;
    const bytes: bigint[] = [];
    let v = value;
    for (let i = 0; i < totalBytes; i++) {
      bytes.push(v & 0xffn);
      v >>= 8n;
    }
    // Reverse within each group of `groupBytes` little-endian bytes.
    let result = 0n;
    for (let g = 0; g < totalBytes; g += groupBytes) {
      for (let i = 0; i < groupBytes; i++) {
        const src = bytes[g + groupBytes - 1 - i] ?? 0n;
        result |= src << BigInt((g + i) * 8);
      }
    }
    return result;
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

  private addRegion(region: MappedRegion): void {
    if (
      this.regionFastPathSafe &&
      this.regions.some((existing) => regionsOverlap(existing, region.base, region.size))
    ) {
      this.regionFastPathSafe = false;
      this.lastRegion = undefined;
      this.regionsByBase.length = 0;
    }
    this.regions.push(region);
    if (this.regionFastPathSafe) insertRegionByBase(this.regionsByBase, region);
  }

  private findRegion(address: number, length: number): MappedRegion {
    const cached = this.lastRegion;
    if (
      this.regionFastPathSafe &&
      cached &&
      address >= cached.base &&
      address + length <= cached.base + cached.size
    ) {
      return cached;
    }
    if (this.regionFastPathSafe) {
      const indexed = findRegionByBase(this.regionsByBase, address, length);
      if (indexed) {
        this.lastRegion = indexed;
        return indexed;
      }
    }
    for (const region of this.regions) {
      if (address >= region.base && address + length <= region.base + region.size) {
        if (this.regionFastPathSafe) this.lastRegion = region;
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

function regionsOverlap(region: MappedRegion, base: number, size: number): boolean {
  return base < region.base + region.size && region.base < base + size;
}

function insertRegionByBase(regions: MappedRegion[], region: MappedRegion): void {
  let lo = 0;
  let hi = regions.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (regions[mid]!.base < region.base) lo = mid + 1;
    else hi = mid;
  }
  regions.splice(lo, 0, region);
}

function findRegionByBase(
  regions: readonly MappedRegion[],
  address: number,
  length: number,
): MappedRegion | undefined {
  let lo = 0;
  let hi = regions.length - 1;
  let candidate: MappedRegion | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const region = regions[mid]!;
    if (region.base <= address) {
      candidate = region;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return candidate && containsRegion(candidate, address, length) ? candidate : undefined;
}

function containsRegion(region: MappedRegion, address: number, length: number): boolean {
  return address >= region.base && address + length <= region.base + region.size;
}
