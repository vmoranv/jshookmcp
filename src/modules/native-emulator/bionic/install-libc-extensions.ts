import type { HostContext, HostFunction } from '../host-context';
import {
  readGuestCString,
  readGuestCStringBytes,
  utf8ByteLength,
  writeGuestCString,
} from '../c-strings';
import { writeGuestPointer } from '../guest-memory';
import type { BionicLibrary } from './library';
import type { BionicAlignedAllocator, BionicAllocator } from './types';

export function installFortifiedMemoryStubs(lib: BionicLibrary): void {
  aliasHandler(lib, '__strlen_chk', 'strlen');
  aliasHandler(lib, '__memmove_chk', 'memmove');
  aliasHandler(lib, '__memcpy_chk', 'memcpy');
  aliasHandler(lib, '__memset_chk', 'memset');
}

function parseInteger(text: string, base: number): bigint {
  const parsed = Number.parseInt(text, base);
  // parseInt returns NaN for non-numeric input; BigInt(NaN) would throw and
  // abort the emulator (C returns 0 for unparseable strings).
  return Number.isFinite(parsed) ? BigInt(parsed) : 0n;
}

export function installConversionStubs(lib: BionicLibrary): void {
  for (const name of ['atoi', 'atol', 'atoll']) {
    lib.set(name, (ctx) => parseInteger(readGuestCString(ctx, Number(ctx.x(0))), 10));
  }
  for (const name of ['strtol', 'strtoll']) {
    lib.set(name, (ctx) => {
      const text = readGuestCString(ctx, Number(ctx.x(0)));
      // strtol/strtoll take the radix in x2; 0 means auto-detect (0x/0 prefixes).
      const rawBase = Number(ctx.x(2));
      const base = rawBase === 0 || (rawBase >= 2 && rawBase <= 36) ? rawBase : 10;
      return parseInteger(text, base === 0 ? 0 : base);
    });
  }
  lib.set('strtod', (ctx) => {
    const parsed = Number.parseFloat(readGuestCString(ctx, Number(ctx.x(0))));
    ctx.setD(0, Number.isNaN(parsed) ? 0 : parsed);
  });

  lib.set('islower', (ctx) => inRange(ctx.x(0), 0x61, 0x7a));
  lib.set('isupper', (ctx) => inRange(ctx.x(0), 0x41, 0x5a));
  lib.set('isalpha', (ctx) => (inEitherRange(ctx.x(0), [0x41, 0x5a], [0x61, 0x7a]) ? 1n : 0n));
  lib.set('isdigit', (ctx) => inRange(ctx.x(0), 0x30, 0x39));
  lib.set('isxdigit', (ctx) => {
    const value = byteValue(ctx.x(0));
    return value >= 0x30 && value <= 0x39
      ? 1n
      : value >= 0x41 && value <= 0x46
        ? 1n
        : value >= 0x61 && value <= 0x66
          ? 1n
          : 0n;
  });
  lib.set('isalnum', (ctx) => {
    const value = byteValue(ctx.x(0));
    return value >= 0x30 && value <= 0x39
      ? 1n
      : inEitherRange(BigInt(value), [0x41, 0x5a], [0x61, 0x7a])
        ? 1n
        : 0n;
  });
  lib.set('isspace', (ctx) => {
    const value = byteValue(ctx.x(0));
    return value === 0x20 || value === 0x09 || value === 0x0a || value === 0x0d ? 1n : 0n;
  });
  lib.set('tolower', (ctx) => {
    const value = byteValue(ctx.x(0));
    return BigInt(value >= 0x41 && value <= 0x5a ? value + 0x20 : value);
  });
  lib.set('toupper', (ctx) => {
    const value = byteValue(ctx.x(0));
    return BigInt(value >= 0x61 && value <= 0x7a ? value - 0x20 : value);
  });
}

export function installErrorStubs(lib: BionicLibrary, alloc: BionicAllocator): void {
  lib.set('strerror', (ctx) => {
    const message = `errno ${Number(ctx.x(0))}`;
    const pointer = alloc(utf8ByteLength(message) + 1);
    writeGuestCString(ctx, pointer, message);
    return BigInt(pointer);
  });
  lib.set('strerror_r', (ctx) => {
    const buffer = Number(ctx.x(1));
    const length = Number(ctx.x(2));
    if (buffer !== 0 && length > 0) {
      writeGuestCString(ctx, buffer, `errno ${Number(ctx.x(0))}`, length);
    }
    return 0n;
  });
  lib.set('perror', () => undefined);
}

export function installAlignedAllocationStubs(
  lib: BionicLibrary,
  allocAligned: BionicAlignedAllocator,
  pageSize: number,
): void {
  lib.set('posix_memalign', (ctx) => {
    const alignment = Number(ctx.x(1));
    if (alignment < 8 || !isPowerOfTwo(alignment)) return 22n;
    const pointer = allocAligned(Number(ctx.x(2)), alignment);
    if (ctx.x(0) !== 0n) writeGuestPointer(ctx, Number(ctx.x(0)), pointer);
    return 0n;
  });
  lib.set('memalign', (ctx) => {
    const alignment = Number(ctx.x(0));
    return isPowerOfTwo(alignment) ? BigInt(allocAligned(Number(ctx.x(1)), alignment)) : 0n;
  });
  lib.set('valloc', (ctx) => BigInt(allocAligned(Number(ctx.x(0)), pageSize)));
}

export function installStringExtensionStubs(lib: BionicLibrary): void {
  lib.set('strcasestr', () => 0n);
  lib.set('strstr', (ctx) => {
    const haystack = readGuestCString(ctx, Number(ctx.x(0)));
    const needle = readGuestCString(ctx, Number(ctx.x(1)));
    if (!needle) return ctx.x(0);
    const index = haystack.indexOf(needle);
    return index >= 0 ? BigInt(Number(ctx.x(0)) + index) : 0n;
  });
  lib.set('strncat', (ctx) => {
    const destination = Number(ctx.x(0));
    const destinationLength = readGuestCStringBytes(ctx, destination).length;
    const source = readGuestCStringBytes(ctx, Number(ctx.x(1)), Number(ctx.x(2)));
    const appended = new Uint8Array(source.length + 1);
    appended.set(source);
    ctx.write(destination + destinationLength, appended);
    return ctx.x(0);
  });
  lib.set('strtok', () => 0n);
  lib.set('strpbrk', () => 0n);
  lib.set('bcopy', (ctx) => {
    const copy = Uint8Array.from(ctx.read(Number(ctx.x(0)), Number(ctx.x(2))));
    ctx.write(Number(ctx.x(1)), copy);
  });
  lib.set('bzero', (ctx) => {
    ctx.write(Number(ctx.x(0)), new Uint8Array(Number(ctx.x(1))));
  });
  lib.set('bcmp', (ctx) => compareBytes(ctx, Number(ctx.x(0)), Number(ctx.x(1)), Number(ctx.x(2))));
}

function aliasHandler(lib: BionicLibrary, alias: string, target: string): void {
  const handler = requireHandler(lib, target);
  lib.set(alias, handler);
}

function requireHandler(lib: BionicLibrary, name: string): HostFunction {
  const handler = lib.get(name);
  if (!handler) throw new Error(`Missing bionic handler required by installer: ${name}`);
  return handler;
}

function compareBytes(ctx: HostContext, left: number, right: number, length: number): bigint {
  const a = ctx.read(left, length);
  const b = ctx.read(right, length);
  for (let index = 0; index < a.length; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return BigInt(difference);
  }
  return 0n;
}

function byteValue(value: bigint): number {
  return Number(value & 0xffn);
}

function inRange(value: bigint, min: number, max: number): bigint {
  const byte = byteValue(value);
  return byte >= min && byte <= max ? 1n : 0n;
}

function inEitherRange(
  value: bigint,
  first: readonly [number, number],
  second: readonly [number, number],
): boolean {
  const byte = byteValue(value);
  return (byte >= first[0] && byte <= first[1]) || (byte >= second[0] && byte <= second[1]);
}

function isPowerOfTwo(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && (value & (value - 1)) === 0;
}
