import { readEnvNullableString } from '../../config/environment';

/**
 * Query normalization and preprocessing for tool search.
 * Handles stop-word removal, parameter token extraction, and short description extraction.
 */

/**
 * Stop words to filter from parameter descriptions.
 * These common words add noise without improving search relevance.
 */
const PARAM_DESCRIPTION_STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'or',
  'and',
  'not',
  'this',
  'that',
  'it',
  'its',
  'if',
  'as',
  'will',
  'can',
  'may',
  'must',
  'should',
  'would',
  'could',
  'e',
  'g',
  'default',
  'optional',
  'required',
  'when',
  'set',
]);

/**
 * Standard English stop words to filter out during query processing
 * and document description indexing.
 */
const ENGLISH_STOP_WORDS = new Set<string>([
  'a',
  'about',
  'above',
  'after',
  'again',
  'against',
  'all',
  'am',
  'an',
  'and',
  'any',
  'are',
  'aren',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'cannot',
  'could',
  'couldn',
  'did',
  'didn',
  'do',
  'does',
  'doesn',
  'doing',
  'don',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'had',
  'hadn',
  'has',
  'hasn',
  'have',
  'haven',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'herself',
  'him',
  'himself',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'isn',
  'it',
  'its',
  'itself',
  'just',
  'me',
  'more',
  'most',
  'my',
  'myself',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'ourselves',
  'out',
  'over',
  'own',
  'same',
  'she',
  'should',
  'shouldn',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'themselves',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'very',
  'was',
  'wasn',
  'we',
  'were',
  'weren',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'with',
  'would',
  'wouldn',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves',
]);

/**
 * Stem experiment mode for the retrieval scene-rank campaign
 * (.ccg/tasks/retrieval-scene-rank-fix). Read lazily so tests and the scan
 * harness (scripts/search-tune/stem-scan.ts) can switch variants in-process:
 *   off            — no stemming anywhere (pre-campaign baseline)
 *   verb           — verb-inflection fold in rerank + tokenSet/drift
 *                    (PRODUCTION DEFAULT — see DEFAULT_STEM_MODE)
 *   plural         — verb fold + plural fold, all wiring (measured harmful)
 *   rerank-verb    — verb fold in the rerank tokenizer only
 *   rerank-plural  — verb+plural fold in the rerank tokenizer only
 *   tokenset-verb  — verb fold in engine tokenSet/drift only
 *   tokenset-plural — verb+plural fold in engine tokenSet/drift only
 */
export type StemMode =
  | 'off'
  | 'verb'
  | 'plural'
  | 'rerank-verb'
  | 'rerank-plural'
  | 'tokenset-verb'
  | 'tokenset-plural';

const VALID_STEM_MODES: ReadonlySet<string> = new Set([
  'off',
  'verb',
  'plural',
  'rerank-verb',
  'rerank-plural',
  'tokenset-verb',
  'tokenset-plural',
]);

/**
 * Production default 'verb': verb-inflection folding in both wiring paths,
 * NO plural folding. Chosen by the dual-corpus scan
 * (scripts/search-tune/stem-scan.ts, 2026-11-14): it repairs 4 permanently
 * un-retrievable tools (captcha_config 0→33%, debugger_run_to_location
 * 0→16%, process_get/process_suspend 0→3/7% in lexical mode) for a -0.31pp
 * aggregate MRR@10 cost on the 736-tool corpus (9 drifted cases better vs 4
 * worse). Plural folding was measured harmful through the term-drift path
 * (-1.37pp aggregate, 21 worse) and is available only behind the env
 * override for future re-scans.
 */
const DEFAULT_STEM_MODE: StemMode = 'verb';

/** Read lazily so a single process (the scan harness, tests) can switch variants. */
function currentStemMode(): StemMode {
  const raw = readEnvNullableString('SEARCH_STEM_MODE', { trim: true }) ?? DEFAULT_STEM_MODE;
  return (VALID_STEM_MODES.has(raw) ? raw : DEFAULT_STEM_MODE) as StemMode;
}

function modeIn(...areas: Array<'rerank' | 'tokenset'>): boolean {
  const mode = currentStemMode();
  if (mode === 'off') return false;
  if (mode === 'verb' || mode === 'plural') return true;
  if (mode.startsWith('rerank')) return areas.includes('rerank');
  return areas.includes('tokenset');
}

function modePlural(): boolean {
  const mode = currentStemMode();
  return mode === 'plural' || mode.endsWith('-plural');
}

/** Resolve the effective stem mode once (for engines that pin it for life). */
export function readStemMode(): StemMode {
  return currentStemMode();
}

/** Whether an explicit mode applies the given wiring. */
function modeInExplicit(mode: StemMode, area: 'rerank' | 'tokenset'): boolean {
  if (mode === 'off') return false;
  if (mode === 'verb' || mode === 'plural') return true;
  if (mode.startsWith('rerank')) return area === 'rerank';
  return area === 'tokenset';
}

/** Explicit-mode tokenSet stem. Used by engines that snapshot the mode at
 *  construction so index-time and query-time folding can never diverge. */
export function foldTokenSetWithMode(token: string, mode: StemMode): string {
  if (!modeInExplicit(mode, 'tokenset')) return token;
  return stemFold(token, mode === 'plural' || mode.endsWith('-plural'));
}

/**
 * Strip a trailing silent "e" so a base verb matches its e-dropping
 * inflections (capture→captur, use→us, move→mov). Lowered to length>=3 so
 * short verbs (use/move) fold too. Words that are overwhelmingly nouns/
 * adjectives are protected verbatim: folding them creates false matches
 * (state→stat, drive→driv colliding with unrelated short roots).
 */
const PROTECTED_TRAILING_E: Record<string, true> = {
  state: true,
  drive: true,
  scope: true,
  while: true,
  since: true,
  value: true,
  table: true,
  sample: true,
  module: true,
  profile: true,
  message: true,
  package: true,
  variable: true,
  structure: true,
  attribute: true,
  instance: true,
  response: true,
  request: true,
  template: true,
  framework: true,
  environment: true,
};

/** "-ing" tokens that are nouns/other, not verb inflections. */
const NON_VERB_ING: Record<string, true> = {
  string: true,
  spring: true,
  bring: true,
  thing: true,
  king: true,
  ring: true,
  sing: true,
  wing: true,
  cling: true,
  fling: true,
  sling: true,
  sting: true,
  swing: true,
  wring: true,
  during: true,
  evening: true,
  morning: true,
  ceiling: true,
  nothing: true,
  something: true,
  anything: true,
  everything: true,
  building: true,
  setting: true,
  mapping: true,
  handling: true,
  matching: true,
  ranking: true,
  binding: true,
};

/**
 * Words whose trailing "ed" belongs to the root rather than an inflection.
 * Stripping it leaves a non-root fragment (embed→emb) that would collide with
 * unrelated tokens, so they stay verbatim. `needed` and other real -ed forms
 * are not listed and still fold.
 */
const PROTECTED_ED_BASE: Record<string, true> = {
  need: true,
  feed: true,
  embed: true,
  shed: true,
};

/** Verb bases that already end in a doubled consonant. Their inflected forms
 *  must NOT collapse that doubling (processing→process, passing→pass). */
const DOUBLED_STEM_BASE: Record<string, true> = {
  process: true,
  pass: true,
  address: true,
  status: true,
  class: true,
  access: true,
  less: true,
  miss: true,
  cross: true,
  press: true,
  stress: true,
  guess: true,
  dress: true,
  progress: true,
  success: true,
  discuss: true,
  express: true,
  impress: true,
  possess: true,
  assess: true,
  compress: true,
};

const stripTrailingE = (t: string): string =>
  t.length >= 3 && t.endsWith('e') ? t.slice(0, -1) : t;

/** Collapse an inflectional doubling only for short CVC roots (runn→run),
 *  never for a real doubled-stem base (process / pass). */
function collapseInflectionalDoubling(root: string): string {
  if (DOUBLED_STEM_BASE[root]) return root;
  if (
    root.length >= 3 &&
    root.length <= 5 &&
    !/[aeiou]$/.test(root) &&
    root[root.length - 1] === root[root.length - 2]
  ) {
    return root.slice(0, -1);
  }
  return root;
}

/**
 * Verb-inflection-only stem. Both an inflected form and its base fold to ONE
 * canonical stem ("running"/"run"→run, "captured"/"capture"→captur,
 * "using"/"use"→us, "processing"/"process"→process). Non-verbs (-ing nouns,
 * protected trailing-e words, doubled-stem bases) are left verbatim.
 */
function stemInflectionOnly(token: string): string {
  if (PROTECTED_TRAILING_E[token] || NON_VERB_ING[token] || PROTECTED_ED_BASE[token]) return token;
  if (token.endsWith('ing') && token.length >= 5) {
    return stripTrailingE(collapseInflectionalDoubling(token.slice(0, -3)));
  }
  if (token.endsWith('ed') && token.length >= 4) {
    const stem = stripTrailingE(collapseInflectionalDoubling(token.slice(0, -2)));
    // Avoid truncating short real words into 2-char non-roots
    // (need→ne, feed→fe, embed→emb, shed→sh).
    return stem.length >= 3 ? stem : token;
  }
  return stripTrailingE(token);
}

function stemFold(token: string, withPlural: boolean): string {
  // Fold the plural on the *original* token before verb inflection so a base
  // noun and its plural reach the same canonical stem (device/devices→devic,
  // box/boxes→box).
  let candidate = token;
  if (
    withPlural &&
    candidate.length >= 4 &&
    candidate.endsWith('s') &&
    !candidate.endsWith('ss') &&
    !candidate.endsWith('us') &&
    !candidate.endsWith('is')
  ) {
    candidate = candidate.slice(0, -1);
  }
  return stemInflectionOnly(candidate);
}

/**
 * QueryNormalizer provides utilities for normalizing and preprocessing search queries
 * and tool metadata for indexing.
 */
export const QueryNormalizer = {
  /**
   * Extract parameter names and description tokens from a tool's inputSchema.
   * Handles both simple flat properties and nested object properties.
   *
   * @param inputSchema The tool's inputSchema object
   * @returns Array of normalized tokens from parameter names and descriptions
   */
  extractParamTokens(inputSchema: unknown): string[] {
    const tokens: string[] = [];
    if (!inputSchema || typeof inputSchema !== 'object') return tokens;

    const schema = inputSchema as Record<string, unknown>;
    const properties = schema.properties;
    if (!properties || typeof properties !== 'object') return tokens;

    for (const [paramName, paramDef] of Object.entries(properties as Record<string, unknown>)) {
      // Add the parameter name itself (split on camelCase)
      const nameParts = paramName.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_-]+/);
      for (const part of nameParts) {
        const lower = part.toLowerCase();
        if (lower.length > 1) {
          tokens.push(lower);
        }
      }

      // Add description tokens if available
      if (paramDef && typeof paramDef === 'object') {
        const desc = (paramDef as Record<string, unknown>).description;
        if (typeof desc === 'string') {
          // Extract only key terms from description (skip very common words)
          const descWords = desc
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean);
          for (const w of descWords) {
            if (w.length > 2 && !PARAM_DESCRIPTION_STOP_WORDS.has(w)) {
              tokens.push(w);
            }
          }
        }
      }
    }

    return tokens;
  },

  /**
   * Extract a short description from a full tool description.
   * Takes the first sentence and truncates to 120 characters if needed.
   *
   * @param description The full tool description
   * @returns A shortened description suitable for display
   */
  extractShortDescription(description: string): string {
    if (!description) return '';
    const firstSentence = description.match(/^[^.!?\n]+[.!?]?/);
    if (firstSentence) {
      const result = firstSentence[0]!.trim();
      return result.length > 120 ? result.slice(0, 117) + '...' : result;
    }
    return description.length > 120 ? description.slice(0, 117) + '...' : description;
  },

  /**
   * Check if a query contains CJK (Chinese, Japanese, Korean) characters.
   *
   * @param query The search query
   * @returns true if the query contains CJK characters
   */
  containsCJK(query: string): boolean {
    return /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(query);
  },

  /**
   * Normalize a tool name for comparison (lowercase, underscores to hyphens/spaces).
   *
   * @param query The search query
   * @returns Normalized query string
   */
  normalizeToolName(query: string): string {
    return query.toLowerCase().replace(/[\s-]+/g, '_');
  },

  /**
   * Check whether a token is an English stop word.
   */
  isStopWord(token: string): boolean {
    return ENGLISH_STOP_WORDS.has(token.toLowerCase());
  },

  /**
   * Rerank-side stem, gated by SEARCH_STEM_MODE ('rerank-verb' /
   * 'rerank-plural' / 'verb' / 'plural' all include this wiring). Off-mode
   * returns the token untouched.
   */
  stemRerankToken(token: string): string {
    if (!modeIn('rerank')) return token;
    return stemFold(token, modePlural());
  },

  /**
   * Engine tokenSet / term-drift stem ('tokenset-verb' / 'tokenset-plural' /
   * 'verb' / 'plural'). The drift comparison uses this same function on the
   * query side so both sides of the match fold identically.
   */
  stemTokenSetToken(token: string): string {
    if (!modeIn('tokenset')) return token;
    return stemFold(token, modePlural());
  },

  /**
   * Filter out English stop words from search query tokens.
   * If all tokens are stop words, retains the original array so query remains searchable.
   */
  filterQueryStopwords(tokens: string[]): string[] {
    const filtered = tokens.filter((t) => !ENGLISH_STOP_WORDS.has(t.toLowerCase()));
    return filtered.length > 0 ? filtered : tokens;
  },

  /**
   * Return the singular/plural counterpart of an English word if applicable.
   */
  inflectWord(token: string): string | null {
    if (token.length <= 3) return null;
    const lower = token.toLowerCase();
    if (lower.endsWith('ies') && lower.length > 4) {
      return lower.slice(0, -3) + 'y';
    }
    if (
      lower.endsWith('es') &&
      lower.length > 4 &&
      (lower.endsWith('shes') ||
        lower.endsWith('ches') ||
        lower.endsWith('sses') ||
        lower.endsWith('xes'))
    ) {
      return lower.slice(0, -2);
    }
    if (
      lower.endsWith('s') &&
      !lower.endsWith('ss') &&
      !lower.endsWith('us') &&
      !lower.endsWith('is')
    ) {
      return lower.slice(0, -1);
    }
    if (
      lower.endsWith('ss') ||
      lower.endsWith('sh') ||
      lower.endsWith('ch') ||
      lower.endsWith('x')
    ) {
      return lower + 'es';
    }
    if (!lower.endsWith('s')) {
      return lower + 's';
    }
    return null;
  },

  /**
   * Extract parameter signature (names and required fields) from a tool's inputSchema
   * for type/signature-directed matching.
   */
  extractSchemaSignature(inputSchema: unknown): {
    paramNames: string[];
    requiredParams: string[];
  } {
    const paramNames: string[] = [];
    const requiredParams: string[] = [];
    if (!inputSchema || typeof inputSchema !== 'object') {
      return { paramNames, requiredParams };
    }
    const schema = inputSchema as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const r of schema.required) {
        if (typeof r === 'string' && r.length > 0) {
          requiredParams.push(r.toLowerCase());
        }
      }
    }
    const properties = schema.properties;
    if (properties && typeof properties === 'object') {
      for (const key of Object.keys(properties)) {
        paramNames.push(key.toLowerCase());
      }
    }
    return { paramNames, requiredParams };
  },
};
