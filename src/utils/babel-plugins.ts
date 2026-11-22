import type { ParserPlugin } from '@babel/parser';

/**
 * Shared parser plugin set for untrusted JavaScript/TypeScript input.
 *
 * `decorators` is Babel 8's standard decorator plugin (distinct from
 * `decorators-legacy`); without it, decorated classes — common in modern
 * bundles — fail to parse and the analyzer/deobfuscator silently skips the
 * file. Keeping the list in one place stops every analysis path from
 * drifting to a different syntax subset.
 */
export const BABEL_PARSE_PLUGINS: ParserPlugin[] = ['jsx', 'typescript', 'decorators'];
