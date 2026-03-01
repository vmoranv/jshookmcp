import { describe, it, expect } from 'vitest';
import { ToolSearchEngine, type ToolSearchResult } from '../../src/server/ToolSearch.js';
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
});
