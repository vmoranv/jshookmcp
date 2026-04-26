export interface CrossDomainWorkflowStep {
  tool: string;
  args: Record<string, unknown>;
}

export interface CrossDomainWorkflowDefinition {
  id: string;
  displayName: string;
  steps: CrossDomainWorkflowStep[];
}

export const WORKFLOWS: Record<string, CrossDomainWorkflowDefinition> = {
  WORKFLOW_REVERSE_OBFUSCATED: {
    id: 'reverse-obfuscated-api',
    displayName: 'Reverse Obfuscated API',
    steps: [
      { tool: 'deobfuscate', args: { targetUrl: '${input.targetUrl}' } },
      { tool: 'js_heap_search', args: { pattern: '${previous.cryptoKeys}' } },
      { tool: 'network_enable', args: {} },
      { tool: 'tls_cert_pin_bypass', args: { target: '${input.target}' } },
      { tool: 'console_inject_fetch_interceptor', args: { urls: ['${input.apiEndpoint}'] } },
    ],
  },
  WORKFLOW_GAME_CANVAS_SKIA: {
    id: 'game-canvas-skia-v8',
    displayName: 'Game Canvas + SKIA + V8 Analysis',
    steps: [
      { tool: 'canvas_engine_fingerprint', args: { canvasId: '${input.canvasId}' } },
      { tool: 'canvas_scene_dump', args: { canvasId: '${input.canvasId}' } },
      { tool: 'skia_correlate_objects', args: { skiaNodeIds: '${previous.nodeIds}' } },
      { tool: 'performance_take_heap_snapshot', args: {} },
      { tool: 'js_heap_search', args: { pattern: '${input.searchTerm}' } },
    ],
  },
  WORKFLOW_BINARY_NATIVE_HOOK: {
    id: 'binary-native-hook',
    displayName: 'Binary Analysis + Native Hook',
    steps: [
      { tool: 'ghidra_analyze', args: { binaryPath: '${input.binaryPath}' } },
      { tool: 'generate_hooks', args: { symbols: '${previous.exportedSymbols}' } },
      { tool: 'frida_attach', args: { target: '${input.target}' } },
      { tool: 'frida_run_script', args: { script: '${previous.hookScript}' } },
    ],
  },
};
