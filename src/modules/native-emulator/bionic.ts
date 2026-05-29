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

/** Bump-allocator heap base — distinct from typical code/data vaddrs. */
const HEAP_BASE = 0x100000;
/** Allocation granularity (bytes); keeps returned pointers naturally aligned. */
const HEAP_ALIGN = 16;

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
