import { describe, expect, it } from 'vitest';
import { ReRanker, type ReRankInput, type ToolMetadata } from '@server/search/ReRanker';

function makeInput(overrides: Partial<ReRankInput> & { toolName: string }): ReRankInput {
  return {
    score: 1,
    domain: '',
    description: '',
    ...overrides,
  };
}

function makeToolMetadata(overrides: Partial<ToolMetadata> & { name: string }): ToolMetadata {
  return {
    domain: '',
    description: '',
    ...overrides,
  };
}

const SAMPLE_TOOLS: ToolMetadata[] = [
  makeToolMetadata({
    name: 'hook_install_fetch',
    domain: 'instrumentation',
    description: 'Install and intercept fetch requests with trap and patch',
  }),
  makeToolMetadata({
    name: 'hook_install_xhr',
    domain: 'instrumentation',
    description: 'Hook and intercept XMLHttpRequest calls',
  }),
  makeToolMetadata({
    name: 'network_monitor_capture',
    domain: 'network',
    description: 'Monitor capture sniff network requests and responses',
  }),
  makeToolMetadata({
    name: 'network_intercept_request',
    domain: 'network',
    description: 'Intercept and capture network request data',
  }),
  makeToolMetadata({
    name: 'debugger_breakpoint_pause',
    domain: 'debugger',
    description: 'Set breakpoint and pause execution for debug',
  }),
  makeToolMetadata({
    name: 'debugger_step_resume',
    domain: 'debugger',
    description: 'Step through code and resume from halt',
  }),
  makeToolMetadata({
    name: 'browser_navigate_page',
    domain: 'browser',
    description: 'Navigate to page URL and screenshot DOM evaluate',
  }),
  makeToolMetadata({
    name: 'browser_click_element',
    domain: 'browser',
    description: 'Click element on page DOM',
  }),
  makeToolMetadata({
    name: 'memory_scan_heap',
    domain: 'memory',
    description: 'Scan read write memory heap allocations',
  }),
  makeToolMetadata({
    name: 'process_spawn_exec',
    domain: 'process',
    description: 'Spawn process exec kill signal attach',
  }),
  makeToolMetadata({
    name: 'encoding_decode_base64',
    domain: 'encoding',
    description: 'Encode decode base64 hex URL encrypt decrypt',
  }),
  makeToolMetadata({
    name: 'trace_log_profile',
    domain: 'trace',
    description: 'Trace track log profile record execution',
  }),
  makeToolMetadata({
    name: 'analysis_deobfuscate_decode',
    domain: 'analysis',
    description: 'Analyze deobfuscate decode decompile beautify code',
  }),
  makeToolMetadata({
    name: 'workflow_pipeline_sequence',
    domain: 'workflow',
    description: 'Workflow sequence pipeline chain orchestrate tasks',
  }),
  makeToolMetadata({
    name: 'canvas_render_scene',
    domain: 'canvas',
    description: 'Canvas render draw scene fingerprint engine',
  }),
  makeToolMetadata({
    name: 'streaming_subscribe_event',
    domain: 'streaming',
    description: 'Stream subscribe event observable SSE websocket',
  }),
  makeToolMetadata({
    name: 'graphql_query_schema',
    domain: 'graphql',
    description: 'GraphQL query mutation subscription schema resolver',
  }),
  makeToolMetadata({
    name: 'transform_transpile_compile',
    domain: 'transform',
    description: 'Transform transpile compile minify bundle AST',
  }),
  makeToolMetadata({
    name: 'wasm_module_compile',
    domain: 'wasm',
    description: 'WASM webassembly module binary compile',
  }),
  makeToolMetadata({
    name: 'antidebug_detect_devtools',
    domain: 'debugger',
    description: 'Antidebug detect devtools anti protection bypass',
  }),
];

function makeReRankerWithSampleTools(
  weights?: Partial<{
    queryToolNameMatch: number;
    descriptionKeywordOverlap: number;
    domainRelevance: number;
    intentAlignment: number;
  }>,
): ReRanker {
  const reRanker = new ReRanker(weights);
  reRanker.buildFromTools(SAMPLE_TOOLS);
  return reRanker;
}

describe('search/ReRanker', () => {
  it('ranks exact tool name matches first', () => {
    const reRanker = makeReRankerWithSampleTools();
    const results: ReRankInput[] = [
      makeInput({
        toolName: 'page_navigate',
        score: 5,
        domain: 'browser',
        description: 'Navigate to a URL',
      }),
      makeInput({
        toolName: 'page_click',
        score: 4,
        domain: 'browser',
        description: 'Click an element',
      }),
      makeInput({
        toolName: 'debug_pause',
        score: 3,
        domain: 'debugger',
        description: 'Pause execution',
      }),
    ];

    const reRanked = reRanker.reRank('page_navigate', results);

    expect(reRanked[0]?.toolName).toBe('page_navigate');
  });

  it('ranks tools with higher keyword overlap above less relevant ones', () => {
    const reRanker = makeReRankerWithSampleTools();
    const results: ReRankInput[] = [
      makeInput({
        toolName: 'network_monitor',
        score: 2,
        domain: 'network',
        description: 'Monitor and capture network requests and responses',
      }),
      makeInput({
        toolName: 'memory_scan',
        score: 2,
        domain: 'memory',
        description: 'Scan process memory regions',
      }),
    ];

    const reRanked = reRanker.reRank('monitor capture network', results);

    expect(reRanked[0]?.toolName).toBe('network_monitor');
  });

  it('respects topK limit', () => {
    const reRanker = makeReRankerWithSampleTools();
    const results: ReRankInput[] = [
      makeInput({
        toolName: 'page_navigate',
        score: 5,
        domain: 'browser',
        description: 'Navigate',
      }),
      makeInput({ toolName: 'page_click', score: 4, domain: 'browser', description: 'Click' }),
      makeInput({ toolName: 'debug_pause', score: 3, domain: 'debugger', description: 'Pause' }),
    ];

    const reRanked = reRanker.reRank('page', results, 2);

    expect(reRanked).toHaveLength(2);
  });

  it('returns empty array for empty input', () => {
    const reRanker = new ReRanker();

    const reRanked = reRanker.reRank('hook', []);

    expect(reRanked).toEqual([]);
  });

  it('preserves original rank in output', () => {
    const reRanker = makeReRankerWithSampleTools();
    const results: ReRankInput[] = [
      makeInput({
        toolName: 'hook_intercept',
        score: 5,
        domain: 'instrumentation',
        description: 'Intercept function calls',
      }),
      makeInput({
        toolName: 'page_navigate',
        score: 4,
        domain: 'browser',
        description: 'Navigate',
      }),
    ];

    const reRanked = reRanker.reRank('hook intercept', results);

    expect(reRanked.find((r) => r.toolName === 'hook_intercept')?.originalRank).toBe(0);
    expect(reRanked.find((r) => r.toolName === 'page_navigate')?.originalRank).toBe(1);
  });

  it('boosts tools in relevant domain over irrelevant domain', () => {
    const reRanker = makeReRankerWithSampleTools();
    const results: ReRankInput[] = [
      makeInput({
        toolName: 'network_intercept',
        score: 2,
        domain: 'network',
        description: 'Intercept network traffic',
      }),
      makeInput({
        toolName: 'memory_intercept',
        score: 2,
        domain: 'memory',
        description: 'Intercept memory access',
      }),
    ];

    const reRanked = reRanker.reRank('intercept capture network', results);

    expect(reRanked[0]?.toolName).toBe('network_intercept');
  });

  it('uses custom weights when provided', () => {
    const reRanker = makeReRankerWithSampleTools({
      queryToolNameMatch: 1.0,
      descriptionKeywordOverlap: 0,
      domainRelevance: 0,
      intentAlignment: 0,
    });
    const results: ReRankInput[] = [
      makeInput({
        toolName: 'hook_install',
        score: 1,
        domain: 'instrumentation',
        description: 'Install a hook',
      }),
      makeInput({
        toolName: 'hook_remove',
        score: 1,
        domain: 'instrumentation',
        description: 'Remove a hook but has hook in description too',
      }),
    ];

    const reRanked = reRanker.reRank('hook_install', results);

    expect(reRanked[0]?.toolName).toBe('hook_install');
  });

  it('handles single result correctly', () => {
    const reRanker = makeReRankerWithSampleTools();
    const results: ReRankInput[] = [
      makeInput({
        toolName: 'page_navigate',
        score: 5,
        domain: 'browser',
        description: 'Navigate to URL',
      }),
    ];

    const reRanked = reRanker.reRank('navigate', results);

    expect(reRanked).toHaveLength(1);
    expect(reRanked[0]?.toolName).toBe('page_navigate');
  });

  it('preserves strong retrieval-score gaps: a clearly top-scored tool stays first even with weak lexical match', () => {
    const reRanker = makeReRankerWithSampleTools();
    const results: ReRankInput[] = [
      // High retrieval score but name/domain only loosely match the query.
      makeInput({
        toolName: 'network_capture_all',
        score: 50,
        domain: 'network',
        description: 'Capture all network traffic broadly',
      }),
      // Low retrieval score but a near-exact lexical match on the query.
      makeInput({
        toolName: 'unrelated_thing',
        score: 1,
        domain: 'misc',
        description: 'navigate navigate navigate navigate',
      }),
    ];

    const reRanked = reRanker.reRank('navigate', results);

    // The 50→1 retrieval gap normalises to 1.0 vs 0.0; with retrieval weight
    // 0.6 the gap should keep the strong-retrieval tool on top rather than
    // letting the 0.4 lexical signal flip the order purely on keyword count.
    expect(reRanked[0]?.toolName).toBe('network_capture_all');
  });

  it('respects equal retrieval scores: ties defer to lexical reRank score', () => {
    const reRanker = makeReRankerWithSampleTools();
    const results: ReRankInput[] = [
      makeInput({
        toolName: 'network_monitor_requests',
        score: 10,
        domain: 'network',
        description: 'Monitor network requests and responses',
      }),
      makeInput({
        toolName: 'memory_scan_allocations',
        score: 10,
        domain: 'memory',
        description: 'Scan memory allocation regions',
      }),
    ];

    const reRanked = reRanker.reRank('monitor capture network', results);

    // Equal retrieval scores → both normalise to 1.0 → ordering is driven
    // purely by the lexical reRank score (network monitor wins on overlap).
    expect(reRanked[0]?.toolName).toBe('network_monitor_requests');
  });

  it('rounds reRankedScore to 4 decimal places', () => {
    const reRanker = makeReRankerWithSampleTools();
    const results: ReRankInput[] = [
      makeInput({
        toolName: 'page_navigate',
        score: 1,
        domain: 'browser',
        description: 'Navigate',
      }),
    ];

    const reRanked = reRanker.reRank('navigate', results);

    const scoreStr = String(reRanked[0]?.reRankedScore);
    if (scoreStr.includes('.')) {
      const decimalPart = scoreStr.split('.')[1]!;
      expect(decimalPart.length).toBeLessThanOrEqual(4);
    }
  });

  it('buildFromTools extracts domain keywords from tool metadata', () => {
    const reRanker = new ReRanker();
    reRanker.buildFromTools([
      makeToolMetadata({
        name: 'hook_install_fetch',
        domain: 'instrumentation',
        description: 'Hook intercept fetch requests',
      }),
      makeToolMetadata({
        name: 'hook_remove_trap',
        domain: 'instrumentation',
        description: 'Remove hook trap intercept',
      }),
      makeToolMetadata({
        name: 'network_monitor_request',
        domain: 'network',
        description: 'Monitor network requests',
      }),
    ]);

    const results: ReRankInput[] = [
      makeInput({
        toolName: 'network_monitor_request',
        score: 2,
        domain: 'network',
        description: 'Monitor network requests',
      }),
      makeInput({
        toolName: 'hook_install_fetch',
        score: 2,
        domain: 'instrumentation',
        description: 'Hook intercept fetch',
      }),
    ];

    const reRanked = reRanker.reRank('hook intercept', results);

    expect(reRanked[0]?.toolName).toBe('hook_install_fetch');
  });

  it('reRank does not crash when no tools were provided via buildFromTools', () => {
    const reRanker = new ReRanker();
    const results: ReRankInput[] = [
      makeInput({
        toolName: 'page_navigate',
        score: 5,
        domain: 'browser',
        description: 'Navigate to a URL',
      }),
    ];

    const reRanked = reRanker.reRank('navigate', results);

    expect(reRanked).toHaveLength(1);
    expect(reRanked[0]?.toolName).toBe('page_navigate');
  });

  it('buildFromTools with empty array does not crash', () => {
    const reRanker = new ReRanker();
    reRanker.buildFromTools([]);

    const results: ReRankInput[] = [
      makeInput({
        toolName: 'page_navigate',
        score: 5,
        domain: 'browser',
        description: 'Navigate',
      }),
    ];

    const reRanked = reRanker.reRank('navigate', results);

    expect(reRanked).toHaveLength(1);
  });
});
