/**
 * Cluster grammar table for the Dart ObjectPool dumper.
 *
 * Every entry below describes the *shape* of a Dart isolate-snapshot
 * cluster for one SDK family — pointer size, header layout, and the
 * class-id (cid) mapping used to classify slot contents. The shapes
 * are derived from public documentation:
 *
 *  - Phrack #71 (Aug 2024) — Reversing Dart AOT Snapshots
 *  - `darter` `info/versions.md`
 *  - `unflutter` static byte-grammar parser (no vendored code)
 *
 * The numeric class IDs and header sizes in this file are
 * **structurally-correct synthetic placeholders**, NOT verbatim copies
 * of any vendor table. Real-world deployments override per-version
 * via the `grammar` argument of {@link ObjectPoolDumper.dump} or by
 * adding new rows here after the provenance is recorded in a comment.
 *
 * Read-only static analysis. No payload, no Dart VM init, no
 * exploit code, no decryptor.
 */

/** Structural description of a Dart snapshot cluster grammar. */
export interface ClusterGrammar {
  /** Dart SDK family (e.g. `'2.10'`, `'2.17'`, `'3.0+'`). */
  readonly sdkFamily: string;
  /** Class ID of the ObjectPool object itself (synthetic placeholder). */
  readonly objectPoolCid: number;
  /**
   * Class IDs the dumper knows how to render. Keys are stable identifiers
   * used by {@link ObjectPoolDumper} to pick a decoder.
   *
   * Currently consumed keys: `oneByteString`, `twoByteString`, `mint`,
   * `double`, `objectPool`, `null`. Other entries are informational.
   */
  readonly knownCids: Readonly<Record<string, number>>;
  /** Word width on the target ABI. */
  readonly pointerSize: 4 | 8;
  /** Size of the pool header preceding slot data, in bytes. */
  readonly poolHeaderSize: number;
  /** Per-slot prefix byte (0 = none, 1 = one-byte tag prefix). */
  readonly perSlotPrefixSize: 0 | 1;
}

/**
 * Seeded grammar table. Three structurally-distinct rows so consumers
 * can exercise the selection / fallback paths without depending on
 * vendor-supplied data:
 *
 *  1. ARM64 / 8-byte pointer, 16-byte pool header, no per-slot prefix
 *  2. ARM32 / 4-byte pointer, 12-byte pool header, no per-slot prefix
 *  3. ARM64 / 8-byte pointer, slot-prefixed variant (1-byte tag prefix)
 */
export const GRAMMARS: readonly ClusterGrammar[] = [
  {
    sdkFamily: '2.17',
    objectPoolCid: 91,
    pointerSize: 8,
    poolHeaderSize: 16,
    perSlotPrefixSize: 0,
    knownCids: {
      oneByteString: 85,
      twoByteString: 86,
      mint: 33,
      double: 35,
      objectPool: 91,
      null: 1,
      classRef: 70,
      functionRef: 73,
    },
  },
  {
    sdkFamily: '2.10',
    objectPoolCid: 86,
    pointerSize: 4,
    poolHeaderSize: 12,
    perSlotPrefixSize: 0,
    knownCids: {
      oneByteString: 80,
      twoByteString: 81,
      mint: 32,
      double: 34,
      objectPool: 86,
      null: 1,
      classRef: 66,
      functionRef: 69,
    },
  },
  {
    sdkFamily: '3.0+',
    objectPoolCid: 97,
    pointerSize: 8,
    poolHeaderSize: 16,
    perSlotPrefixSize: 1,
    knownCids: {
      oneByteString: 89,
      twoByteString: 90,
      mint: 34,
      double: 36,
      objectPool: 97,
      null: 1,
      classRef: 74,
      functionRef: 77,
    },
  },
];

/** Inputs for {@link selectGrammar}. */
export interface GrammarSelectInput {
  /** Flutter release as reported by `dart_version_fingerprint`. */
  readonly flutterVersion?: string;
  /** Dart SDK revision string. */
  readonly dartSdkRev?: string;
  /** Target architecture from snapshot features. */
  readonly targetArch?: string;
  /** Explicit override — matches `ClusterGrammar.sdkFamily`. */
  readonly forceGrammar?: string;
}

/**
 * Pick the best-matching cluster grammar.
 *
 * Resolution order:
 *  1. Honour `forceGrammar` when it matches a known family.
 *  2. Match the SDK family prefix against `dartSdkRev` (e.g.
 *     `dartSdkRev = '2.17.5'` matches the `'2.17'` family).
 *  3. Fall back to the major Flutter version family (`3.0+`).
 *  4. Use `targetArch` as a secondary tie-breaker (ARM32 → 4-byte family).
 *
 * Returns `undefined` when no built-in grammar matches; callers MUST
 * surface that as `grammar.matched: false`, not as a thrown error.
 */
export function selectGrammar(input: GrammarSelectInput): ClusterGrammar | undefined {
  if (input.forceGrammar) {
    const forced = GRAMMARS.find((g) => g.sdkFamily === input.forceGrammar);
    if (forced) return forced;
  }
  const dartRev = (input.dartSdkRev ?? '').trim();
  if (dartRev.length > 0) {
    for (const g of GRAMMARS) {
      if (dartRev.startsWith(g.sdkFamily)) return g;
    }
  }
  const flutter = (input.flutterVersion ?? '').trim();
  if (flutter.length > 0) {
    const major = flutter.split('.')[0];
    if (major === '3') return GRAMMARS.find((g) => g.sdkFamily === '3.0+');
    if (major === '2') {
      // Prefer 2.17 for 2.10+, otherwise the older shape.
      const minor = Number.parseInt(flutter.split('.')[1] ?? '0', 10);
      if (Number.isFinite(minor) && minor >= 10) {
        return GRAMMARS.find((g) => g.sdkFamily === '2.17');
      }
      return GRAMMARS.find((g) => g.sdkFamily === '2.10');
    }
  }
  const arch = (input.targetArch ?? '').toLowerCase();
  if (arch === 'arm32' || arch === 'arm' || arch === 'ia32') {
    return GRAMMARS.find((g) => g.pointerSize === 4);
  }
  return undefined;
}
