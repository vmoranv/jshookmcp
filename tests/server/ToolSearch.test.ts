import { describe, it, expect } from 'vitest';
import { ToolSearchEngine, type ToolSearchResult } from '@server/ToolSearch';
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

  it('finds exact name matches with high score', () => {
    const engine = new ToolSearchEngine(testTools);
    const results = engine.search('page_navigate');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('page_navigate');
  });

  it('finds tools by description keywords', () => {
    const engine = new ToolSearchEngine(testTools);
    const results = engine.search('breakpoint');
    const names = results.map((r) => r.name);
    expect(names).toContain('breakpoint_set');
  });

  it('finds tools by partial name (prefix match)', () => {
    const engine = new ToolSearchEngine(testTools);
    const results = engine.search('debug');
    const names = results.map((r) => r.name);
    expect(names).toContain('debugger_pause');
  });

  it('returns empty for nonsense query', () => {
    const engine = new ToolSearchEngine(testTools);
    const results = engine.search('xyzzy12345');
    expect(results.length).toBe(0);
  });

  it('respects top_k limit', () => {
    const engine = new ToolSearchEngine(testTools);
    const results = engine.search('page', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('multi-word queries combine scores', () => {
    const engine = new ToolSearchEngine(testTools);
    const results = engine.search('websocket monitor');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('ws_monitor_enable');
  });

  it('marks active tools correctly', () => {
    const engine = new ToolSearchEngine(testTools);
    const activeNames = new Set(['page_navigate']);
    const results = engine.search('page', 5, activeNames);
    const navResult = results.find((r) => r.name === 'page_navigate');
    const ssResult = results.find((r) => r.name === 'page_screenshot');
    expect(navResult?.isActive).toBe(true);
    expect(ssResult?.isActive).toBe(false);
  });

  it('results include shortDescription', () => {
    const engine = new ToolSearchEngine(testTools);
    const results = engine.search('captcha');
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

  it('searches against real allTools catalog', () => {
    // Use the default constructor which loads allTools
    const engine = new ToolSearchEngine();
    const results = engine.search('breakpoint');
    expect(results.length).toBeGreaterThan(0);
    // Should find tools like breakpoint_set, breakpoint_remove, breakpoint_list
    const names = results.map((r) => r.name);
    expect(names).toContain('breakpoint_set');
    expect(names).toContain('breakpoint_remove');
    expect(names).toContain('breakpoint_list');
  });

  it('handles empty query gracefully', () => {
    const engine = new ToolSearchEngine(testTools);
    const results = engine.search('');
    expect(results).toEqual([]);
  });

  it('scores name matches higher than description matches', () => {
    const engine = new ToolSearchEngine(testTools);
    const results = engine.search('wasm');
    // wasm_dump should score higher than anything that just mentions wasm in description
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('wasm_dump');
  });

  it('applies domain score multipliers for workflow-biased ranking', () => {
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
    const results = engine.search('execute reusable flow');

    expect(results.length).toBeGreaterThan(1);
    expect(results[0]!.name).toBe('workflow_flow_helper');
  });

  it('expands Chinese workflow intent terms for API capture queries', () => {
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
    const results = engine.search('抓取接口');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('web_api_capture_session');
  });

  it('expands Chinese registration intent for workflow onboarding tools', () => {
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
    const results = engine.search('账号注册验证');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('register_account_flow');
  });

  it('applies explicit intent-to-tool boosts for zero-overlap intent phrases', () => {
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
    const results = engine.search('端到端闭环');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('web_api_capture_session');
    expect(results.some((r) => r.name === 'api_probe_batch')).toBe(true);
  });

  it('applies tool score multipliers for extension-priority ranking', () => {
    const rankedTools: Tool[] = [
      makeTool('builtin_flow_search', 'Inspect flow details and capture outputs'),
      makeTool('plugin_flow_search', 'Inspect flow details and capture outputs'),
    ];
    const toolScoreMultipliers = new Map<string, number>([['plugin_flow_search', 1.12]]);

    const engine = new ToolSearchEngine(rankedTools, undefined, undefined, toolScoreMultipliers);
    const results = engine.search('inspect flow capture');

    expect(results.length).toBeGreaterThan(1);
    expect(results[0]!.name).toBe('plugin_flow_search');
  });

  it('prioritizes workflow entry tools for register/captcha/keygen intent', () => {
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
    const results = engine.search('账号注册 验证码 keygen');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('run_extension_workflow');
    expect(results.some((r) => r.name === 'list_extension_workflows')).toBe(true);
  });
});
