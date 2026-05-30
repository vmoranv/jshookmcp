/**
 * bionic — JS-implemented Android libc (bionic) stubs for the emulator.
 *
 * When an emulated `.so` calls an external libc symbol (malloc/memcpy/strlen/…),
 * the symbol's PLT/GOT target is registered as a host stub via
 * `CpuEngine.registerHostFunction`. The engine then runs the JS implementation
 * with the AAPCS argument registers (x0..x7) and writes the return value to x0,
 * instead of fetching guest instructions there — bridging guest code to a libc
 * we never actually load.
 *
 * Stubs are installed by address so callers can place them anywhere they route
 * imports to. Only the entries present in `addrs` are registered.
 */
import type { CpuEngine, HostContext } from './CpuEngine';

/** Guest addresses to bind each bionic stub to (omit any you don't need). */
export interface BionicStubAddresses {
  strlen?: number;
  memcpy?: number;
  memset?: number;
  malloc?: number;
  free?: number;
}

/**
 * Injectable behaviour for the stdio/logging stubs. The virtual file system lets
 * a caller model "what files exist on the device" — exactly the question
 * anti-tamper code (RootBeer's exists()/fopen, Frida-server path probes) asks. An
 * empty/absent `files` map means a clean device: every fopen returns NULL.
 */
export interface BionicOptions {
  /**
   * Virtual file system for fopen/fread: absolute path → file contents. A path
   * present here "exists" (fopen returns a non-NULL FILE*); any other path fails
   * (fopen returns NULL), modelling a device where the artifact is absent.
   */
  files?: Map<string, Uint8Array>;
  /**
   * Sink for __android_log_print: receives (priority, tag, message). Default:
   * discard. Lets a caller observe what a detection routine logs.
   */
  onLog?: (priority: number, tag: string, message: string) => void;
}

/** Bump-allocator heap base — distinct from typical code/data vaddrs. */
const HEAP_BASE = 0x100000;
/** Allocation granularity (bytes); keeps returned pointers naturally aligned. */
const HEAP_ALIGN = 16;

/**
 * A bionic libc implementation keyed by symbol name, for relocation-driven
 * auto-wiring: when CpuEngine.loadElf resolves an import (R_AARCH64_JUMP_SLOT /
 * GLOB_DAT) whose name is in here, it points the GOT slot at a stub running the
 * matching HostFunction. Stateful entries (malloc/free) capture a shared heap.
 */
export type BionicLibrary = Map<string, (ctx: HostContext) => bigint | number | void>;

/**
 * Build the default bionic libc as a name→HostFunction map. A single bump heap
 * is shared across malloc/calloc/realloc; free is a no-op (the bump allocator
 * never reclaims). The map is the source of truth both for auto-wiring and for
 * the address-keyed installBionicStubs below.
 */
/** Read a NUL-terminated C string from guest memory via a host-call context. */
function readCString(ctx: HostContext, addr: number): string {
  if (addr === 0) return '';
  const out: number[] = [];
  for (let i = 0; ; i++) {
    const b = ctx.read(addr + i, 1)[0] ?? 0;
    if (b === 0) break;
    out.push(b);
  }
  return new TextDecoder().decode(Uint8Array.from(out));
}

export function createBionicLibrary(engine: CpuEngine, options: BionicOptions = {}): BionicLibrary {
  const lib: BionicLibrary = new Map();
  let bump = HEAP_BASE;
  // Track allocation sizes so realloc can copy the old contents forward.
  const sizes = new Map<number, number>();

  const alloc = (size: number): number => {
    const rounded = Math.max(HEAP_ALIGN, (size + HEAP_ALIGN - 1) & ~(HEAP_ALIGN - 1));
    const ptr = bump;
    engine.mapMemory(ptr, rounded);
    bump += rounded;
    sizes.set(ptr, size);
    return ptr;
  };

  // Open FILE* streams: handle (guest ptr) → { bytes, pos }. The handle is a
  // small allocation so it's a unique, dereferenceable non-NULL pointer.
  const streams = new Map<number, { bytes: Uint8Array; pos: number }>();
  const files = options.files;

  lib.set('strlen', (ctx) => {
    const start = Number(ctx.x(0));
    let len = 0;
    while (ctx.read(start + len, 1)[0] !== 0) len++;
    return BigInt(len);
  });
  lib.set('memcpy', (ctx) => {
    const dst = Number(ctx.x(0));
    ctx.write(dst, ctx.read(Number(ctx.x(1)), Number(ctx.x(2))));
    return ctx.x(0);
  });
  lib.set('memmove', (ctx) => {
    // Copy via an intermediate buffer so overlapping ranges stay correct.
    const dst = Number(ctx.x(0));
    const copy = Uint8Array.from(ctx.read(Number(ctx.x(1)), Number(ctx.x(2))));
    ctx.write(dst, copy);
    return ctx.x(0);
  });
  lib.set('memset', (ctx) => {
    const buf = Number(ctx.x(0));
    const value = Number(ctx.x(1) & 0xffn);
    const n = Number(ctx.x(2));
    ctx.write(buf, new Uint8Array(n).fill(value));
    return ctx.x(0);
  });
  lib.set('memcmp', (ctx) => {
    const a = ctx.read(Number(ctx.x(0)), Number(ctx.x(2)));
    const b = ctx.read(Number(ctx.x(1)), Number(ctx.x(2)));
    for (let i = 0; i < a.length; i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (d !== 0) return BigInt(d < 0 ? -1 : 1);
    }
    return 0n;
  });
  lib.set('strcmp', (ctx) => {
    let p = Number(ctx.x(0));
    let q = Number(ctx.x(1));
    for (;;) {
      const a = ctx.read(p++, 1)[0] ?? 0;
      const b = ctx.read(q++, 1)[0] ?? 0;
      if (a !== b) return BigInt(a < b ? -1 : 1);
      if (a === 0) return 0n;
    }
  });
  lib.set('strncmp', (ctx) => {
    let p = Number(ctx.x(0));
    let q = Number(ctx.x(1));
    const n = Number(ctx.x(2));
    for (let i = 0; i < n; i++) {
      const a = ctx.read(p++, 1)[0] ?? 0;
      const b = ctx.read(q++, 1)[0] ?? 0;
      if (a !== b) return BigInt(a < b ? -1 : 1);
      if (a === 0) break;
    }
    return 0n;
  });
  lib.set('strcpy', (ctx) => {
    const dst = Number(ctx.x(0));
    let src = Number(ctx.x(1));
    let i = 0;
    for (;;) {
      const b = ctx.read(src++, 1)[0] ?? 0;
      ctx.write(dst + i, Uint8Array.of(b));
      i++;
      if (b === 0) break;
    }
    return ctx.x(0);
  });
  lib.set('strncpy', (ctx) => {
    // Copy up to n bytes; if src ends early, NUL-pad the remainder (C semantics).
    const dst = Number(ctx.x(0));
    const src = Number(ctx.x(1));
    const n = Number(ctx.x(2));
    let ended = false;
    for (let i = 0; i < n; i++) {
      const b = ended ? 0 : (ctx.read(src + i, 1)[0] ?? 0);
      ctx.write(dst + i, Uint8Array.of(b));
      if (b === 0) ended = true;
    }
    return ctx.x(0);
  });
  lib.set('strchr', (ctx) => {
    // Return a pointer to the first occurrence of the byte, or NULL. The
    // terminating NUL is matchable, mirroring the C contract.
    const start = Number(ctx.x(0));
    const needle = Number(ctx.x(1) & 0xffn);
    for (let i = 0; ; i++) {
      const b = ctx.read(start + i, 1)[0] ?? 0;
      if (b === needle) return BigInt(start + i);
      if (b === 0) return 0n;
    }
  });
  lib.set('strdup', (ctx) => {
    // Allocate len+1 and copy the string including its NUL terminator.
    const src = Number(ctx.x(0));
    let len = 0;
    while (ctx.read(src + len, 1)[0] !== 0) len++;
    const ptr = alloc(len + 1);
    ctx.write(ptr, ctx.read(src, len + 1));
    return BigInt(ptr);
  });
  lib.set('malloc', (ctx) => BigInt(alloc(Number(ctx.x(0)))));
  lib.set('calloc', (ctx) => {
    const n = Number(ctx.x(0)) * Number(ctx.x(1));
    const ptr = alloc(n);
    ctx.write(ptr, new Uint8Array(n)); // calloc zeroes
    return BigInt(ptr);
  });
  lib.set('realloc', (ctx) => {
    const old = Number(ctx.x(0));
    const size = Number(ctx.x(1));
    if (old === 0) return BigInt(alloc(size));
    const ptr = alloc(size);
    const oldSize = sizes.get(old) ?? 0;
    if (oldSize > 0) ctx.write(ptr, ctx.read(old, Math.min(oldSize, size)));
    return BigInt(ptr);
  });
  lib.set('free', () => undefined);
  lib.set('__stack_chk_fail', () => {
    throw new Error('bionic: __stack_chk_fail (stack canary corrupted in emulated code)');
  });
  lib.set('abort', () => {
    throw new Error('bionic: abort() called by emulated code');
  });

  // ── stdio + logging: model "what files exist" for anti-tamper detection ──

  /**
   * FILE* fopen(const char* path, const char* mode). Returns a non-NULL handle
   * when `path` is in the virtual file system, else NULL — the exact signal
   * RootBeer's exists() and similar probes test. Write modes always fail (the
   * emulated FS is read-only).
   */
  lib.set('fopen', (ctx) => {
    const path = readCString(ctx, Number(ctx.x(0)));
    const contents = files?.get(path);
    if (!contents) return 0n; // NULL: file does not exist on this device
    const handle = alloc(1); // unique, dereferenceable FILE* token
    streams.set(handle, { bytes: contents, pos: 0 });
    return BigInt(handle);
  });
  /** int fclose(FILE*). Releases the stream; returns 0 (success). */
  lib.set('fclose', (ctx) => {
    streams.delete(Number(ctx.x(0)));
    return 0n;
  });
  /** size_t fread(void* ptr, size_t size, size_t nmemb, FILE*). Returns nmemb read. */
  lib.set('fread', (ctx) => {
    const dst = Number(ctx.x(0));
    const size = Number(ctx.x(1));
    const nmemb = Number(ctx.x(2));
    const stream = streams.get(Number(ctx.x(3)));
    if (!stream || size === 0) return 0n;
    const want = size * nmemb;
    const slice = stream.bytes.subarray(stream.pos, stream.pos + want);
    if (slice.length > 0) ctx.write(dst, slice);
    stream.pos += slice.length;
    return BigInt(Math.floor(slice.length / size));
  });
  /** char* fgets(char* buf, int n, FILE*). Reads one line (incl. \n), NUL-terminated. */
  lib.set('fgets', (ctx) => {
    const buf = Number(ctx.x(0));
    const n = Number(ctx.x(1));
    const stream = streams.get(Number(ctx.x(2)));
    if (!stream || n <= 0 || stream.pos >= stream.bytes.length) return 0n; // NULL at EOF
    const out: number[] = [];
    while (out.length < n - 1 && stream.pos < stream.bytes.length) {
      const b = stream.bytes[stream.pos++] ?? 0;
      out.push(b);
      if (b === 0x0a) break; // newline ends the line
    }
    out.push(0);
    ctx.write(buf, Uint8Array.from(out));
    return BigInt(buf);
  });
  /** int feof(FILE*). Non-zero once the read cursor reached end-of-file. */
  lib.set('feof', (ctx) => {
    const stream = streams.get(Number(ctx.x(0)));
    return stream && stream.pos >= stream.bytes.length ? 1n : 0n;
  });
  /**
   * int __android_log_print(int prio, const char* tag, const char* fmt, ...).
   * The variadic format isn't expanded; the raw fmt string is forwarded with its
   * tag/priority so a caller can observe detection logging. Returns 1.
   */
  lib.set('__android_log_print', (ctx) => {
    const priority = Number(ctx.x(0));
    const tag = readCString(ctx, Number(ctx.x(1)));
    const message = readCString(ctx, Number(ctx.x(2)));
    options.onLog?.(priority, tag, message);
    return 1n;
  });
  // C++ runtime registration hooks the loader emits; no-ops that return success.
  lib.set('__cxa_atexit', () => 0n);
  lib.set('__cxa_finalize', () => undefined);

  return lib;
}

export function installBionicStubs(engine: CpuEngine, addrs: BionicStubAddresses): void {
  if (addrs.strlen !== undefined) {
    engine.registerHostFunction(addrs.strlen, (ctx: HostContext) => {
      const start = Number(ctx.x(0));
      let len = 0;
      while (ctx.read(start + len, 1)[0] !== 0) len++;
      return BigInt(len);
    });
  }

  if (addrs.memcpy !== undefined) {
    engine.registerHostFunction(addrs.memcpy, (ctx: HostContext) => {
      const dst = Number(ctx.x(0));
      const src = Number(ctx.x(1));
      const n = Number(ctx.x(2));
      ctx.write(dst, ctx.read(src, n));
      return ctx.x(0); // memcpy returns dest
    });
  }

  if (addrs.memset !== undefined) {
    engine.registerHostFunction(addrs.memset, (ctx: HostContext) => {
      const buf = Number(ctx.x(0));
      const value = Number(ctx.x(1) & 0xffn);
      const n = Number(ctx.x(2));
      ctx.write(buf, new Uint8Array(n).fill(value));
      return ctx.x(0); // memset returns dest
    });
  }

  if (addrs.malloc !== undefined) {
    let bump = HEAP_BASE;
    engine.registerHostFunction(addrs.malloc, (ctx: HostContext) => {
      const size = Number(ctx.x(0));
      const rounded = Math.max(HEAP_ALIGN, (size + HEAP_ALIGN - 1) & ~(HEAP_ALIGN - 1));
      const ptr = bump;
      engine.mapMemory(ptr, rounded); // lazily back each allocation
      bump += rounded;
      return BigInt(ptr);
    });
  }

  if (addrs.free !== undefined) {
    // The bump allocator never reclaims, so free is a no-op.
    engine.registerHostFunction(addrs.free, () => undefined);
  }
}
