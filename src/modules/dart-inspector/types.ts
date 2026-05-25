/**
 * Type definitions for the dart-inspector module.
 *
 * @see openspec/changes/add-dart-strings-extract/design.md §3.1
 */

/** Default categories produced by DEFAULT_RULES. Custom rules can introduce new keys. */
export type DefaultCategory = 'urls' | 'paths' | 'classNames' | 'packageRefs' | 'cryptoKeywords';

export type CategoryKey = DefaultCategory | string;

/** A single extracted string with byte offsets of every occurrence. */
export interface ExtractedString {
  value: string;
  /** Byte offsets in the source file, sorted ascending. */
  offsets: number[];
  /** True when offsets[] was capped at MAX_OFFSETS_PER_STRING. */
  truncated?: boolean;
  /** Encoding the string was discovered in. */
  encoding: 'ascii' | 'utf16le';
  /**
   * Confidence weight in `[0, 1]` carried over from the matching rule.
   * Omitted when the matching rule had no `confidence` (i.e. default = 1).
   */
  confidence?: number;
}

/**
 * Final result: category name → array of extracted strings.
 *
 * Categories appear as empty arrays when no string matched (consumers should
 * never need to check `undefined`). The optional `raw` field is only present
 * when `includeRaw: true` was set.
 */
export type ExtractedStrings = Record<CategoryKey, ExtractedString[]> & {
  raw?: ExtractedString[];
};

/** Compiled regex rule used internally by the classifier. */
export interface CategoryRule {
  category: CategoryKey;
  pattern: RegExp;
  exclude?: RegExp;
  /**
   * Confidence weight in `[0, 1]`. Defaults to undefined (treated as 1).
   * When set, every matching {@link ExtractedString} carries this value
   * so downstream consumers can rank low-confidence hits.
   */
  confidence?: number;
  /**
   * Conditional rule activation. When set, the rule only contributes to
   * classification if the source filename matches `fileNameMatches`.
   * The match is run on `path.basename(filePath)`, not the full path,
   * so users can target by lib name (`/libapp\.so$/`) regardless of
   * directory depth.
   */
  enableWhen?: {
    fileNameMatches?: RegExp;
  };
}

/** Serializable rule form accepted via MCP tool input. */
export interface CategoryRuleInput {
  category: CategoryKey;
  pattern: string;
  flags?: string;
  exclude?: string;
  excludeFlags?: string;
  /** See {@link CategoryRule.confidence}. Must be in `[0, 1]` if set. */
  confidence?: number;
  /** Compiled into {@link CategoryRule.enableWhen.fileNameMatches}. */
  enableWhenFileNameMatches?: string;
  /** Flags for {@link enableWhenFileNameMatches}. Must satisfy `DART_ALLOWED_REGEX_FLAGS`. */
  enableWhenFileNameFlags?: string;
}

export type RuleMode = 'append' | 'prepend' | 'replace';

/** Byte range to restrict the scanner to. Both ends are optional and 0-based. */
export interface ScanWindow {
  /** Inclusive start offset in bytes. Hits before this are dropped. */
  start?: number;
  /** Exclusive end offset in bytes. Hits at or after this are dropped. */
  end?: number;
}

/** Options for StringsExtractor.extractFromFile. */
export interface ExtractOptions {
  minLength?: number;
  includeRaw?: boolean;
  includeOffsets?: boolean;
  encoding?: 'ascii' | 'utf16le' | 'both';
  maxChunkBytes?: number;
  customRules?: CategoryRule[];
  ruleMode?: RuleMode;
  maxOffsetsPerString?: number;
  /**
   * Per-`.test()` budget enforced by the post-hoc ReDoS guard
   * (see {@link classifyOne}). Defaults to `DART_REGEX_TIMEOUT_MS`.
   * Tests that exercise the guard set this explicitly to a small value.
   */
  regexTimeoutMs?: number;
  /**
   * Restrict scanning to a byte range. Useful for skipping ELF headers
   * (`{ start: 0x40 }`) or focusing on a known data section.
   */
  scanWindow?: ScanWindow;
  /**
   * Only emit hits whose offset is divisible by `scanStride`. Set to 4 or 8
   * for pointer-aligned scans on AOT snapshots where Dart strings tend to
   * sit on word boundaries. Defaults to 1 (no stride filtering).
   */
  scanStride?: number;
}
