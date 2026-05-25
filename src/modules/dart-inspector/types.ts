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
}

/** Serializable rule form accepted via MCP tool input. */
export interface CategoryRuleInput {
  category: CategoryKey;
  pattern: string;
  flags?: string;
  exclude?: string;
  excludeFlags?: string;
}

export type RuleMode = 'append' | 'prepend' | 'replace';

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
}
