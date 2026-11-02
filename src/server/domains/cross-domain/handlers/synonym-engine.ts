/**
 * Lightweight synonym engine for cross-domain tool routing.
 *
 * Maps natural-language queries to tool recommendations using a pure-TS
 * synonym graph. No LLM — the graph is built from curated domain-concept →
 * tool-name mappings. Works alongside the existing keyword-scoring
 * `CrossDomainWorkflowClassifier` but operates at the individual-tool level
 * rather than the workflow level.
 *
 * Design:
 * 1. A synonym group links a concept (e.g. "hook", "intercept", "trap") to
 *    a set of tools that implement or inspect that concept.
 * 2. Tokenized query words are expanded to their synonym groups.
 * 3. Tools are scored by match count + confidence weight.
 */

export interface SynonymGroup {
  /** Canonical concept name. */
  concept: string;
  /** Normalized keywords that trigger this concept. */
  synonyms: string[];
  /** Tool names that implement/inspect this concept. */
  tools: string[];
  /** Confidence weight for this synonym mapping (0-1). Higher = more reliable. */
  confidence: number;
  /** Short description shown to the user when this concept is suggested. */
  description: string;
}

export interface SynonymMatchResult {
  concept: string;
  description: string;
  confidence: number;
  matchedTokens: string[];
  recommendedTools: string[];
  score: number;
}

/** Tokenize a query into normalized lower-case words. */
function tokenize(query: string): Set<string> {
  return new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9+#._-]+/i)
      .filter((t) => t.length > 1),
  );
}

// ── Synonym graph ──

const SYNONYM_GROUPS: SynonymGroup[] = [
  {
    concept: 'hook-intercept',
    synonyms: ['hook', 'intercept', 'trap', 'monitor', 'capture', 'sniff', '拦截', 'hook'],
    tools: [
      'manage_hooks',
      'console_inject',
      'network_intercept',
      'breakpoint',
      'script_replace_persist',
    ],
    confidence: 0.9,
    description: 'Hook, intercept, or trap function calls, network requests, or script execution',
  },
  {
    concept: 'deobfuscation',
    synonyms: [
      'deobfuscate',
      'unpack',
      'decode',
      'decrypt',
      'unobfuscate',
      'unminify',
      'antiobfuscation',
    ],
    tools: [
      'deobfuscate',
      'webcrack_unpack',
      'analysis_decode_string_array',
      'analysis_deflat_control_flow',
      'js_deobfuscate_pipeline',
    ],
    confidence: 0.95,
    description: 'Deobfuscate, unpack, or decode obfuscated JavaScript',
  },
  {
    concept: 'network-analysis',
    synonyms: [
      'network',
      'http',
      'request',
      'response',
      'fetch',
      'xhr',
      'api',
      'traffic',
      'har',
      'proxy',
    ],
    tools: [
      'network_enable',
      'network_get_requests',
      'network_intercept',
      'network_export_har',
      'api_probe_batch',
      'proxy_add_rule',
    ],
    confidence: 0.9,
    description: 'Analyze, intercept, or export network traffic and API calls',
  },
  {
    concept: 'memory-heap',
    synonyms: ['memory', 'heap', 'leak', 'allocation', 'retained', 'object', 'gc', 'snapshot'],
    tools: [
      'v8_heap_snapshot_capture',
      'v8_heap_snapshot_analyze',
      'v8_heap_find_leaks',
      'v8_heap_diff',
      'v8_function_retained',
    ],
    confidence: 0.9,
    description: 'Inspect heap memory, find leaks, analyze object retention',
  },
  {
    concept: 'debugging',
    synonyms: ['debug', 'breakpoint', 'pause', 'step', 'stack', 'callstack', 'scope', 'inspect'],
    tools: [
      'breakpoint',
      'debugger_pause',
      'debugger_step',
      'get_call_stack',
      'get_scope_variables_enhanced',
      'debugger_evaluate',
    ],
    confidence: 0.95,
    description: 'Debug JavaScript execution, set breakpoints, inspect variables',
  },
  {
    concept: 'graphql',
    synonyms: ['graphql', 'introspection', 'schema', 'query', 'mutation', 'subscription'],
    tools: [
      'graphql_introspect',
      'graphql_enum_schema',
      'graphql_extract_queries',
      'graphql_replay',
    ],
    confidence: 0.95,
    description: 'Introspect, enumerate, or replay GraphQL APIs',
  },
  {
    concept: 'websocket',
    synonyms: ['websocket', 'ws', 'realtime', 'stream', 'sse', 'eventsource', 'push'],
    tools: [
      'ws_monitor',
      'ws_get_frames',
      'sse_monitor_enable',
      'sse_get_events',
      'webrtc_monitor',
    ],
    confidence: 0.9,
    description: 'Monitor WebSocket, SSE, or WebRTC real-time communication',
  },
  {
    concept: 'webgpu-shader',
    synonyms: ['webgpu', 'shader', 'gpu', 'compute', 'render', 'wgsl', 'spirv', 'pipeline'],
    tools: [
      'webgpu_shader_source_capture',
      'webgpu_shader_disassemble',
      'webgpu_pipeline_dump',
      'webgpu_capture_commands',
    ],
    confidence: 0.9,
    description: 'Capture, disassemble, or analyze WebGPU shaders and pipelines',
  },
  {
    concept: 'wasm',
    synonyms: ['wasm', 'webassembly', 'module', 'import', 'export', 'memory.grow'],
    tools: ['wasm_inspect', 'v8_wasm_inspect', 'wasm_diff'],
    confidence: 0.9,
    description: 'Inspect WebAssembly modules, compare versions, analyze imports',
  },
  {
    concept: 'protobuf-binary',
    synonyms: ['protobuf', 'proto', 'encode', 'decode', 'binary', 'message', 'serialize'],
    tools: ['protobuf_decode_raw', 'binary_decode', 'binary_encode', 'binary_detect_format'],
    confidence: 0.85,
    description: 'Decode protobuf, base64, or binary-encoded payloads',
  },
  {
    concept: 'trace-recording',
    synonyms: ['trace', 'record', 'replay', 'timeline', 'timestamp', 'seek'],
    tools: [
      'trace_recording',
      'start_trace_recording',
      'seek_to_timestamp',
      'summarize_trace',
      'export_trace',
    ],
    confidence: 0.9,
    description: 'Record, replay, or analyze execution traces',
  },
  {
    concept: 'v8-internals',
    synonyms: ['v8', 'bytecode', 'jit', 'turbofan', 'deoptimize', 'optimize', 'ignition'],
    tools: ['v8_bytecode_extract', 'v8_turbofan_inspect', 'v8_deopt_trace', 'debugger_disassemble'],
    confidence: 0.9,
    description: 'Inspect V8 internals: bytecode, JIT, deoptimization',
  },
  {
    concept: 'crypto-detection',
    synonyms: ['crypto', 'encrypt', 'decrypt', 'hash', 'hmac', 'sign', 'aes', 'rsa', 'sha'],
    tools: ['detect_crypto', 'binary_entropy_analysis', 'analysis_security_scan'],
    confidence: 0.85,
    description: 'Detect cryptographic operations, analyze entropy, scan for secrets',
  },
  {
    concept: 'canvas-skia',
    synonyms: ['canvas', 'skia', 'render', 'draw', 'paint', 'image', 'texture', 'font'],
    tools: [
      'skia_extract_scene',
      'skia_correlate_objects',
      'canvas_scene_dump',
      'skia_detect_renderer',
    ],
    confidence: 0.9,
    description: 'Extract and analyze Skia/Canvas rendering scenes',
  },
  {
    concept: 'storage',
    synonyms: [
      'storage',
      'cookie',
      'localstorage',
      'sessionstorage',
      'indexeddb',
      'cache',
      'database',
    ],
    tools: [
      'page_cookies',
      'page_local_storage',
      'page_session_storage',
      'indexeddb_dump',
      'page_storage_info',
    ],
    confidence: 0.85,
    description: 'Read, write, or inspect browser storage (cookies, localStorage, IndexedDB)',
  },
  {
    concept: 'cross-domain-correlation',
    synonyms: ['correlate', 'evidence', 'cross', 'bridge', 'link', 'chain', 'multi-domain'],
    tools: [
      'cross_domain_correlate_all',
      'cross_domain_evidence_query',
      'cross_domain_evidence_stats',
    ],
    confidence: 0.9,
    description: 'Correlate evidence across domains, query the shared evidence graph',
  },
  {
    concept: 'mojo-ipc',
    synonyms: ['mojo', 'ipc', 'message', 'interface', 'channel', 'interprocess'],
    // Renamed at the registry: `mojo_send_message` -> `mojo_encode_message`,
    // `mojo_get_messages` -> `mojo_messages_get`, `mojo_intercept` -> `mojo_monitor`.
    // `node scripts/audit-domain-integrity.mjs` now fails if this list drifts again.
    tools: ['mojo_encode_message', 'mojo_messages_get', 'mojo_monitor'],
    confidence: 0.9,
    description: 'Encode, capture, or monitor Mojo IPC messages',
  },
  {
    concept: 'binary-analysis',
    synonyms: ['binary', 'native', 'frida', 'ghidra', 'hook', 'instrument', 'unidbg', 'emulate'],
    // `native_emulator_launch` was renamed to `nemu_create_session`; the
    // `native-emulator` domain exposes its whole surface under the `nemu_` prefix.
    tools: ['ghidra_analyze', 'generate_hooks', 'nemu_create_session', 'binary_decode'],
    confidence: 0.85,
    description: 'Analyze native binaries, generate hooks, emulate ARM64',
  },
  {
    concept: 'syscall',
    synonyms: ['syscall', 'systemcall', 'kernel', 'process', 'file', 'registry'],
    // `syscall_get_events` was renamed to `syscall_capture_events`.
    tools: [
      'syscall_start_monitor',
      'syscall_stop_monitor',
      'syscall_capture_events',
      'syscall_correlate_js',
    ],
    confidence: 0.9,
    description: 'Monitor, capture, or correlate system calls',
  },
  {
    concept: 'obfuscation-detection',
    synonyms: [
      'obfuscation',
      'packed',
      'vm',
      'virtualization',
      'protector',
      '混淆',
      'jscrambler',
      'javascript-obfuscator',
    ],
    tools: ['detect_obfuscation', 'js_analyze_vm', 'deobfuscate', 'detect_crypto'],
    confidence: 0.85,
    description: 'Detect obfuscation techniques, analyze VM-based protection',
  },
];

/**
 * Match a natural-language query against the synonym graph and return
 * ranked concept→tool recommendations.
 *
 * @param query Natural language query (e.g. "find where the app signs HTTP requests")
 * @param maxResults Maximum results to return (default 10)
 * @returns Ranked synonym matches
 */
export function querySynonyms(query: string, maxResults = 10): SynonymMatchResult[] {
  if (!query || query.trim().length === 0) return [];

  const tokens = tokenize(query);
  const results: SynonymMatchResult[] = [];

  for (const group of SYNONYM_GROUPS) {
    const matchedTokens: string[] = [];
    for (const token of tokens) {
      // Direct match against synonyms
      if (group.synonyms.some((s) => s === token)) {
        matchedTokens.push(token);
        continue;
      }
      // Substring match for longer synonyms (e.g. "deobfuscate" matches "obfuscation")
      for (const syn of group.synonyms) {
        if (syn.length >= 4 && token.length >= 4 && (syn.includes(token) || token.includes(syn))) {
          matchedTokens.push(token);
          break;
        }
      }
    }

    if (matchedTokens.length > 0) {
      // Score = distinct matched tokens × confidence
      const uniqueTokens = [...new Set(matchedTokens)];
      const score = uniqueTokens.length * group.confidence;
      results.push({
        concept: group.concept,
        description: group.description,
        confidence: group.confidence,
        matchedTokens: uniqueTokens,
        recommendedTools: group.tools,
        score: Number(score.toFixed(3)),
      });
    }
  }

  // Sort by score descending, then by matched token count
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.matchedTokens.length - a.matchedTokens.length;
  });

  return results.slice(0, maxResults);
}

/**
 * Return the raw synonym graph.
 *
 * Exists so `scripts/audit-domain-integrity.mjs` can assert that every tool
 * name in the graph is still registered. This list has already rotted once:
 * three `mojo_*` tools, `native_emulator_launch` and `syscall_get_events` were
 * renamed upstream while the graph kept recommending the old names, so
 * `cross_domain_synonyms` answered with tools that could not be called.
 */
export function getSynonymGraphGroups(): readonly SynonymGroup[] {
  return SYNONYM_GROUPS;
}

/**
 * Return the full synonym graph metadata (for inspection/debugging).
 */
export function getSynonymGraphMeta(): {
  conceptCount: number;
  totalToolReferences: number;
  concepts: Array<{ concept: string; synonymCount: number; toolCount: number }>;
} {
  return {
    conceptCount: SYNONYM_GROUPS.length,
    totalToolReferences: SYNONYM_GROUPS.reduce((sum, g) => sum + g.tools.length, 0),
    concepts: SYNONYM_GROUPS.map((g) => ({
      concept: g.concept,
      synonymCount: g.synonyms.length,
      toolCount: g.tools.length,
    })),
  };
}
