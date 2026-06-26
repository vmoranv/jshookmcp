/**
 * Random-walk address-space traversal.
 *
 * Replaces linear VQE chains with pseudo-random strides, inter-call jitter,
 * variable chunk sizes, and periodic dummy queries to avoid bulk-scanner
 * fingerprinting.
 */

// ── Per-scan configuration (pass to `createScanWalker`) ──────────────────────

export interface ScanObfuscationConfig {
  /** Nominal stride between VQE calls in pages (default 64 = 256KB on x64).
   *  Actual stride is nominal ± random jitter. */
  stridePages: number;
  /** Maximum random jitter in pages added/subtracted from the stride. */
  jitterPages: number;
  /** Delay between VQE calls in µs (default 10). */
  interQueryDelayUs: number;
  /** Random jitter ± in µs added to the inter-query delay. */
  interQueryJitterUs: number;
  /** Minimum chunk size for read operations in bytes. */
  minChunkBytes: number;
  /** Maximum chunk size for read operations in bytes. */
  maxChunkBytes: number;
  /** Number of dummy VQE calls interleaved per 100 real queries. */
  dummyQueryRate: number;
}

export const DEFAULT_OBFUSCATION_CONFIG: ScanObfuscationConfig = {
  stridePages: 64,
  jitterPages: 32,
  interQueryDelayUs: 10,
  interQueryJitterUs: 20,
  minChunkBytes: 4 * 1024 * 1024,
  maxChunkBytes: 32 * 1024 * 1024,
  dummyQueryRate: 3, // 3 dummy queries per 100 real
};

// ── Simple Xorshift PRNG (deterministic, seedable, no crypto needed) ─────────

class XorShift32 {
  private state: number;
  constructor(seed: number) {
    this.state = seed | 0;
  }
  /** Returns a pseudo-random integer in [0, 2^32). */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x;
    return x >>> 0;
  }
  /** Returns a pseudo-random integer in [0, max). */
  nextInt(max: number): number {
    return this.next() % (max >>> 0);
  }
  /** Returns a pseudo-random integer in [min, max]. */
  range(min: number, max: number): number {
    return min + this.nextInt(max - min + 1);
  }
}

// ── Walk helpers ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 0x1000n;
const USER_MODE_MAX = 0x7fffffffffffn;

export interface ScanWalker {
  /** Advance the scanner to the next region to query (returns false when done). */
  next(): boolean;
  /** Current base address for VQE. */
  readonly address: bigint;
  /** Current chunk size for ReadProcessMemory (randomised). */
  readonly chunkSize: number;
  /** User-mode address ceiling. */
  readonly maxAddress: bigint;
  /** Pause for inter-query jitter (call between VQE calls). */
  delay(): Promise<void>;
  /** Called every N queries — injects dummy VQE calls. */
  shouldInterleaveDummy(): boolean;
}

export function createScanWalker(
  config: ScanObfuscationConfig = DEFAULT_OBFUSCATION_CONFIG,
  seed?: number,
): ScanWalker {
  const prng = new XorShift32(seed ?? Math.trunc(Math.random() * 0x7fffffff));
  let address = 0n;
  let queryCount = 0;

  return {
    get address(): bigint {
      return address;
    },
    get maxAddress(): bigint {
      return USER_MODE_MAX;
    },
    get chunkSize(): number {
      return prng.range(config.minChunkBytes, config.maxChunkBytes);
    },

    next(): boolean {
      if (address >= USER_MODE_MAX) return false;
      const stride = config.stridePages + prng.range(-config.jitterPages, config.jitterPages);
      address += BigInt(Math.max(1, stride)) * PAGE_SIZE;
      if (address >= USER_MODE_MAX) address = USER_MODE_MAX;
      queryCount += 1;
      return true;
    },

    async delay(): Promise<void> {
      const us = config.interQueryDelayUs + prng.nextInt(config.interQueryJitterUs);
      if (us > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, Math.ceil(us / 1000)));
      }
    },

    shouldInterleaveDummy(): boolean {
      return prng.nextInt(100) < config.dummyQueryRate;
    },
  };
}
