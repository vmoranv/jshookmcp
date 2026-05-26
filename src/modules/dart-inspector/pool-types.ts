/**
 * Type definitions for the dart-inspector ObjectPool dumper.
 *
 * The shapes here mirror Dart's public ObjectPool layout as described
 * in Phrack #71 (Aug 2024). The dumper is intentionally read-only:
 * no APK mutation, no payload, no dynamic injection, no Dart VM init.
 *
 * @see openspec/changes/add-dart-object-pool-dump/design.md §2.2
 */

import type { VersionFingerprint } from './snapshot-types';

/** Classification of a single ObjectPool slot. */
export type ObjectPoolSlotKind =
  | 'smi'
  | 'mint'
  | 'double'
  | 'string'
  | 'classRef'
  | 'functionRef'
  | 'pool'
  | 'null'
  | 'unknown';

/** Confidence level reported for each slot classification. */
export type ObjectPoolSlotConfidence = 'high' | 'medium' | 'low';

/** Decoded ObjectPool slot. */
export interface ObjectPoolSlot {
  /** 0-based slot index within the pool. */
  slotIndex: number;
  /** Absolute byte offset in the source file where the slot word lives. */
  fileOffset: number;
  kind: ObjectPoolSlotKind;
  /** Truncated value preview (strings: first N bytes; numerics: stringified value). */
  preview?: string;
  /** Class ID resolved from the pointer target (when known). */
  cid?: number;
  /** Original word as little-endian hex, present whenever `kind === 'unknown'`. */
  rawBytes?: string;
  confidence: ObjectPoolSlotConfidence;
}

/** Options accepted by {@link ObjectPoolDumper.dump}. */
export interface DumpOptions {
  /**
   * Pre-supplied fingerprint. When set the dumper MUST NOT re-run
   * {@link SnapshotFingerprint}; it uses the supplied SDK family for
   * grammar selection.
   */
  fingerprint?: VersionFingerprint;
  /** Upper bound on emitted slots. Defaults to `DART_PP_MAX_SLOTS`. */
  maxSlots?: number;
  /** Byte cap for string slot previews. Defaults to `DART_PP_PREVIEW_BYTES`. */
  previewBytes?: number;
  /** Force a specific grammar by `sdkFamily`. */
  grammar?: string;
}

/** Final result returned by {@link ObjectPoolDumper.dump}. */
export interface DumpResult {
  pool: {
    /** Absolute byte offset of the pool header. `-1` when not located. */
    fileOffset: number;
    /** Number of slots actually emitted (≤ maxSlots). */
    slotCount: number;
    /** Pointer width used during decode (4 or 8). `0` when unmatched. */
    pointerSize: 0 | 4 | 8;
  };
  grammar: {
    /** SDK family name (`'unknown'` when no built-in matched). */
    sdkFamily: string;
    /** True when a built-in grammar matched (or `grammar` override succeeded). */
    matched: boolean;
  };
  slots: ObjectPoolSlot[];
  /** True when `maxSlots` cut the scan short. */
  truncated: boolean;
  /** Count of `kind === 'unknown'` entries inside `slots`. */
  unknownSlotCount: number;
}
