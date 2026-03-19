/**
 * Domain-specific synonym expansion for tool search queries.
 *
 * Provides bidirectional synonym lookup using a precomputed reverse-index map.
 * Each synonym group covers closely related terms within the MCP tool vocabulary.
 * Expansion is applied at query time only (not document indexing) to keep the
 * inverted index precise while broadening recall for user queries.
 */

import { SEARCH_SYNONYM_EXPANSION_LIMIT } from '@src/constants';

// ── synonym groups ──

/**
 * Each inner array is a bidirectional synonym group: every member maps to
 * every other member.  Groups are curated for the MCP tool domain vocabulary.
 */
const SYNONYM_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  // Navigation
  ['navigate', 'go', 'open', 'visit', 'browse', 'load'],
  // Network capture
  ['intercept', 'capture', 'monitor', 'sniff', 'collect', 'record', 'track'],
  // Network requests
  ['request', 'fetch', 'xhr', 'ajax', 'http', 'api'],
  // Authentication
  ['authenticate', 'auth', 'login', 'credential', 'token', 'jwt', 'session'],
  // Debugging
  ['breakpoint', 'pause', 'halt', 'stop', 'break'],
  // Code stepping
  ['step', 'next', 'continue', 'resume'],
  // Code transform
  ['deobfuscate', 'beautify', 'unminify', 'decode', 'transform', 'decompile'],
  // Screenshot / visual
  ['screenshot', 'snapshot', 'image', 'picture', 'photo'],
  // Execute / evaluate
  ['evaluate', 'execute', 'run', 'eval', 'invoke', 'call'],
  // DOM elements
  ['element', 'node', 'selector', 'dom', 'component'],
  // Click / interact
  ['click', 'tap', 'press', 'interact', 'trigger'],
  // Type / input
  ['type', 'input', 'enter', 'fill', 'write'],
  // Storage
  ['cookie', 'localstorage', 'storage', 'cache', 'indexeddb'],
  // WebSocket
  ['websocket', 'ws', 'socket', 'realtime'],
  // Scroll
  ['scroll', 'swipe', 'drag'],
  // Search / find
  ['search', 'find', 'query', 'lookup', 'discover', 'locate'],
  // Hook / patch
  ['hook', 'patch', 'override', 'replace', 'wrap', 'proxy'],
  // Script / code
  ['script', 'code', 'source', 'javascript', 'js'],
  // Bundle / webpack
  ['bundle', 'webpack', 'module', 'pack', 'chunk'],
  // Block / filter
  ['block', 'filter', 'deny', 'reject', 'prevent'],
  // Allow / permit
  ['allow', 'permit', 'whitelist', 'accept', 'enable'],
  // Remove / delete
  ['remove', 'delete', 'clear', 'clean', 'purge', 'erase'],
  // List / show
  ['list', 'show', 'display', 'enumerate', 'get'],
  // Set / configure
  ['set', 'configure', 'config', 'setup', 'assign'],
  // Stealth / anti-detect
  ['stealth', 'antidetect', 'fingerprint', 'evasion', 'undetected'],
  // Mobile / device
  ['mobile', 'device', 'emulate', 'responsive', 'phone'],
  // Performance / profile
  ['performance', 'profile', 'benchmark', 'metric', 'vitals'],
  // Register / signup
  ['register', 'signup', 'account', 'enroll', 'join'],
  // Captcha / challenge
  ['captcha', 'challenge', 'verification', 'verify', 'solve'],
  // Tab / window
  ['tab', 'window', 'page'],
  // Inspect / examine
  ['inspect', 'examine', 'analyze', 'analyse', 'debug', 'investigate'],
  // Wait / delay
  ['wait', 'delay', 'sleep', 'timeout', 'poll'],
  // Close / disconnect
  ['close', 'disconnect', 'quit', 'exit', 'shutdown', 'terminate'],
  // Network traffic
  ['traffic', 'network', 'request', 'response', 'connection'],
  // Heap / memory
  ['heap', 'memory', 'allocation', 'gc', 'garbage'],
  // Export / save
  ['export', 'save', 'dump', 'download', 'extract'],
  // Replay / resend
  ['replay', 'resend', 'repeat', 'redo', 'retry'],
  // Variable / scope
  ['variable', 'scope', 'local', 'closure', 'context'],
  // Watch / observe
  ['watch', 'observe', 'monitor', 'trace', 'track'],
  // Protobuf / binary
  ['protobuf', 'proto', 'binary', 'msgpack', 'grpc'],
  // WASM
  ['wasm', 'webassembly', 'assembly'],
  // SSE / streaming
  ['sse', 'eventsource', 'stream', 'streaming'],
  // GraphQL
  ['graphql', 'gql', 'introspect', 'mutation', 'subscription'],
];

// ── SynonymExpander class ──

export class SynonymExpander {
  /**
   * Reverse lookup map: token → Set of all synonyms (excluding itself).
   * Built once at construction from SYNONYM_GROUPS.
   */
  private readonly reverseMap: ReadonlyMap<string, ReadonlySet<string>>;

  constructor() {
    this.reverseMap = SynonymExpander.buildReverseMap(SYNONYM_GROUPS);
  }

  /**
   * Return synonyms for a single token (excluding the token itself).
   * Returns empty array for unknown tokens.
   */
  expand(token: string): string[] {
    const synonyms = this.reverseMap.get(token.toLowerCase());
    return synonyms ? [...synonyms] : [];
  }

  /**
   * Expand an array of query tokens with their synonyms.
   * Deduplicates and respects SEARCH_SYNONYM_EXPANSION_LIMIT per original token.
   * Original tokens are always preserved.
   */
  expandQuery(tokens: string[]): string[] {
    const existing = new Set(tokens.map((t) => t.toLowerCase()));
    const expanded: string[] = [];
    const limit = SEARCH_SYNONYM_EXPANSION_LIMIT;

    for (const token of tokens) {
      const synonyms = this.reverseMap.get(token.toLowerCase());
      if (!synonyms) continue;

      let added = 0;
      for (const syn of synonyms) {
        if (added >= limit) break;
        if (!existing.has(syn)) {
          expanded.push(syn);
          existing.add(syn);
          added++;
        }
      }
    }

    return expanded;
  }

  /**
   * Build the reverse lookup map from synonym groups.
   * For each token in a group, maps it to all other tokens in the same group.
   * If a token appears in multiple groups, all synonyms are merged.
   */
  private static buildReverseMap(
    groups: ReadonlyArray<ReadonlyArray<string>>
  ): ReadonlyMap<string, ReadonlySet<string>> {
    const map = new Map<string, Set<string>>();

    for (const group of groups) {
      for (const token of group) {
        const lower = token.toLowerCase();
        let synonymSet = map.get(lower);
        if (!synonymSet) {
          synonymSet = new Set<string>();
          map.set(lower, synonymSet);
        }
        for (const otherToken of group) {
          const otherLower = otherToken.toLowerCase();
          if (otherLower !== lower) {
            synonymSet.add(otherLower);
          }
        }
      }
    }

    return map;
  }
}
