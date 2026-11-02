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
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import {
  formatGuestCString,
  readGuestCString as readCString,
  readGuestCStringBytes,
  utf8ByteLength,
  writeGuestCString,
} from './c-strings';
import { writeGuestU64 } from './guest-memory';
import { BionicLibrary } from './bionic/library';
import { installAndroidAssetStubs } from './bionic/install-android-assets';
import {
  installAlignedAllocationStubs,
  installConversionStubs,
  installErrorStubs,
  installFortifiedMemoryStubs,
  installStringExtensionStubs,
} from './bionic/install-libc-extensions';
import {
  installFormattedOutputStubs,
  installFortifiedFormatStubs,
  installStdioExtensionStubs,
} from './bionic/install-stdio-extensions';
import {
  installDynamicLinkerExtensionStubs,
  installProcessExtensionStubs,
  installSystemExtensionStubs,
  installThreadExtensionStubs,
  installTimeExtensionStubs,
} from './bionic/install-runtime-extensions';
import type {
  BionicMemoryMapper,
  BionicOptions,
  BionicRuntime,
  BionicStubAddresses,
} from './bionic/types';

export { BionicLibrary } from './bionic/library';
export type {
  BionicMemoryMapper,
  BionicOptions,
  BionicRuntime,
  BionicStubAddresses,
} from './bionic/types';

/** Minimal memory-mapping surface bionic needs for heap-backed libc stubs. */
/**
 * Injectable behaviour for the stdio/logging stubs. The virtual file system lets
 * a caller model "what files exist on the device" — exactly the question
 * anti-tamper code (RootBeer's exists()/fopen, Frida-server path probes) asks. An
 * empty/absent `files` map means a clean device: every fopen returns NULL.
 */
/** Bump-allocator heap base — distinct from typical code/data vaddrs. */
const HEAP_BASE = 0x41000000;
/** Allocation granularity (bytes); keeps returned pointers naturally aligned. */
const HEAP_ALIGN = 16;

// ===========================================================================
//  Shared bionic stubs — used by both createBionicLibrary (name→fn map) and
//  installBionicStubs (address-keyed registration).  Single source of truth
//  prevents the bit-level drift that bit the installBionicStubs malloc
//  (missing 16-byte pointer alignment — now fixed).
// ===========================================================================

/** strlen stub — stateless, safe to share across both code paths. */
function stubStrlen(ctx: HostContext): bigint {
  return BigInt(readGuestCStringBytes(ctx, Number(ctx.x(0))).length);
}

/** memcpy stub — stateless. */
function stubMemcpy(ctx: HostContext): bigint {
  const dst = Number(ctx.x(0));
  ctx.write(dst, ctx.read(Number(ctx.x(1)), Number(ctx.x(2))));
  return ctx.x(0);
}

/** memset stub — stateless. */
function stubMemset(ctx: HostContext): bigint {
  const buf = Number(ctx.x(0));
  const value = Number(ctx.x(1) & 0xffn);
  const n = Number(ctx.x(2));
  ctx.write(buf, new Uint8Array(n).fill(value));
  return ctx.x(0);
}

/**
 * Create a bump-allocator-backed malloc/free pair.
 *
 * All pointers are 16-byte aligned (ARM64 ABI requirement).  The returned
 * free() is a no-op — the bump allocator never reclaims.
 */
function createBumpAllocator(
  engine: { mapMemory(addr: number, size: number): void },
  heapBase: number,
): { malloc(ctx: HostContext): bigint; free(ctx: HostContext): void } {
  let bump = heapBase;
  return {
    malloc: (ctx: HostContext): bigint => {
      const size = Number(ctx.x(0));
      const roundedSize = Math.max(HEAP_ALIGN, (size + HEAP_ALIGN - 1) & ~(HEAP_ALIGN - 1));
      const ptr = Math.ceil(bump / HEAP_ALIGN) * HEAP_ALIGN;
      engine.mapMemory(ptr, roundedSize);
      bump = ptr + roundedSize;
      return BigInt(ptr);
    },
    free: (): void => {
      // bump allocator never reclaims
    },
  };
}
/** Default emulated page size returned by libc/sysconf imports. */
const PAGE_SIZE = getReverseEngineeringConfig().nativeEmulator.guestPageSizeBytes;
/** Fake pid/uid reported by getpid/getuid/geteuid — stable so emulated code
 *  that caches the value (or writes it into logs/state) is deterministic. */
const FAKE_PID_UID = 10000n;
/** Linux/Android-ish sysconf names used by common bionic callers. */
const SC_PAGE_SIZE_NAMES = new Set([30, 47]);
const SC_NPROCESSORS_ONLN_NAMES = new Set([84]);

/**
 * A bionic libc implementation keyed by symbol name, for relocation-driven
 * auto-wiring: when CpuEngine.loadElf resolves an import (R_AARCH64_JUMP_SLOT /
 * GLOB_DAT) whose name is in here, it points the GOT slot at a stub running the
 * matching HostFunction. Stateful entries (malloc/free) capture a shared heap.
 */
/**
 * Build the default bionic libc as a name→HostFunction map. A single bump heap
 * is shared across malloc/calloc/realloc; free is a no-op (the bump allocator
 * never reclaims). The map is the source of truth both for auto-wiring and for
 * the address-keyed installBionicStubs below.
 */
export function createBionicLibrary(
  engine: BionicRuntime,
  options: BionicOptions = {},
): BionicLibrary {
  const lib = new BionicLibrary();
  let bump = options.heapBase ?? HEAP_BASE;
  // Track allocation sizes so realloc can copy the old contents forward.
  const sizes = new Map<number, number>();

  const allocAligned = (size: number, alignment: number): number => {
    const normalizedSize = Math.max(0, Math.trunc(size));
    const rounded = Math.max(HEAP_ALIGN, Math.ceil(normalizedSize / HEAP_ALIGN) * HEAP_ALIGN);
    const ptr = Math.ceil(bump / alignment) * alignment;
    engine.mapMemory(ptr, rounded);
    bump = ptr + rounded;
    sizes.set(ptr, normalizedSize);
    return ptr;
  };
  const alloc = (size: number): number => allocAligned(size, HEAP_ALIGN);

  // Open FILE* streams: handle (guest ptr) → { bytes, pos }. The handle is a
  // small allocation so it's a unique, dereferenceable non-NULL pointer.
  const streams = new Map<number, { bytes: Uint8Array; pos: number }>();
  const files = options.files;
  const dlHandles = new Map<string, number>();
  let lastDlError = '';

  const writeDlError = (ctx: HostContext): bigint => {
    if (lastDlError.length === 0) return 0n;
    const ptr = alloc(utf8ByteLength(lastDlError) + 1);
    writeGuestCString(ctx, ptr, lastDlError);
    const out = BigInt(ptr);
    lastDlError = '';
    return out;
  };

  lib.set('strlen', stubStrlen);
  lib.set('memcpy', stubMemcpy);
  lib.set('memmove', (ctx) => {
    // Copy via an intermediate buffer so overlapping ranges stay correct.
    const dst = Number(ctx.x(0));
    const copy = Uint8Array.from(ctx.read(Number(ctx.x(1)), Number(ctx.x(2))));
    ctx.write(dst, copy);
    return ctx.x(0);
  });
  lib.set('memset', stubMemset);
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
    const a = readGuestCStringBytes(ctx, Number(ctx.x(0)));
    const b = readGuestCStringBytes(ctx, Number(ctx.x(1)));
    return BigInt(compareCStringBytes(a, b, Math.max(a.length, b.length) + 1));
  });
  lib.set('strncmp', (ctx) => {
    const n = Number(ctx.x(2));
    if (n <= 0) return 0n;
    const a = readGuestCStringBytes(ctx, Number(ctx.x(0)), n);
    const b = readGuestCStringBytes(ctx, Number(ctx.x(1)), n);
    return BigInt(compareCStringBytes(a, b, n));
  });
  lib.set('strcpy', (ctx) => {
    const dst = Number(ctx.x(0));
    const body = readGuestCStringBytes(ctx, Number(ctx.x(1)));
    const out = new Uint8Array(body.length + 1);
    out.set(body);
    ctx.write(dst, out);
    return ctx.x(0);
  });
  lib.set('strncpy', (ctx) => {
    // Copy up to n bytes; if src ends early, NUL-pad the remainder (C semantics).
    const dst = Number(ctx.x(0));
    const src = Number(ctx.x(1));
    const n = Number(ctx.x(2));
    if (n > 0) {
      const body = readGuestCStringBytes(ctx, src, n);
      const out = new Uint8Array(n);
      out.set(body.subarray(0, n));
      ctx.write(dst, out);
    }
    return ctx.x(0);
  });
  lib.set('strchr', (ctx) => {
    // Return a pointer to the first occurrence of the byte, or NULL. The
    // terminating NUL is matchable, mirroring the C contract.
    const start = Number(ctx.x(0));
    const needle = Number(ctx.x(1) & 0xffn);
    const body = readGuestCStringBytes(ctx, start);
    if (needle === 0) return BigInt(start + body.length);
    const index = body.indexOf(needle);
    return index >= 0 ? BigInt(start + index) : 0n;
  });
  lib.set('strrchr', (ctx) => {
    // char *strrchr(const char *s, int c) — return pointer to LAST occurrence
    const start = Number(ctx.x(0));
    const needle = Number(ctx.x(1) & 0xffn);
    const body = readGuestCStringBytes(ctx, start);
    if (needle === 0) return BigInt(start + body.length);
    const index = body.lastIndexOf(needle);
    return index >= 0 ? BigInt(start + index) : 0n;
  });
  lib.set('strdup', (ctx) => {
    // Allocate len+1 and copy the string including its NUL terminator.
    const body = readGuestCStringBytes(ctx, Number(ctx.x(0)));
    const ptr = alloc(body.length + 1);
    const out = new Uint8Array(body.length + 1);
    out.set(body);
    ctx.write(ptr, out);
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
    // Stack canary mismatch is expected in the emulator — the real canary is
    // TLS-based and our stub constructor never initialised it. Log and continue
    // so the caller can observe the actual function result.
    return undefined;
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
    const message = formatGuestCString(ctx, Number(ctx.x(2)), 3);
    options.onLog?.(priority, tag, message);
    return 1n;
  });
  // C++ runtime registration hooks the loader emits; no-ops that return success.
  lib.set('__cxa_atexit', () => 0n);
  lib.set('__cxa_finalize', () => undefined);

  // ── Android libc/runtime imports used by packers and linkers ─────────────
  lib.set('getpagesize', () => BigInt(PAGE_SIZE));
  lib.set('sysconf', (ctx) => {
    const name = Number(ctx.x(0));
    if (SC_PAGE_SIZE_NAMES.has(name)) return BigInt(PAGE_SIZE);
    if (SC_NPROCESSORS_ONLN_NAMES.has(name)) return 1n;
    return BigInt(-1);
  });
  lib.set('mprotect', () => 0n);
  lib.set('munmap', () => 0n);
  lib.set('prctl', () => 0n);
  lib.set('getpid', () => FAKE_PID_UID);
  lib.set('getuid', () => FAKE_PID_UID);
  lib.set('sleep', () => 0n);
  lib.set('usleep', () => 0n);

  // ── Time functions ────────────────────────────────────────────────────────
  lib.set('time', (ctx) => {
    // time_t time(time_t *tloc) — return seconds since epoch, optionally store
    const tloc = Number(ctx.x(0));
    const now = Math.floor(Date.now() / 1000);
    if (tloc !== 0) writeGuestU64(ctx, tloc, now);
    return BigInt(now);
  });
  lib.set('gettimeofday', (ctx) => {
    // int gettimeofday(struct timeval *tv, struct timezone *tz)
    const tv = Number(ctx.x(0));
    if (tv !== 0) {
      const now = Date.now();
      const sec = Math.floor(now / 1000);
      const usec = (now % 1000) * 1000;
      writeGuestU64(ctx, tv, sec);
      writeGuestU64(ctx, tv + 8, usec);
    }
    return 0n;
  });

  // ── Environment ───────────────────────────────────────────────────────────
  lib.set('getenv', () => {
    // char *getenv(const char *name) — return NULL (no environment variables)
    return 0n;
  });

  // ── Memory search ─────────────────────────────────────────────────────────
  lib.set('memchr', (ctx) => {
    // void *memchr(const void *s, int c, size_t n)
    const s = Number(ctx.x(0));
    const c = Number(ctx.x(1)) & 0xff;
    const n = Number(ctx.x(2));
    const bytes = ctx.read(s, n);
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === c) return BigInt(s + i);
    }
    return 0n; // not found
  });

  // ── Dynamic linking ───────────────────────────────────────────────────────
  lib.set('dlopen', (ctx) => {
    const namePtr = Number(ctx.x(0));
    const name = namePtr === 0 ? '<self>' : readCString(ctx, namePtr);
    const key = name.length > 0 ? name : '<self>';
    let handle = dlHandles.get(key);
    if (handle === undefined) {
      handle = alloc(1);
      dlHandles.set(key, handle);
    }
    lastDlError = '';
    return BigInt(handle);
  });
  lib.set('dlsym', (ctx) => {
    const symbol = readCString(ctx, Number(ctx.x(1)));
    if (!symbol) {
      lastDlError = 'dlsym: empty symbol';
      lib.dlsymLog.push(`dlsym: (empty) → NULL`);
      return 0n;
    }
    const exported = engine.lookupSymbol(symbol);
    if (exported !== undefined) {
      lastDlError = '';
      lib.dlsymLog.push(`dlsym: ${symbol} → 0x${exported.toString(16)} (exported)`);
      return BigInt(exported);
    }
    const resolved = lib.resolveSymbol(symbol);
    if (resolved?.kind === 'data') {
      lastDlError = '';
      lib.dlsymLog.push(`dlsym: ${symbol} → 0x${resolved.address.toString(16)} (data)`);
      return BigInt(resolved.address);
    }
    const stub =
      resolved?.kind === 'function' ? engine.bindImportStub(symbol, resolved.fn) : undefined;
    if (stub !== undefined) {
      lastDlError = '';
      lib.dlsymLog.push(`dlsym: ${symbol} → stub @0x${stub.toString(16)}`);
      return BigInt(stub);
    }
    // Optional extra symbol table (caller-provided, e.g. VM handler addresses).
    const extraAddr = options.extraSymbols?.get(symbol);
    if (extraAddr !== undefined) {
      lastDlError = '';
      lib.dlsymLog.push(`dlsym: ${symbol} → 0x${extraAddr.toString(16)} (extra)`);
      return BigInt(extraAddr);
    }
    lastDlError = `dlsym: symbol not found: ${symbol}`;
    lib.dlsymLog.push(`dlsym: ${symbol} → NULL (NOT FOUND)`);
    return 0n;
  });
  lib.set('dlerror', (ctx) => writeDlError(ctx));

  // ── Generic stdio ───────────────────────────────────────────────────────

  lib.set('puts', (ctx) => {
    const text = `${readCString(ctx, Number(ctx.x(0)))}\n`;
    options.onStdout?.(text);
    return BigInt(utf8ByteLength(text));
  });
  lib.set('printf', (ctx) => {
    const text = formatGuestCString(ctx, Number(ctx.x(0)), 1);
    options.onStdout?.(text);
    return BigInt(utf8ByteLength(text));
  });
  lib.set('fprintf', (ctx) => {
    const text = formatGuestCString(ctx, Number(ctx.x(1)), 2);
    if (Number(ctx.x(0)) === 2) {
      options.onStderr?.(text);
    } else {
      options.onStdout?.(text);
    }
    return BigInt(utf8ByteLength(text));
  });
  lib.set('sprintf', (ctx) => {
    const text = formatGuestCString(ctx, Number(ctx.x(1)), 2);
    return BigInt(writeGuestCString(ctx, Number(ctx.x(0)), text));
  });
  lib.set('snprintf', (ctx) => {
    const text = formatGuestCString(ctx, Number(ctx.x(2)), 3);
    return BigInt(writeGuestCString(ctx, Number(ctx.x(0)), text, Number(ctx.x(1))));
  });
  lib.set('putchar', (ctx) => {
    // int putchar(int c) — return the char
    return ctx.x(0) & 0xffn;
  });
  lib.set('getchar', () => {
    // int getchar(void) — return EOF (-1) to signal no input
    return BigInt(-1);
  });

  // ── Math functions (IEEE 754 via Math.*) ────────────────────────────────────
  // SQLite uses these for date/time calculations. Return values as double (via
  // BigInt reinterpret_cast of the IEEE-754 bits would be correct, but for now
  // we return the integer part — enough for SQLite's time arithmetic).
  lib.set('exp', (ctx) => BigInt(Math.floor(Math.exp(Number(ctx.x(0))))));
  lib.set('pow', (ctx) => BigInt(Math.floor(Math.pow(Number(ctx.x(0)), Number(ctx.x(1))))));
  lib.set('fmod', (ctx) => BigInt(Math.floor(Number(ctx.x(0)) % Number(ctx.x(1)))));
  lib.set('sqrt', (ctx) => BigInt(Math.floor(Math.sqrt(Number(ctx.x(0))))));
  lib.set('log', (ctx) => BigInt(Math.floor(Math.log(Number(ctx.x(0))))));
  lib.set('log10', (ctx) => BigInt(Math.floor(Math.log10(Number(ctx.x(0))))));
  lib.set('log2', (ctx) => BigInt(Math.floor(Math.log2(Number(ctx.x(0))))));
  lib.set('sin', (ctx) => BigInt(Math.floor(Math.sin(Number(ctx.x(0))))));
  lib.set('cos', (ctx) => BigInt(Math.floor(Math.cos(Number(ctx.x(0))))));
  lib.set('tan', (ctx) => BigInt(Math.floor(Math.tan(Number(ctx.x(0))))));
  lib.set('asin', (ctx) => BigInt(Math.floor(Math.asin(Number(ctx.x(0))))));
  lib.set('acos', (ctx) => BigInt(Math.floor(Math.acos(Number(ctx.x(0))))));
  lib.set('atan', (ctx) => BigInt(Math.floor(Math.atan(Number(ctx.x(0))))));
  lib.set('atan2', (ctx) => BigInt(Math.floor(Math.atan2(Number(ctx.x(0)), Number(ctx.x(1))))));
  lib.set('sinh', (ctx) => BigInt(Math.floor(Math.sinh(Number(ctx.x(0))))));
  lib.set('cosh', (ctx) => BigInt(Math.floor(Math.cosh(Number(ctx.x(0))))));
  lib.set('tanh', (ctx) => BigInt(Math.floor(Math.tanh(Number(ctx.x(0))))));
  lib.set('asinh', (ctx) => BigInt(Math.floor(Math.asinh(Number(ctx.x(0))))));
  lib.set('acosh', (ctx) => BigInt(Math.floor(Math.acosh(Number(ctx.x(0))))));
  lib.set('atanh', (ctx) => BigInt(Math.floor(Math.atanh(Number(ctx.x(0))))));
  lib.set('trunc', (ctx) => BigInt(Math.trunc(Number(ctx.x(0)))));

  // ── pthread stubs (single-threaded degradation) ────────────────────────────
  // SQLite uses mutexes for thread safety. In single-threaded emulation, all
  // mutex operations succeed immediately (no contention possible).
  lib.set('pthread_mutexattr_init', () => 0n);
  lib.set('pthread_mutexattr_settype', () => 0n);
  lib.set('pthread_mutexattr_destroy', () => 0n);
  lib.set('pthread_mutex_init', () => 0n);
  lib.set('pthread_mutex_destroy', () => 0n);
  lib.set('pthread_mutex_lock', () => 0n);
  lib.set('pthread_mutex_trylock', () => 0n); // always succeeds (no other thread)
  lib.set('pthread_mutex_unlock', () => 0n);
  lib.set('pthread_create', () => BigInt(-1)); // fail: no threads in emulator
  lib.set('pthread_join', () => BigInt(-1));

  // ── String functions ──────────────────────────────────────────────────────
  lib.set('strcspn', (ctx) => {
    // size_t strcspn(const char *s, const char *reject)
    const sBytes = readGuestCStringBytes(ctx, Number(ctx.x(0)));
    const rejectBytes = readGuestCStringBytes(ctx, Number(ctx.x(1)));
    const rejectSet = new Set(rejectBytes);
    for (let i = 0; i < sBytes.length; i++) {
      if (rejectSet.has(sBytes[i]!)) return BigInt(i);
    }
    return BigInt(sBytes.length);
  });
  lib.set('strspn', (ctx) => {
    // size_t strspn(const char *s, const char *accept)
    const sBytes = readGuestCStringBytes(ctx, Number(ctx.x(0)));
    const acceptBytes = readGuestCStringBytes(ctx, Number(ctx.x(1)));
    const acceptSet = new Set(acceptBytes);
    for (let i = 0; i < sBytes.length; i++) {
      if (!acceptSet.has(sBytes[i]!)) return BigInt(i);
    }
    return BigInt(sBytes.length);
  });

  // ── File I/O stubs (minimal/fail-fast) ───────────────────────────────────
  // SQLite needs these but we don't provide a full VFS here. Most operations
  // fail with -1 (EPERM), which SQLite tolerates (falls back to in-memory mode).
  // NOTE: These wrap syscalls so they can be resolved via GOT/PLT (dynamic linking).
  lib.set('open', () => BigInt(-1)); // fail: no backing filesystem
  lib.set('close', () => 0n); // succeed (no-op)
  lib.set('read', () => 0n); // return 0 bytes read
  lib.set('write', (ctx) => BigInt(Number(ctx.x(2)))); // pretend all bytes written
  lib.set('fstat', (ctx) => {
    // int fstat(int fd, struct stat *statbuf) — zero the buffer, return success
    const statbuf = Number(ctx.x(1));
    if (statbuf !== 0) ctx.write(statbuf, new Uint8Array(128)); // sizeof(struct stat64)
    return 0n;
  });
  lib.set('mmap', (ctx) => {
    // void *mmap(void *addr, size_t length, ...) — allocate anonymous memory
    const length = Number(ctx.x(1));
    const rounded = Math.max(16, Math.ceil(length / 16) * 16);
    const ptr = alloc(rounded);
    return BigInt(ptr);
  });
  lib.set('access', () => BigInt(-1)); // fail: file not found
  lib.set('stat', () => BigInt(-1));
  lib.set('lstat', () => BigInt(-1));
  lib.set('fcntl', () => BigInt(-1));
  lib.set('pread', () => BigInt(-1));
  lib.set('pwrite', () => BigInt(-1));
  lib.set('ftruncate', () => BigInt(-1));
  lib.set('fsync', () => 0n); // succeed (no-op: nothing to flush)
  lib.set('fchmod', () => BigInt(-1));
  lib.set('fchown', () => BigInt(-1));
  lib.set('unlink', () => BigInt(-1));
  lib.set('mkdir', () => BigInt(-1));
  lib.set('rmdir', () => BigInt(-1));
  lib.set('readlink', () => BigInt(-1));
  lib.set('utimes', () => BigInt(-1));
  lib.set('getcwd', (ctx) => {
    // char *getcwd(char *buf, size_t size) — return "/" as fake cwd
    const buf = Number(ctx.x(0));
    const size = Number(ctx.x(1));
    if (buf !== 0 && size > 0) {
      writeGuestCString(ctx, buf, '/', size);
      return BigInt(buf);
    }
    return 0n; // fail if buf is NULL
  });

  // ── Time/error/misc ──────────────────────────────────────────────────────
  lib.set('nanosleep', () => 0n); // succeed immediately (no actual sleep)
  lib.set('localtime', () => {
    // struct tm *localtime(const time_t *timep) — return NULL (not implemented)
    return 0n;
  });

  // Allocate errno cell once, return same address every time
  let errnoCell: number | undefined;
  lib.set('__errno', () => {
    // int *__errno_location(void) — return a persistent errno slot
    if (errnoCell === undefined) {
      errnoCell = alloc(4);
    }
    return BigInt(errnoCell);
  });

  lib.set('dlclose', () => 0n); // succeed (no-op: handles never freed)
  lib.set('geteuid', () => FAKE_PID_UID); // same as getuid
  lib.set('mremap', () => BigInt(-1)); // fail: not implemented

  installFortifiedMemoryStubs(lib);
  installFortifiedFormatStubs(lib);
  installConversionStubs(lib);
  installFormattedOutputStubs(lib, alloc);
  installErrorStubs(lib, alloc);

  installDynamicLinkerExtensionStubs(lib);
  installThreadExtensionStubs(lib, engine);

  installStdioExtensionStubs(lib, options, alloc);

  installTimeExtensionStubs(lib);
  installProcessExtensionStubs(lib, options);

  installAlignedAllocationStubs(lib, allocAligned, PAGE_SIZE);

  installSystemExtensionStubs(lib, options);

  installStringExtensionStubs(lib);

  installAndroidAssetStubs(lib, options);

  // ── Stubs for libsgmainso unresolved imports ──

  // --- string/memory helpers ---
  lib.set('strndup', (ctx) => {
    const body = readGuestCStringBytes(ctx, Number(ctx.x(0)), Number(ctx.x(1)));
    const ptr = alloc(body.length + 1);
    const out = new Uint8Array(body.length + 1);
    out.set(body);
    ctx.write(ptr, out);
    return BigInt(ptr);
  });
  lib.set('strnlen', (ctx) => {
    const body = readGuestCStringBytes(ctx, Number(ctx.x(0)), Number(ctx.x(1)));
    return BigInt(body.length);
  });
  lib.set('strsep', (ctx) => {
    const sptr = Number(ctx.x(0));
    const delim = Number(ctx.x(1));
    if (sptr === 0) return 0n;
    const strPtrVal = Number(ctx.loadValue!(sptr, 8));
    if (strPtrVal === 0) return 0n;
    const s = readGuestCStringBytes(ctx, strPtrVal);
    const d = ctx.read(delim, 1)[0]!;
    const idx = s.indexOf(d);
    if (idx < 0) {
      ctx.storeValue!(sptr, 8, 0n);
      return BigInt(strPtrVal);
    }
    ctx.write(strPtrVal + idx, new Uint8Array([0]));
    ctx.storeValue!(sptr, 8, BigInt(strPtrVal + idx + 1));
    return BigInt(strPtrVal);
  });
  lib.set('strtok_r', (ctx) => {
    // char *strtok_r(char *str, const char *delim, char **saveptr). str=NULL
    // resumes tokenisation from *saveptr; the delimiter set is every byte of
    // the delim string. Leading delimiters are skipped; the token's trailing
    // delimiter is replaced by NUL and *saveptr advanced past it (or cleared
    // at end of string).
    const str = Number(ctx.x(0));
    const delimPtr = Number(ctx.x(1));
    const saveptr = Number(ctx.x(2));
    if (delimPtr === 0) return 0n;
    const dset = new Set(readGuestCStringBytes(ctx, delimPtr));
    let cursor = str !== 0 ? str : Number(ctx.loadValue!(saveptr, 8));
    if (cursor === 0) return 0n;
    // Skip leading delimiters.
    while (true) {
      const byte = ctx.read(cursor, 1)[0];
      if (byte === undefined || byte === 0 || !dset.has(byte)) break;
      cursor += 1;
    }
    if (ctx.read(cursor, 1)[0] === 0) {
      ctx.storeValue!(saveptr, 8, 0n);
      return 0n; // only delimiters left → no more tokens
    }
    // Find the end of the token (a delimiter or the NUL terminator).
    let end = cursor;
    while (true) {
      const byte = ctx.read(end, 1)[0];
      if (byte === undefined || byte === 0 || dset.has(byte)) break;
      end += 1;
    }
    const token = BigInt(cursor);
    if (ctx.read(end, 1)[0] === 0) {
      ctx.storeValue!(saveptr, 8, 0n);
    } else {
      ctx.write(end, new Uint8Array([0]));
      ctx.storeValue!(saveptr, 8, BigInt(end + 1));
    }
    return token;
  });
  lib.set('strcat', (ctx) => {
    const dst = Number(ctx.x(0));
    const srcBody = readGuestCStringBytes(ctx, Number(ctx.x(1)));
    const dstBody = readGuestCStringBytes(ctx, dst);
    const off = dstBody.length;
    ctx.write(dst + off, srcBody);
    ctx.write(dst + off + srcBody.length, new Uint8Array([0]));
    return BigInt(dst);
  });
  lib.set('strsignal', (ctx) => {
    const msg = `Signal ${Number(ctx.x(0))}`;
    const ptr = alloc(msg.length + 1);
    ctx.write(ptr, new TextEncoder().encode(msg + '\0'));
    return BigInt(ptr);
  });

  // --- ctype predicates (C semantics; arg is an int masked to unsigned char,
  //     matching the isalpha/isdigit family in install-libc-extensions) ---
  lib.set('iscntrl', (ctx) => {
    const value = Number(ctx.x(0) & 0xffn);
    return value < 0x20 || value === 0x7f ? 1n : 0n;
  });
  lib.set('isgraph', (ctx) => {
    const value = Number(ctx.x(0) & 0xffn);
    return value >= 0x21 && value <= 0x7e ? 1n : 0n;
  });
  lib.set('isprint', (ctx) => {
    const value = Number(ctx.x(0) & 0xffn);
    return value >= 0x20 && value <= 0x7e ? 1n : 0n;
  });
  lib.set('ispunct', (ctx) => {
    const value = Number(ctx.x(0) & 0xffn);
    const alnum =
      (value >= 0x30 && value <= 0x39) ||
      (value >= 0x41 && value <= 0x5a) ||
      (value >= 0x61 && value <= 0x7a);
    return value >= 0x21 && value <= 0x7e && !alnum ? 1n : 0n;
  });

  // --- stdlib math/conv ---
  lib.set('abs', (ctx) => {
    const v = Number(ctx.x(0));
    return BigInt(v < 0 ? -v : v);
  });
  lib.set('labs', (ctx) => {
    const v = Number(ctx.x(0));
    return BigInt(v < 0n ? -v : v);
  });
  lib.set('div', (ctx) => {
    const num = Number(ctx.x(0));
    const den = Number(ctx.x(1));
    const ptr = alloc(8);
    // C div_t truncates toward zero; `num / den` can be fractional (7/2=3.5)
    // and BigInt() would throw RangeError on it.
    ctx.storeValue!(ptr, 4, BigInt(Math.trunc(num / den)));
    ctx.storeValue!(ptr + 4, 4, BigInt(num % den));
    return BigInt(ptr);
  });
  lib.set('ldiv', (ctx) => {
    const num = Number(ctx.x(0));
    const den = Number(ctx.x(1));
    const ptr = alloc(16);
    ctx.storeValue!(ptr, 8, BigInt(Math.trunc(num / den)));
    ctx.storeValue!(ptr + 8, 8, BigInt(num % den));
    return BigInt(ptr);
  });
  lib.set('atof', () => 0n);
  lib.set('atoll', (ctx) => {
    const s = readGuestCStringBytes(ctx, Number(ctx.x(0)));
    const txt = new TextDecoder().decode(s);
    return BigInt(parseInt(txt, 10) || 0);
  });
  lib.set('strtoul', (ctx) => {
    const s = readGuestCStringBytes(ctx, Number(ctx.x(0)));
    return BigInt(parseInt(new TextDecoder().decode(s), 10) || 0);
  });
  lib.set('strtoull', (ctx) => {
    const s = readGuestCStringBytes(ctx, Number(ctx.x(0)));
    return BigInt(parseInt(new TextDecoder().decode(s), 10) || 0);
  });
  lib.set('sscanf', () => 0n);
  lib.set('fscanf', () => 0n);
  lib.set('crc32', () => 0n);

  // --- posix I/O (fail gracefully) ---
  for (const name of ['fgetpos', 'fsetpos', 'setvbuf', 'setbuf']) {
    lib.set(name, () => 0n);
  }
  for (const name of ['getc', 'putc', 'ungetc', 'ferror']) {
    lib.set(name, () => BigInt(-1)); // EOF
  }
  lib.set('remove', () => BigInt(-1));
  lib.set('rename', () => BigInt(-1));
  lib.set('popen', () => 0n); // NULL
  lib.set('pclose', () => BigInt(-1));
  lib.set('freopen', () => 0n);
  lib.set('chmod', () => 0n);
  lib.set('closedir', () => BigInt(-1));
  lib.set('opendir', () => 0n);
  lib.set('readdir', () => 0n);

  // --- time ---
  for (const name of ['mktime', 'asctime', 'ctime', 'gmtime_r', 'strftime']) {
    lib.set(name, () => 0n);
  }

  // --- network (fail gracefully) ---
  for (const name of [
    'socket',
    'bind',
    'accept',
    'connect',
    'send',
    'recv',
    'sendto',
    'recvfrom',
  ]) {
    lib.set(name, () => BigInt(-1));
  }
  lib.set('inet_aton', () => 0n);

  // --- threading / sync ---
  for (const name of [
    'sem_init',
    'sem_wait',
    'sem_post',
    'sem_destroy',
    'pthread_rwlock_init',
    'pthread_rwlock_rdlock',
    'pthread_rwlock_wrlock',
    'pthread_rwlock_unlock',
    'pthread_rwlock_destroy',
    'pthread_sigmask',
    'sigemptyset',
    'sigaddset',
    'sigaltstack',
  ]) {
    lib.set(name, () => 0n);
  }
  lib.set('pthread_setname_np', () => 0n);
  lib.set('pthread_exit', () => {
    throw new Error('bionic: pthread_exit called');
  });

  // --- zlib (fail gracefully) ---
  for (const name of [
    'deflate',
    'deflateInit_',
    'deflateInit2_',
    'deflateEnd',
    'deflateBound',
    'inflate',
    'inflateInit_',
    'inflateInit2_',
    'inflateEnd',
  ]) {
    lib.set(name, () => BigInt(-2)); // Z_STREAM_ERROR
  }

  // --- random ---
  let rand48State = 1n;
  lib.set('srand48', (ctx) => {
    rand48State = BigInt(ctx.x(0));
    return undefined;
  });
  lib.set('lrand48', () => {
    rand48State = (rand48State * 25214903917n + 11n) & 0xffffffffffffn;
    return BigInt(Number(rand48State >> 16n));
  });
  lib.set('srand', () => undefined);
  lib.set('rand', () => BigInt(Math.floor(Math.random() * 2147483647)));
  lib.set('srandom', () => undefined);
  lib.set('random', () => BigInt(Math.floor(Math.random() * 2147483647)));

  // --- stack guard ---
  lib.set('__stack_chk_guard', () => 0xdeadbeefcafebaben);

  return lib;
}

const BIONIC_SYMBOL_PROBE: BionicMemoryMapper = {
  mapMemory: () => undefined,
  lookupSymbol: () => undefined,
  bindImportStub: () => 1,
  callGuestFunction: () => 0,
};
const BIONIC_SYMBOL_PROBE_LIBRARY = createBionicLibrary(BIONIC_SYMBOL_PROBE);
const SUPPORTED_BIONIC_SYMBOLS = new Set([
  ...BIONIC_SYMBOL_PROBE_LIBRARY.keys(),
  ...BIONIC_SYMBOL_PROBE_LIBRARY.dataSymbols.keys(),
]);

/** True when the built-in bionic library can auto-wire this import. */
export function hasBionicSymbol(symbol: string): boolean {
  return SUPPORTED_BIONIC_SYMBOLS.has(symbol);
}

export function installBionicStubs(
  engine: CpuEngine,
  addrs: BionicStubAddresses,
  heapBase = HEAP_BASE,
): void {
  if (addrs.strlen !== undefined) {
    engine.registerHostFunction(addrs.strlen, stubStrlen);
  }

  if (addrs.memcpy !== undefined) {
    engine.registerHostFunction(addrs.memcpy, stubMemcpy);
  }

  if (addrs.memset !== undefined) {
    engine.registerHostFunction(addrs.memset, stubMemset);
  }

  if (addrs.malloc !== undefined || addrs.free !== undefined) {
    const allocator = createBumpAllocator(engine, heapBase);
    if (addrs.malloc !== undefined) {
      engine.registerHostFunction(addrs.malloc, allocator.malloc);
    }
    if (addrs.free !== undefined) {
      engine.registerHostFunction(addrs.free, allocator.free);
    }
  }
}

function compareCStringBytes(left: Uint8Array, right: Uint8Array, maxBytes: number): number {
  for (let i = 0; i < maxBytes; i++) {
    const a = i < left.length ? left[i]! : 0;
    const b = i < right.length ? right[i]! : 0;
    if (a !== b) return a < b ? -1 : 1;
    if (a === 0) return 0;
  }
  return 0;
}
