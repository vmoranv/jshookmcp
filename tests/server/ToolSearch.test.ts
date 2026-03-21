import { describe, it, expect } from 'vitest';
import { ToolSearchEngine } from '@server/ToolSearch';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/* ---------- helper ---------- */

function makeTool(name: string, description: string): Tool {
  return {
    name,
    description,
    inputSchema: { type: 'object' as const, properties: {} },
  };
}

/* ---------- tests ---------- */

describe('ToolSearchEngine', () => {
  const testTools: Tool[] = [
    makeTool('page_navigate', 'Navigate to a URL in the browser tab'),
    makeTool('debugger_pause', 'Pause JavaScript execution at the current point'),
    makeTool('breakpoint_set', 'Set a breakpoint at a specific line in a script'),
    makeTool('network_get_requests', 'Get captured network requests with filtering options'),
    makeTool('ws_monitor_enable', 'Enable WebSocket frame monitoring'),
    makeTool('wasm_dump', 'Dump WebAssembly module binary from page memory'),
    makeTool('binary_decode', 'Decode binary data from various formats (base64, hex, etc.)'),
    makeTool('captcha_detect', 'Detect CAPTCHA challenges on the current page'),
    makeTool('antidebug_bypass_all', 'Bypass all detected anti-debugging protections'),
    makeTool('page_screenshot', 'Take a screenshot of the current page'),
  ];

  it('finds exact name matches with high score', async () => {
    const engine = new ToolSearchEngine(testTools);
    const results = await engine.search('page_navigate');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('page_navigate');
  });

  it('finds tools by description keywords', async () => {
    const engine = new ToolSearchEngine(testTools);
    const results = await engine.search('breakpoint');
    const names = results.map((r) => r.name);
    expect(names).toContain('breakpoint_set');
  });

  it('finds tools by partial name (prefix match)', async () => {
    const engine = new ToolSearchEngine(testTools);
    const results = await engine.search('debug');
    const names = results.map((r) => r.name);
    expect(names).toContain('debugger_pause');
  });

  it('returns empty for nonsense query', async () => {
    const engine = new ToolSearchEngine(testTools);
    const results = await engine.search('xyzzy12345');
    expect(results.length).toBe(0);
  });

  it('respects top_k limit', async () => {
    const engine = new ToolSearchEngine(testTools);
    const results = await engine.search('page', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('multi-word queries combine scores', async () => {
    const engine = new ToolSearchEngine(testTools);
    const results = await engine.search('websocket monitor');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('ws_monitor_enable');
  });

  it('marks active tools correctly', async () => {
    const engine = new ToolSearchEngine(testTools);
    const activeNames = new Set(['page_navigate']);
    const results = await engine.search('page', 5, activeNames);
    const navResult = results.find((r) => r.name === 'page_navigate');
    const ssResult = results.find((r) => r.name === 'page_screenshot');
    expect(navResult?.isActive).toBe(true);
    expect(ssResult?.isActive).toBe(false);
  });

  it('results include shortDescription', async () => {
    const engine = new ToolSearchEngine(testTools);
    const results = await engine.search('captcha');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.shortDescription).toBeTruthy();
    expect(results[0]!.shortDescription.length).toBeGreaterThan(0);
  });

  it('getDomainSummary returns domain breakdown', () => {
    const engine = new ToolSearchEngine(testTools);
    const summary = engine.getDomainSummary();
    expect(summary.length).toBeGreaterThan(0);
    // All our test tools have null domain since they're custom (not in ToolCatalog)
    const totalTools = summary.reduce((acc, s) => acc + s.count, 0);
    expect(totalTools).toBe(testTools.length);
  });

  it('searches against real allTools catalog', async () => {
    // Use the default constructor which loads allTools
    const engine = new ToolSearchEngine();
    const results = await engine.search('breakpoint');
    expect(results.length).toBeGreaterThan(0);
    // Should find tools like breakpoint_set, breakpoint_remove, breakpoint_list
    const names = results.map((r) => r.name);
    expect(names).toContain('breakpoint_set');
    expect(names).toContain('breakpoint_remove');
    expect(names).toContain('breakpoint_list');
  });

  it('handles empty query gracefully', async () => {
    const engine = new ToolSearchEngine(testTools);
    const results = await engine.search('');
    expect(results).toEqual([]);
  });

  it('scores name matches higher than description matches', async () => {
    const engine = new ToolSearchEngine(testTools);
    const results = await engine.search('wasm');
    // wasm_dump should score higher than anything that just mentions wasm in description
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('wasm_dump');
  });

  it('applies domain score multipliers for workflow-biased ranking', async () => {
    const rankedTools: Tool[] = [
      makeTool('browser_flow_helper', 'Execute a reusable flow helper'),
      makeTool('workflow_flow_helper', 'Execute a reusable flow helper'),
    ];
    const domainOverrides = new Map<string, string>([
      ['browser_flow_helper', 'browser'],
      ['workflow_flow_helper', 'workflow'],
    ]);
    const domainScoreMultipliers = new Map<string, number>([['workflow', 1.5]]);

    const engine = new ToolSearchEngine(rankedTools, domainOverrides, domainScoreMultipliers);
    const results = await engine.search('execute reusable flow');

    expect(results.length).toBeGreaterThan(1);
    expect(results[0]!.name).toBe('workflow_flow_helper');
  });

  it('expands Chinese workflow intent terms for API capture queries', async () => {
    const rankedTools: Tool[] = [
      makeTool('web_api_capture_session', 'Capture API requests and export HAR in one workflow'),
      makeTool('page_navigate', 'Navigate to a URL in the browser tab'),
    ];
    const domainOverrides = new Map<string, string>([
      ['web_api_capture_session', 'workflow'],
      ['page_navigate', 'browser'],
    ]);
    const domainScoreMultipliers = new Map<string, number>([['workflow', 1.5]]);
    const engine = new ToolSearchEngine(rankedTools, domainOverrides, domainScoreMultipliers);
    const results = await engine.search('抓取接口');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('web_api_capture_session');
  });

  it('expands Chinese registration intent for workflow onboarding tools', async () => {
    const rankedTools: Tool[] = [
      makeTool('register_account_flow', 'Automate account registration with email verification'),
      makeTool('page_type', 'Type text into an input field'),
    ];
    const domainOverrides = new Map<string, string>([
      ['register_account_flow', 'workflow'],
      ['page_type', 'browser'],
    ]);
    const domainScoreMultipliers = new Map<string, number>([['workflow', 1.5]]);
    const engine = new ToolSearchEngine(rankedTools, domainOverrides, domainScoreMultipliers);
    const results = await engine.search('账号注册验证');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('register_account_flow');
  });

  it('applies explicit intent-to-tool boosts for zero-overlap intent phrases', async () => {
    const rankedTools: Tool[] = [
      makeTool('web_api_capture_session', 'Composite flow helper without API keywords'),
      makeTool('api_probe_batch', 'Composite flow helper without probe keywords'),
      makeTool('page_navigate', 'Navigate to a URL in the browser tab'),
    ];
    const domainOverrides = new Map<string, string>([
      ['web_api_capture_session', 'workflow'],
      ['api_probe_batch', 'workflow'],
      ['page_navigate', 'browser'],
    ]);
    const domainScoreMultipliers = new Map<string, number>([['workflow', 1.5]]);
    const engine = new ToolSearchEngine(rankedTools, domainOverrides, domainScoreMultipliers);
    const results = await engine.search('端到端闭环');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('web_api_capture_session');
    expect(results.some((r) => r.name === 'api_probe_batch')).toBe(true);
  });

  it('applies tool score multipliers for extension-priority ranking', async () => {
    const rankedTools: Tool[] = [
      makeTool('builtin_flow_search', 'Inspect flow details and capture outputs'),
      makeTool('plugin_flow_search', 'Inspect flow details and capture outputs'),
    ];
    const toolScoreMultipliers = new Map<string, number>([['plugin_flow_search', 1.12]]);

    const engine = new ToolSearchEngine(rankedTools, undefined, undefined, toolScoreMultipliers);
    const results = await engine.search('inspect flow capture');

    expect(results.length).toBeGreaterThan(1);
    expect(results[0]!.name).toBe('plugin_flow_search');
  });

  it('prioritizes workflow entry tools for register/captcha/keygen intent', async () => {
    const rankedTools: Tool[] = [
      makeTool('run_extension_workflow', 'Execute extension workflow by workflowId'),
      makeTool('list_extension_workflows', 'List loaded extension workflows'),
      makeTool('register_account_flow', 'Automate account registration flow'),
      makeTool('page_type', 'Type text into an input field'),
    ];
    const domainOverrides = new Map<string, string>([
      ['run_extension_workflow', 'workflow'],
      ['list_extension_workflows', 'workflow'],
      ['register_account_flow', 'workflow'],
      ['page_type', 'browser'],
    ]);
    const domainScoreMultipliers = new Map<string, number>([['workflow', 1.5]]);
    const engine = new ToolSearchEngine(rankedTools, domainOverrides, domainScoreMultipliers);
    const results = await engine.search('账号注册 验证码 keygen');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('run_extension_workflow');
    expect(results.some((r) => r.name === 'list_extension_workflows')).toBe(true);
  });

  /* ---------- GraphBoost-inspired enhancements ---------- */

  describe('TF-IDF cosine hybrid scoring (§4.1.3)', () => {
    it('boosts semantically aligned results via TF-IDF cosine', async () => {
      const tools: Tool[] = [
        makeTool('network_capture', 'Capture and inspect HTTP network requests and responses'),
        makeTool('page_click', 'Click an element on the page'),
        makeTool('network_replay', 'Replay captured HTTP network requests for testing'),
      ];
      const engine = new ToolSearchEngine(tools);
      // "capture network requests" has high cosine with network_capture
      const results = await engine.search('capture network requests');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.name).toBe('network_capture');
      // network_replay should also rank due to shared terms
      expect(results.some((r) => r.name === 'network_replay')).toBe(true);
    });

    it('cosine boost does not harm unrelated tools (no false positives)', async () => {
      const tools: Tool[] = [
        makeTool('wasm_dump', 'Dump WebAssembly module binary'),
        makeTool('page_navigate', 'Navigate to a URL'),
      ];
      const engine = new ToolSearchEngine(tools);
      const results = await engine.search('wasm binary module');
      expect(results[0]!.name).toBe('wasm_dump');
    });
  });

  describe('tool affinity graph (§4.1.4)', () => {
    it('boosts prefix-group neighbors of top results', async () => {
      const tools: Tool[] = [
        makeTool('breakpoint_set', 'Set a breakpoint at a line'),
        makeTool('breakpoint_list', 'List all active breakpoints'),
        makeTool('breakpoint_remove', 'Remove a breakpoint'),
        makeTool('page_navigate', 'Navigate to a URL'),
      ];
      const engine = new ToolSearchEngine(tools);
      const results = await engine.search('set breakpoint');
      const names = results.map((r) => r.name);
      // breakpoint_set should be first
      expect(names[0]).toBe('breakpoint_set');
      // affinity should surface breakpoint_list and breakpoint_remove
      expect(names).toContain('breakpoint_list');
      expect(names).toContain('breakpoint_remove');
    });

    it('prefix affinity decays for larger groups', async () => {
      // Create a group of 10 tools with same prefix
      const tools: Tool[] = Array.from({ length: 10 }, (_, i) =>
        makeTool(`test_tool_${i}`, `Test tool number ${i} for general testing`)
      );
      tools.push(makeTool('other_thing', 'Something completely different'));
      const engine = new ToolSearchEngine(tools);
      const results = await engine.search('test tool 0');
      // Should still find test_tool_0 first
      expect(results[0]!.name).toBe('test_tool_0');
    });
  });

  describe('domain hub expansion (§4.1.4)', () => {
    it('applies coherence boost when domain is concentrated in top results', async () => {
      const tools: Tool[] = [
        makeTool('debug_pause', 'Pause execution'),
        makeTool('debug_eval', 'Evaluate expression in paused context'),
        makeTool('debug_step', 'Step over next statement'),
        makeTool('debug_resume', 'Resume execution after pause'),
        makeTool('page_navigate', 'Navigate to a URL'),
      ];
      const domainOverrides = new Map<string, string>([
        ['debug_pause', 'debugger'],
        ['debug_eval', 'debugger'],
        ['debug_step', 'debugger'],
        ['debug_resume', 'debugger'],
        ['page_navigate', 'browser'],
      ]);
      const engine = new ToolSearchEngine(tools, domainOverrides);
      const results = await engine.search('debug pause eval step');
      // When debug tools dominate results, debug_resume should get hub boost
      const names = results.map((r) => r.name);
      expect(names).toContain('debug_resume');
    });
  });

  describe('query category adaptive weights (§4.1.3)', () => {
    it('boosts security domain tools for security-related queries', async () => {
      const tools: Tool[] = [
        makeTool('sec_scan', 'Scan for security vulnerabilities'),
        makeTool('page_scan', 'Scan page for elements'),
      ];
      const domainOverrides = new Map<string, string>([
        ['sec_scan', 'security'],
        ['page_scan', 'browser'],
      ]);
      const engine = new ToolSearchEngine(tools, domainOverrides);
      const results = await engine.search('scan for xss vulnerability');
      expect(results[0]!.name).toBe('sec_scan');
    });

    it('boosts debugger domain tools for debug-related queries', async () => {
      const tools: Tool[] = [
        makeTool('dbg_helper', 'Helper for debugging sessions'),
        makeTool('page_helper', 'Helper for page interaction'),
      ];
      const domainOverrides = new Map<string, string>([
        ['dbg_helper', 'debugger'],
        ['page_helper', 'browser'],
      ]);
      const engine = new ToolSearchEngine(tools, domainOverrides);
      const results = await engine.search('debug breakpoint helper');
      expect(results[0]!.name).toBe('dbg_helper');
    });

    it('boosts network domain tools for network-related queries', async () => {
      const tools: Tool[] = [
        makeTool('net_inspect', 'Inspect network traffic details'),
        makeTool('code_inspect', 'Inspect source code structure'),
      ];
      const domainOverrides = new Map<string, string>([
        ['net_inspect', 'network'],
        ['code_inspect', 'analysis'],
      ]);
      const engine = new ToolSearchEngine(tools, domainOverrides);
      const results = await engine.search('inspect request response headers');
      expect(results[0]!.name).toBe('net_inspect');
    });
  });

  describe('query result LRU cache (§4.3 CSAPC)', () => {
    it('returns cached results for identical queries', async () => {
      const engine = new ToolSearchEngine(testTools);
      const first = await engine.search('page navigate');
      const second = await engine.search('page navigate');
      // Same query should return equivalent results
      expect(first.map((r) => r.name)).toEqual(second.map((r) => r.name));
      expect(first.map((r) => r.score)).toEqual(second.map((r) => r.score));
    });

    it('updates isActive on cache hit without re-scoring', async () => {
      const engine = new ToolSearchEngine(testTools);
      const first = await engine.search('page navigate', 5, new Set<string>());
      const second = await engine.search('page navigate', 5, new Set(['page_navigate']));
      // Scores should be identical
      expect(first.map((r) => r.score)).toEqual(second.map((r) => r.score));
      // But isActive should differ
      const navFirst = first.find((r) => r.name === 'page_navigate');
      const navSecond = second.find((r) => r.name === 'page_navigate');
      expect(navFirst?.isActive).toBe(false);
      expect(navSecond?.isActive).toBe(true);
    });

    it('does not confuse different queries', async () => {
      const engine = new ToolSearchEngine(testTools);
      const wasm = await engine.search('wasm dump');
      const captcha = await engine.search('captcha detect');
      expect(wasm[0]!.name).toBe('wasm_dump');
      expect(captcha[0]!.name).toBe('captcha_detect');
    });
  });
});
