/**
 * ToolCallContextGuard — enriches tool responses with current tab context
 * and detects repeated tool call loops.
 *
 * For context-sensitive tools (page_*, console_*, debugger_*, network_*, dom_*, etc.),
 * appends `_tabContext` metadata to responses so the LLM always knows which page
 * it is operating on, preventing silent context drift.
 *
 * Additionally, tracks consecutive identical tool calls and injects `repeatWarning`
 * when the same tool is called ≥ MAX_CONSECUTIVE_REPEATS times in a row, helping
 * break LLM degeneration loops (e.g. stealth_inject called 5× instead of page_navigate).
 */

import { logger } from '@utils/logger';
import { matchesWildcardPattern } from '@utils/matchesWildcardPattern';
import { getToolRequestContext } from '@server/runtime/ToolRequestContext';
import { META_TOOL_NAMES } from '@server/MCPServer.search.meta-names';
import { emitBusEvent, type EventBus, type ServerEventMap } from '@server/EventBus';
import { MCP_DOOM_LOOP_THRESHOLD, TOOL_GATE_MAX_LISTED_RULES } from '@src/constants/server';
import type { ToolExecutionConfig, ToolExecutionRuleConfig } from '@internal-types/config';

/** Minimal TabRegistry surface needed by the guard. */
interface TabContextProvider {
  getContextMeta(): {
    url: string | null;
    title: string | null;
    tabIndex: number | null;
    pageId: string | null;
  };
}

type ContextSensitiveToolDomain =
  | 'page'
  | 'console'
  | 'debugger'
  | 'network'
  | 'dom'
  | 'stealth'
  | 'framework'
  | 'indexeddb'
  | 'js_heap'
  | 'script'
  | 'captcha'
  | 'ai_hook'
  | 'instrumentation'
  | 'hook_preset'
  | 'ws'
  | 'sse'
  | 'fetch_stream'
  | 'webrtc'
  | 'canvas'
  | 'skia'
  | 'webgpu'
  | 'v8'
  | 'wasm'
  | 'trace'
  | 'graphql'
  | 'sourcemap'
  | 'performance'
  | 'profiler'
  | 'page_script'
  | 'grpc'
  | 'antidebug'
  | 'blackbox'
  | 'evidence';

type ContextSensitiveToolPrefix = `${ContextSensitiveToolDomain}_`;

const CONTEXT_SENSITIVE_PREFIXES = [
  'page_',
  'console_',
  'debugger_',
  'network_',
  'dom_',
  'stealth_',
  'framework_',
  'indexeddb_',
  'js_heap_',
  'script_',
  'captcha_',
  'ai_hook_',
  'instrumentation_',
  'hook_preset_',
  'ws_',
  'sse_',
  'fetch_stream_',
  'webrtc_',
  'canvas_',
  'skia_',
  'webgpu_',
  'v8_',
  'wasm_',
  'trace_',
  'graphql_',
  'sourcemap_',
  'performance_',
  'profiler_',
  'page_script_',
  'grpc_',
  'antidebug_',
  'blackbox_',
  'evidence_',
] as const satisfies readonly ContextSensitiveToolPrefix[];

const CONTEXT_SENSITIVE_TOOLS = new Set([
  'collect_code',
  'call_graph_analyze',
  'script_replace_persist',
  // Debugger tools whose historical names predate the debugger_ prefix.
  'breakpoint',
  'get_call_stack',
  'get_object_properties',
  'get_scope_variables_enhanced',
  'watch',
  // Analysis and workflow tools that resolve the collector's active page.
  'search_in_scripts',
  'extract_function_tree',
  'clear_collected_data',
  'get_collection_stats',
  'webpack_enumerate',
  'api_probe_batch',
  'js_bundle_search',
  // Coordination data is shared, but capture/restore must use the caller's tab.
  'create_task_handoff',
  'save_page_snapshot',
  'restore_page_snapshot',
  'coordination_restore_snapshot',
  // Trace lifecycle binds a recorder/CDP session to the caller's current tab.
  'start_trace_recording',
  'stop_trace_recording',
  // Encoding operations can resolve request bodies from the active page.
  'binary_detect_format',
  'binary_decode',
  'binary_encode',
  'binary_entropy_analysis',
  'protobuf_decode_raw',
  // Transform operations may resolve script IDs or functions in page context.
  'ast_transform_preview',
  'ast_transform_chain',
  'ast_transform_apply',
  'crypto_extract_standalone',
]);

/** Max consecutive identical calls before injecting a warning. */
const MAX_CONSECUTIVE_REPEATS = 3;
const MAX_REPEAT_SCOPES = 256;

/** Raw network tools exempt from context-sensitivity (no browser/UI needed). */
const NETWORK_RAW_TOOLS = new Set([
  'network_icmp_probe',
  'network_traceroute',
  'network_rtt_measure',
  'http_request_build',
  'http_plain_request',
  'http2_probe',
  'http2_frame_build',
  'dns_resolve',
  'dns_reverse',
]);

/** Meta-tools excluded from repeat detection — agents legitimately chain these. */
const REPEAT_GUARD_EXCLUDES = META_TOOL_NAMES;

/** Suggested alternative tools per domain prefix when a repeat loop is detected. */
const DOMAIN_ALTERNATIVES: ReadonlyMap<string, readonly string[]> = new Map([
  ['stealth', ['page_navigate', 'page_evaluate', 'stealth_verify', 'page_screenshot']],
  ['page', ['browser_jsdom_parse', 'js_bundle_search', 'network_get_requests', 'page_screenshot']],
  ['console', ['page_evaluate', 'console_get_logs', 'page_screenshot']],
  ['network', ['network_get_requests', 'page_navigate']],
  ['captcha', ['captcha_wait', 'page_screenshot']],
  ['ai_hook', ['manage_hooks', 'page_evaluate', 'ai_hook_inject']],
  ['instrumentation', ['instrumentation_session', 'instrumentation_artifact']],
  ['evidence', ['evidence_query', 'evidence_chain']],
]);

export class ToolCallContextGuard {
  private getProvider: () => TabContextProvider | null;
  /** Memoize prefix-match results — tool names repeat heavily across calls. */
  private readonly contextSensitiveCache = new Map<string, boolean>();

  /** Repeat detection is isolated per MCP client session in shared-daemon mode. */
  private readonly repeatStates = new Map<
    string,
    { lastToolName: string | null; consecutiveCount: number }
  >();

  /**
   * Doom-loop detection (consecutive identical tool+args calls) uses the same
   * per-session keying and scope cap as repeat detection.
   */
  private readonly doomLoopStates = new Map<string, { lastKey: string | null; count: number }>();

  /** Sliding window execution complexity gas usage records per session. */
  private readonly gasUsage = new Map<string, Array<{ timestamp: number; cost: number }>>();

  /** Isomorphic semantic call tracker (normalized args) per session. */
  private readonly isomorphicStates = new Map<string, { lastKey: string | null; count: number }>();

  constructor(getProvider: () => TabContextProvider | null) {
    this.getProvider = getProvider;
  }

  private getRepeatState(): { lastToolName: string | null; consecutiveCount: number } {
    const scope = getToolRequestContext()?.sessionId ?? 'default';
    let state = this.repeatStates.get(scope);
    if (!state) {
      if (this.repeatStates.size >= MAX_REPEAT_SCOPES) {
        const oldest = this.repeatStates.keys().next().value as string | undefined;
        if (oldest) this.repeatStates.delete(oldest);
      }
      state = { lastToolName: null, consecutiveCount: 0 };
      this.repeatStates.set(scope, state);
    }
    return state;
  }

  /** Check whether a tool name belongs to a context-sensitive domain. */
  isContextSensitive(toolName: string): boolean {
    const cached = this.contextSensitiveCache.get(toolName);
    if (cached !== undefined) return cached;

    if (NETWORK_RAW_TOOLS.has(toolName)) {
      this.contextSensitiveCache.set(toolName, false);
      return false;
    }

    const result =
      CONTEXT_SENSITIVE_TOOLS.has(toolName) ||
      CONTEXT_SENSITIVE_PREFIXES.some((prefix) => toolName.startsWith(prefix));
    this.contextSensitiveCache.set(toolName, result);
    return result;
  }

  /**
   * Record a tool call for repeat detection.
   * Call this BEFORE enrichResponse for accurate tracking.
   * Returns the current consecutive count (1 = first call).
   */
  recordCall(toolName: string): number {
    if (REPEAT_GUARD_EXCLUDES.has(toolName)) {
      // Don't track meta-tools — they chain legitimately
      return 0;
    }

    const state = this.getRepeatState();
    if (toolName === state.lastToolName) {
      state.consecutiveCount++;
    } else {
      state.lastToolName = toolName;
      state.consecutiveCount = 1;
    }
    return state.consecutiveCount;
  }

  /**
   * Check if the current call is a suspected repeat loop.
   */
  isRepeatLoop(): boolean {
    return this.getRepeatState().consecutiveCount >= MAX_CONSECUTIVE_REPEATS;
  }

  /**
   * Record one tool call in the doom-loop tracker and report whether it
   * tripped the circuit breaker. Consecutive identical calls (same tool name +
   * stable args key) within one MCP session accumulate; a call with different
   * arguments or a different tool resets the counter. A non-positive
   * threshold disables the breaker entirely. Unlike the repeat guard, meta
   * tools are NOT excluded here: call_tool-routed invocations carry the inner
   * tool name and are exactly the degenerate-loop shape this tracks.
   */
  recordDoomLoopCall(
    toolName: string,
    argsJson: string,
    threshold: number = MCP_DOOM_LOOP_THRESHOLD,
  ): DoomLoopTrip | null {
    if (threshold <= 0) return null;

    const scope = getToolRequestContext()?.sessionId ?? 'default';
    let state = this.doomLoopStates.get(scope);
    if (!state) {
      if (this.doomLoopStates.size >= MAX_REPEAT_SCOPES) {
        const oldest = this.doomLoopStates.keys().next().value as string | undefined;
        if (oldest) this.doomLoopStates.delete(oldest);
      }
      state = { lastKey: null, count: 0 };
      this.doomLoopStates.set(scope, state);
    }

    const key = `${toolName}\u0000${argsJson}`;
    if (state.lastKey === key) {
      state.count += 1;
    } else {
      state.lastKey = key;
      state.count = 1;
    }
    if (state.count < threshold) return null;
    return { count: state.count, threshold, fullAdvisory: state.count % threshold === 0 };
  }

  /** Test hook: clear all doom-loop counters across sessions. */
  resetDoomLoopStatesForTesting(): void {
    this.doomLoopStates.clear();
  }

  /**
   * Record tool execution complexity units against a sliding-window Gas budget.
   * If accumulated units exceed maxWindowUnits, returns trip details.
   */
  recordExecutionCost(toolName: string, config?: GasBudgetConfig): GasBudgetTrip | null {
    const limit = config?.maxWindowUnits ?? 0;
    if (limit <= 0) return null;
    const windowMs = config?.windowMs ?? 60_000;
    const now = Date.now();
    const scope = getToolRequestContext()?.sessionId ?? 'default';

    let records = this.gasUsage.get(scope);
    if (!records) {
      records = [];
      this.gasUsage.set(scope, records);
    }

    const cutoff = now - windowMs;
    const filtered = records.filter((r) => r.timestamp > cutoff);
    const cost = getToolExecutionComplexity(toolName);
    filtered.push({ timestamp: now, cost });
    this.gasUsage.set(scope, filtered);

    const totalUsed = filtered.reduce((sum, r) => sum + r.cost, 0);
    if (totalUsed > limit) {
      const oldest = filtered[0]?.timestamp ?? now;
      const resetInMs = Math.max(0, oldest + windowMs - now);
      return { usedCost: totalUsed, limit, resetInMs };
    }
    return null;
  }

  /**
   * Record tool call with normalized semantic arguments (isomorphic loop detection).
   * Catches agents that mutate cosmetic/ephemeral parameters across loops.
   */
  recordIsomorphicCall(
    toolName: string,
    args: Record<string, unknown>,
    threshold = 4,
  ): IsomorphicTrip | null {
    if (threshold <= 0) return null;
    const scope = getToolRequestContext()?.sessionId ?? 'default';
    let state = this.isomorphicStates.get(scope);
    if (!state) {
      if (this.isomorphicStates.size >= MAX_REPEAT_SCOPES) {
        const oldest = this.isomorphicStates.keys().next().value as string | undefined;
        if (oldest) this.isomorphicStates.delete(oldest);
      }
      state = { lastKey: null, count: 0 };
      this.isomorphicStates.set(scope, state);
    }

    const semanticSig = normalizeSemanticArgs(args);
    const key = `${toolName}\u0000${semanticSig}`;
    if (state.lastKey === key) {
      state.count += 1;
    } else {
      state.lastKey = key;
      state.count = 1;
    }

    if (state.count < threshold) return null;
    return { count: state.count, threshold, semanticSignature: key };
  }

  /** Test hook: clear all gas and isomorphic counters across sessions. */
  resetExecutionBudgetForTesting(): void {
    this.gasUsage.clear();
    this.isomorphicStates.clear();
  }

  /**
   * Enrich a successful tool response with `_tabContext` metadata.
   *
   * Uses string splice injection to avoid a full JSON.parse → JSON.stringify
   * round-trip on the hot path. Falls back to parse+mutate only for non-object
   * JSON payloads.
   */
  enrichResponse<T extends { content?: unknown[]; isError?: boolean }>(
    toolName: string,
    response: T,
  ): T {
    // Repeat warning injection (applies to ALL tools, not just context-sensitive)
    if (this.isRepeatLoop() && !REPEAT_GUARD_EXCLUDES.has(toolName)) {
      this.injectRepeatWarning(toolName, response);
    }

    if (!this.isContextSensitive(toolName)) return response;
    if (response.isError) return response;

    const provider = this.getProvider() as Partial<TabContextProvider> | null;
    if (!provider || typeof provider.getContextMeta !== 'function') return response;

    const meta = provider.getContextMeta();
    // Skip if no active page tracked
    if (!meta.pageId && meta.tabIndex === null) return response;

    const content = response.content;
    if (!Array.isArray(content)) return response;

    const firstText = content.find(
      (c: unknown): c is { type: string; text: string } =>
        typeof c === 'object' &&
        c !== null &&
        (c as Record<string, unknown>).type === 'text' &&
        typeof (c as Record<string, unknown>).text === 'string',
    );
    if (!firstText) return response;

    const raw = firstText.text;
    const trimmedStart = raw.trimStart();

    // Fast path: JSON object text — splice _tabContext without full re-serialization
    if (trimmedStart.startsWith('{') && trimmedStart.trimEnd().endsWith('}')) {
      try {
        // Validate it's actually parseable JSON (cheap compared to re-stringify)
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          // Guard: skip if _tabContext was already injected (prevents double-injection)
          if ('_tabContext' in parsed) return response;
          firstText.text = this.spliceTabContext(raw, meta);
          return response;
        }
      } catch {
        logger.debug(`[ContextGuard] Skipped non-JSON response enrichment for ${toolName}`);
        return response;
      }
    }

    return response;
  }

  /**
   * Inject `_tabContext` into a JSON object string by splicing before the
   * closing brace, preserving the original formatting style (compact or pretty).
   */
  private spliceTabContext(
    raw: string,
    meta: {
      url: string | null;
      title: string | null;
      tabIndex: number | null;
      pageId: string | null;
    },
  ): string {
    const tabContext = {
      url: meta.url,
      title: meta.title,
      tabIndex: meta.tabIndex,
      pageId: meta.pageId,
    };

    // Detect pretty-print: if the closing brace is on its own line, match style
    if (/\n\}\s*$/.test(raw)) {
      const prettyJson = JSON.stringify(tabContext, null, 2).replace(/\n/g, '\n  ');
      return raw.replace(/\n\}\s*$/, `,\n  "_tabContext": ${prettyJson}\n}`);
    }

    // Compact style
    const compactJson = JSON.stringify(tabContext);
    if (/^\{\s*\}\s*$/.test(raw)) {
      return raw.replace(/\{\s*\}\s*$/, `{"_tabContext":${compactJson}}`);
    }
    return raw.replace(/\}\s*$/, `,"_tabContext":${compactJson}}`);
  }

  /**
   * Inject a `repeatWarning` into the response when a tool call loop is detected.
   * Splices into JSON text content if possible, or appends a new text entry.
   */
  private injectRepeatWarning<T extends { content?: unknown[] }>(
    toolName: string,
    response: T,
  ): void {
    const consecutiveCount = this.getRepeatState().consecutiveCount;
    const prefix = toolName.split('_')[0] ?? '';
    const alternatives =
      toolName === 'page_evaluate'
        ? ['browser_jsdom_parse', 'js_bundle_search', 'network_get_requests', 'page_screenshot']
        : (DOMAIN_ALTERNATIVES.get(prefix) ?? ['page_navigate', 'page_evaluate']);
    // Filter out the repeated tool itself from suggestions
    const suggestions = alternatives.filter((t) => t !== toolName);

    const warning = {
      detected: true,
      consecutiveCount,
      message:
        `⚠ You have called "${toolName}" ${consecutiveCount} times in a row. ` +
        `This is likely a loop — consider what you actually need to do next.`,
      suggestedTools: suggestions,
      hint:
        suggestions.length > 0
          ? `Try calling ${suggestions[0]} instead.`
          : 'Re-evaluate your task objective before making another tool call.',
    };

    const content = response.content;
    if (!Array.isArray(content)) return;

    const firstText = content.find(
      (c: unknown): c is { type: string; text: string } =>
        typeof c === 'object' &&
        c !== null &&
        (c as Record<string, unknown>).type === 'text' &&
        typeof (c as Record<string, unknown>).text === 'string',
    );

    if (firstText) {
      const raw = firstText.text;
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          parsed.repeatWarning = warning;
          firstText.text = JSON.stringify(parsed, null, 2);
          return;
        }
      } catch {
        // Not JSON — fall through to append
      }
    }

    // Fallback: append as a new content item
    content.push({
      type: 'text',
      text: JSON.stringify({ repeatWarning: warning }, null, 2),
    });
  }
}

/* ================================================================== */
/*  Tool-execution permission gate                                     */
/*                                                                     */
/*  Ordered rules (last match wins) + legacy allowTools whitelist      */
/*  + per-session doom-loop circuit breaker. Evaluation is pure; the   */
/*  doom-loop counter is keyed per MCP session and scoped to the       */
/*  server context instance via a WeakMap.                             */
/* ================================================================== */

/**
 * Runtime form of a tool-execution permission rule. Identical to
 * ToolExecutionRuleConfig from @internal-types/config but declared locally so
 * tests and callers can build rules without importing the config types.
 */
export interface ToolPermissionRule {
  /** Exact tool name, `domain/*` wildcard, or `*` (match everything). */
  tool: string;
  /** Optional wildcard pattern matched against the stable args JSON. */
  pattern?: string;
  action: 'allow' | 'deny';
  /**
   * Where the rule came from: the `allowTools` whitelist expansion (including
   * the implicit whitelist deny-all) or the user-authored `rules` list.
   */
  source?: 'allowTools' | 'rules';
}

/** Result of evaluating the ordered rule list for one tool call. */
export interface ToolGateDecision {
  allowed: boolean;
  /** Rule that decided the outcome; null when no rule matched (default allow). */
  matchedRule: ToolPermissionRule | null;
}

/** Doom-loop trip info returned when a repeated identical call crosses the threshold. */
export interface DoomLoopTrip {
  /** 1-based count of consecutive identical calls including this one. */
  count: number;
  threshold: number;
  /**
   * True when the long advisory should be included (every `threshold`-th
   * consecutive call) so repeated errors do not flood the client.
   */
  fullAdvisory: boolean;
}

export interface GasBudgetConfig {
  /** Maximum execution complexity units allowed in a sliding window. 0 disables. */
  maxWindowUnits?: number;
  /** Sliding window duration in milliseconds (default: 60,000ms). */
  windowMs?: number;
}

export interface GasBudgetTrip {
  usedCost: number;
  limit: number;
  resetInMs: number;
}

export interface IsomorphicTrip {
  count: number;
  threshold: number;
  semanticSignature: string;
}

/**
 * Tools measured (per-tool benchmark scorecard) to spawn subprocesses, native
 * probes, QuickJS-WASM worker pools, cold heavy imports, or deliberate poll
 * waits — i.e. real host-resource consumers that the name-only heuristic
 * under-rated at 1 gas. Static membership table; `Record` (not `Set`) because
 * the keys are fixed literals. A rename that misses this table re-opens a
 * budget hole, so keep the list synced with artifacts/benchmarks/scorecard.md.
 */
const RESOURCE_HEAVY_MEASURED_TOOLS: Record<string, true> = {
  platform_capabilities: true, // ToolRegistry.probeAll() -> N execFile + python probes
  wasm_offline_run: true, // probeAll() then WebAssembly.instantiate
  wasm_capabilities: true, // same probeAll() batch
  process_find: true, // powershell Get-Process spawn (cold cache)
  crypto_test_harness: true, // QuickJS-WASM worker pool warmup
  crypto_compare: true, // two QuickJS-WASM harness submissions
  tasks_result: true, // deliberate 100ms poll-until-terminal
  tasks_list: true, // harness-side sleeps
  net_raw_tcp_listen: true, // live socket
  net_raw_udp_listen: true, // live socket
  browser_jsdom_parse: true, // cold import('jsdom')
  browser_jsdom_query: true, // cold import('jsdom')
  browser_jsdom_execute: true, // cold import('jsdom') + user code
};

/**
 * Determine a CONSERVATIVE host-resource cost ceiling for one tool call.
 *
 * This is NOT a latency estimate and NOT a cyclomatic-complexity score. It is a
 * coarse, deliberately one-sided weight used by `recordExecutionCost` to stop
 * autonomous agents from exhausting host resources (subprocess spawns, native
 * FFI, WASM runtimes, worker pools, cold heavy imports) within a sliding window.
 * Over-rating a cheap tool is SAFE (slightly earlier throttle); under-rating an
 * expensive tool is the real defect because it leaves the budget hole open.
 *
 * Weights are calibrated against the measured benchmark scorecard. The original
 * name-only heuristic rated 11 subprocess/worker/poll-heavy tools at 1 gas
 * despite 60-240ms measured cold cost; those are now promoted via the explicit
 * RESOURCE_HEAVY_MEASURED_TOOLS table. Tools proven fast (e.g. several
 * `exploit_build_*` / `nemu_*` members) keep their high tier: it is a resource
 * ceiling, not a latency claim, and lowering it would create a hole.
 */
export function getToolExecutionComplexity(toolName: string): number {
  if (
    toolName.includes('decompile') ||
    toolName.includes('symbolic') ||
    toolName.includes('memory_scan') ||
    toolName.includes('unidbg') ||
    toolName.includes('ghidra') ||
    toolName.includes('jadx') ||
    toolName.includes('nemu_') ||
    toolName.includes('exploit_')
  ) {
    return 25;
  }
  // Tier 25 (measured): tools that spawn subprocesses / WASM runtimes / worker
  // pools / block on polls. The old gas=1 rating left a real resource-exhaustion
  // hole; the explicit table keeps the list auditable against the scorecard.
  if (RESOURCE_HEAVY_MEASURED_TOOLS[toolName] === true) {
    return 25;
  }
  if (
    toolName.startsWith('page_') ||
    toolName.startsWith('adb_') ||
    toolName.startsWith('network_') ||
    toolName.startsWith('frida_') ||
    toolName.startsWith('debugger_')
  ) {
    return 5;
  }
  return 1;
}

/**
 * Normalize arguments by stripping ephemeral, non-structural metadata keys
 * (comments, timestamps, nonces) for isomorphic loop detection.
 */
export function normalizeSemanticArgs(args: Record<string, unknown>): string {
  if (args === null || typeof args !== 'object') return '';
  const ignoredKeys = new Set([
    'comment',
    'description',
    'timestamp',
    'nonce',
    '_meta',
    'requestId',
    'id',
  ]);
  const sortedKeys = Object.keys(args)
    .filter((k) => !ignoredKeys.has(k))
    .toSorted();
  const filtered: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    const v = args[k];
    filtered[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v;
  }
  try {
    return JSON.stringify(filtered);
  } catch {
    return '<unserializable>';
  }
}

/**
 * Stable JSON serialization of tool arguments used for rule `pattern`
 * matching and doom-loop keys. The `_meta` envelope is excluded: clients may
 * attach per-call progress tokens, which would otherwise make identical
 * logical calls look different and defeat loop detection.
 */
export function stableSerializeArgs(args: Record<string, unknown>): string {
  if (args === null || typeof args !== 'object') {
    try {
      return JSON.stringify(args) ?? '';
    } catch {
      return '';
    }
  }
  const { _meta: _ignored, ...rest } = args;
  try {
    return JSON.stringify(rest) ?? '';
  } catch {
    // Cyclic or otherwise unserializable args: fall back to a stable marker so
    // repeated calls still group together rather than never tripping.
    return '<unserializable>';
  }
}

/**
 * Compile the legacy flat `allowTools` whitelist plus the ordered user rules
 * into a single ordered rule list.
 *
 * Ordering (findLast semantics — the LAST matching rule decides):
 *   1. implicit `deny *` base rule — present only when `allowTools` is
 *      non-empty, so tools outside the whitelist are denied (legacy
 *      whitelist semantics);
 *   2. one `allow` rule per `allowTools` entry — later than the base deny,
 *      so listed tools win over it;
 *   3. user `rules` last — a matching user rule always takes precedence over
 *      both the whitelist base and its allow entries.
 *
 * When both inputs are empty the compiled list is empty and every call is
 * allowed — identical to the pre-gate behavior.
 */
export function compileToolRules(
  allowTools: readonly string[],
  rules: readonly ToolPermissionRule[] | readonly ToolExecutionRuleConfig[],
): ToolPermissionRule[] {
  const whitelistBase: ToolPermissionRule[] =
    allowTools.length > 0 ? [{ tool: '*', action: 'deny', source: 'allowTools' }] : [];
  const expanded: ToolPermissionRule[] = allowTools.map((tool) => ({
    tool,
    action: 'allow' as const,
    source: 'allowTools' as const,
  }));
  const userRules: ToolPermissionRule[] = rules.map((rule) =>
    rule.pattern === undefined
      ? { tool: rule.tool, action: rule.action, source: 'rules' as const }
      : { tool: rule.tool, pattern: rule.pattern, action: rule.action, source: 'rules' as const },
  );
  return [...whitelistBase, ...expanded, ...userRules];
}

/**
 * Tool selector match: exact name, `domain/*` (matches every tool whose name
 * starts with `domain_`), or `*` (match everything).
 */
export function ruleMatchesTool(ruleTool: string, toolName: string): boolean {
  if (ruleTool === '*') return true;
  if (ruleTool.endsWith('/*')) {
    return toolName.startsWith(`${ruleTool.slice(0, -2)}_`);
  }
  return ruleTool === toolName;
}

/**
 * Evaluate the ordered rule list. findLast semantics: the LAST matching rule
 * decides; no matching rule means allow. A rule with a `pattern` only matches
 * when its wildcard pattern also matches the serialized arguments.
 */
export function evaluateToolRules(
  compiledRules: readonly ToolPermissionRule[],
  toolName: string,
  argsJson: string,
): ToolGateDecision {
  let matched: ToolPermissionRule | null = null;
  for (const rule of compiledRules) {
    if (!ruleMatchesTool(rule.tool, toolName)) continue;
    if (rule.pattern !== undefined && !matchesWildcardPattern(argsJson, rule.pattern)) continue;
    matched = rule;
  }
  return { allowed: matched === null || matched.action !== 'deny', matchedRule: matched };
}

/** Human-readable one-line rule description used in deny error responses. */
export function describeRule(rule: ToolPermissionRule): string {
  const pattern = rule.pattern === undefined ? '' : ` pattern=${JSON.stringify(rule.pattern)}`;
  return `tool=${rule.tool}${pattern} action=${rule.action}`;
}

function buildGateErrorResponse(payload: Record<string, unknown>): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: false, ...payload }, null, 2) }],
    isError: true,
  };
}

/**
 * Build the actionable deny response: names the matched rule (tool + pattern +
 * action) and lists the active rules (capped at TOOL_GATE_MAX_LISTED_RULES
 * entries with a truncation note) so the caller can adjust its plan.
 */
export function buildToolGateDenyResponse(
  toolName: string,
  matchedRule: ToolPermissionRule,
  compiledRules: readonly ToolPermissionRule[],
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const listed = compiledRules.slice(0, TOOL_GATE_MAX_LISTED_RULES).map(describeRule);
  const remaining = compiledRules.length - listed.length;
  const activeRules = remaining > 0 ? [...listed, `...and ${remaining} more rules`] : listed;
  const reason =
    matchedRule.source === 'allowTools'
      ? `Tool "${toolName}" is not in the toolExecution.allowTools whitelist ` +
        `(matched rule: ${describeRule(matchedRule)}).`
      : `Tool "${toolName}" was denied by a toolExecution permission rule ` +
        `(${describeRule(matchedRule)}).`;

  return buildGateErrorResponse({
    error: reason,
    deniedBy: { tool: matchedRule.tool, pattern: matchedRule.pattern, action: matchedRule.action },
    activeRules,
    hint:
      'Switch to a tool that the active rules allow, adjust the call arguments to avoid the ' +
      'denied pattern, or update toolExecution.rules (MCP_TOOL_RULES_JSON) if this deny is ' +
      'not intended.',
  });
}

/**
 * Build the doom-loop error response. Every tripped call returns an error;
 * the extended advisory is only included on `trip.fullAdvisory` calls
 * (every `threshold`-th consecutive identical call) to avoid error flooding.
 */
export function buildDoomLoopErrorResponse(
  toolName: string,
  argsJson: string,
  trip: DoomLoopTrip,
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const payload: Record<string, unknown> = {
    error:
      `Doom loop detected: tool "${toolName}" has been called ${trip.count} consecutive times ` +
      `with identical arguments (threshold: ${trip.threshold}). The call was blocked.`,
    doomLoop: {
      toolName,
      consecutiveCount: trip.count,
      threshold: trip.threshold,
    },
    hint:
      'Do not repeat this call. Change the arguments to make progress, or switch to a ' +
      'different tool/approach to reach the objective.',
  };
  if (trip.fullAdvisory) {
    payload.advisory =
      `Repeating "${toolName}" with ${argsJson} will keep failing. Re-evaluate the task ` +
      'objective: inspect the last successful result, adjust the input, or choose another ' +
      'method entirely.';
  }
  return buildGateErrorResponse(payload);
}

/**
 * Build the execution gas budget trip error response.
 */
export function buildGasBudgetErrorResponse(
  toolName: string,
  trip: GasBudgetTrip,
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return buildGateErrorResponse({
    error:
      `Execution complexity gas budget exceeded for tool "${toolName}" (${trip.usedCost} units used > ${trip.limit} limit). ` +
      `The call was throttled to protect host resources.`,
    gasBudget: {
      toolName,
      usedCost: trip.usedCost,
      limit: trip.limit,
      retryAfterSeconds: Math.ceil(trip.resetInMs / 1000),
    },
    hint:
      'Too many computationally intensive operations (decompilations, memory scans, symbolic execution) ' +
      'were triggered in a short interval. Back off and consolidate your analysis plan.',
  });
}

/**
 * Build the isomorphic loop error response (mutated cosmetic arguments).
 */
export function buildIsomorphicLoopErrorResponse(
  toolName: string,
  trip: IsomorphicTrip,
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return buildGateErrorResponse({
    error:
      `Isomorphic call loop detected: tool "${toolName}" has been called ${trip.count} consecutive times ` +
      `with semantically identical arguments (threshold: ${trip.threshold}). The call was blocked.`,
    isomorphicLoop: {
      toolName,
      consecutiveCount: trip.count,
      threshold: trip.threshold,
    },
    hint:
      'Trivial modifications to comments, timestamps, or request IDs do not alter the outcome. ' +
      'Stop repeating this operation and switch to a different analysis strategy.',
  });
}

/* ── Doom-loop per-session state ──
 *
 * Carrier: the ToolCallContextGuard instance itself (see recordDoomLoopCall
 * below), reusing the same per-session Map pattern as `repeatStates`. The
 * guard instance is per server context, so doom counters are isolated per
 * context and garbage-collected with it; per-MCP-client-session scoping uses
 * the same ToolRequestContext sessionId key as repeat detection.
 */

/* ================================================================== */
/*  Shared gate entry for the meta-tool paths                          */
/*                                                                     */
/*  The domain-tool path composes its gate inline in                   */
/*  MCPServer.execution.ts (checkToolExecutionGate). The meta tools     */
/*  (search_tools, activate_tools, ..., call_tool) bypass that path    */
/*  twice: once at their direct registration wrapper and once when     */
/*  call_tool dispatches them. Both entry points call the single       */
/*  runToolExecutionGate below, which composes the SAME single-source  */
/*  pieces (compileToolRules / evaluateToolRules / recordDoomLoopCall  */
/*  / response builders) so rule evaluation is never duplicated.       */
/* ================================================================== */

/** Minimal structural surface of MCPServerContext that the gate needs. */
export interface ToolExecutionGateHost {
  /**
   * Server config. `toolExecution` may be absent entirely (partial test
   * configs) — a missing section behaves exactly as before the gate existed
   * (allow all).
   */
  config?: { toolExecution?: ToolExecutionConfig };
  /** Event bus for deny telemetry. Absent/mock buses are tolerated (no-op). */
  eventBus?: EventBus<ServerEventMap> | undefined | null;
  /**
   * Doom-loop tracker. Optional so partial test contexts can exercise the
   * rule gate without a guard instance; production contexts always carry one.
   */
  contextGuard?: Pick<ToolCallContextGuard, 'recordDoomLoopCall'>;
}

export interface ToolExecutionGateOptions {
  /**
   * Whether this call participates in doom-loop accounting (default true).
   * Proxy-style callers whose dispatched target is gated separately must opt
   * out: recording call_tool's own key between the dispatched target's
   * records would reset the inner streak on every physical call (the doom
   * tracker keeps a single lastKey slot per session) and defeat accumulation
   * entirely. call_tool's loop protection is carried by the dispatched name
   * instead — executeToolWithTracking for domain tools, the dispatch gate
   * for meta tools.
   */
  recordDoomLoop?: boolean;
}

/** Gate-blocked response shape — identical to the domain-path gate responses. */
export type ToolGateBlockedResponse = ReturnType<typeof buildToolGateDenyResponse>;

/**
 * Resolve the MCP session id attached to a gate telemetry event: explicit
 * `_meta.sessionId` wins over the per-request AsyncLocalStorage scope.
 */
function resolveGateSessionId(args: Record<string, unknown>): string | null {
  const explicit = (args['_meta'] as { sessionId?: unknown } | undefined)?.sessionId;
  if (typeof explicit === 'string' && explicit.trim().length > 0) return explicit.trim();
  return getToolRequestContext()?.sessionId ?? null;
}

/**
 * Tool-execution permission gate shared by the meta-tool entry points:
 * ordered rules from config.toolExecution (legacy allowTools whitelist
 * compiled as leading allow rules, last matching rule wins) followed by the
 * doom-loop circuit breaker. Deny/doom telemetry mirrors the domain path.
 *
 * Returns the immediate error response, or null when the call may proceed.
 */
export function runToolExecutionGate(
  host: ToolExecutionGateHost,
  toolName: string,
  args: Record<string, unknown>,
  options: ToolExecutionGateOptions = {},
): ToolGateBlockedResponse | null {
  const argsJson = stableSerializeArgs(args);
  const toolExecution = host.config?.toolExecution;
  const compiledRules = compileToolRules(
    toolExecution?.allowTools ?? [],
    toolExecution?.rules ?? [],
  );
  const decision = evaluateToolRules(compiledRules, toolName, argsJson);
  if (!decision.allowed && decision.matchedRule) {
    // Metadata-only deny telemetry (rule is static config, never runtime args).
    emitBusEvent(host.eventBus, 'tool.gate.denied', {
      toolName,
      source: decision.matchedRule.source ?? 'rules',
      rule: {
        tool: decision.matchedRule.tool,
        ...(decision.matchedRule.pattern !== undefined
          ? { pattern: decision.matchedRule.pattern }
          : {}),
        action: decision.matchedRule.action,
      },
      sessionId: resolveGateSessionId(args),
      timestamp: new Date().toISOString(),
    });
    return buildToolGateDenyResponse(toolName, decision.matchedRule, compiledRules);
  }
  if (options.recordDoomLoop === false) return null;
  const trip = host.contextGuard?.recordDoomLoopCall(toolName, argsJson, MCP_DOOM_LOOP_THRESHOLD);
  if (trip) {
    emitBusEvent(host.eventBus, 'tool.gate.denied', {
      toolName,
      source: 'doom-loop',
      rule: null,
      consecutiveCount: trip.count,
      threshold: trip.threshold,
      sessionId: resolveGateSessionId(args),
      timestamp: new Date().toISOString(),
    });
    return buildDoomLoopErrorResponse(toolName, argsJson, trip);
  }
  return null;
}
