/**
 * Session-based Workflow Transition Graph (Industrial Swing / ItemCF inspired).
 *
 * Grounded in collaborative filtering & Markov transition networks:
 * - Agents interact with MCP tools in multi-step task chains (e.g. launch -> navigate -> click).
 * - When an agent operates with an active session context (activeToolNames), downstream
 *   tools that frequently succeed the active tools receive an affinity transition boost.
 * - Bridges cross-domain gaps (e.g. network capture -> payload deobfuscation) that pure
 *   lexical name prefix grouping cannot discover.
 */

interface TransitionEdge {
  targetTool: string;
  weight: number;
}

/**
 * Curated high-precision workflow transition transitions across tool families.
 * Each source tool maps to high-likelihood sequential target tools.
 */
const WORKFLOW_TRANSITION_PAIRS: Readonly<Record<string, readonly string[]>> = {
  // Browser workflow chain
  browser_launch: ['browser_attach', 'page_navigate', 'tab_workflow'],
  page_navigate: [
    'page_click',
    'page_evaluate',
    'page_screenshot',
    'page_wait_for_selector',
    'page_cookies',
  ],
  page_click: ['page_wait_for_selector', 'page_screenshot', 'page_evaluate'],
  page_cookies: ['page_local_storage', 'page_session_storage', 'network_extract_auth'],

  // Network capture & analysis chain
  network_enable: ['network_monitor', 'network_intercept'],
  network_monitor: ['network_get_requests', 'network_get_response_body', 'network_export_har'],
  network_intercept: ['network_replay_request', 'transform_workbench', 'network_get_requests'],
  network_get_requests: ['network_get_response_body', 'network_export_har', 'network_extract_auth'],

  // Binary reverse engineering & instrumentation
  frida_attach: [
    'frida_run_script',
    'frida_enumerate_functions',
    'frida_find_symbols',
    'manage_hooks',
  ],
  jadx_decompile: ['jadx_search_code', 'search_in_scripts', 'apk_manifest_dump'],
  jadx_decompile_apk: [
    'jadx_search_code',
    'search_in_scripts',
    'apk_manifest_dump',
    'apk_packer_detect',
  ],
  ghidra_analyze: ['ghidra_decompile', 'frida_find_symbols', 'binary_strings_extract'],

  // Memory forensics
  memory_first_scan: ['memory_next_scan', 'memory_write_value', 'memory_breakpoint'],
  memory_scan: ['memory_next_scan', 'memory_write_value', 'memory_breakpoint'],
  memory_find_references: ['memory_structure_analyze', 'memory_breakpoint'],

  // V8 & JS runtime internals
  v8_heap_snapshot_capture: ['v8_heap_find_leaks', 'v8_heap_diff', 'diff_heap_snapshots'],
  v8_bytecode_extract: ['v8_turbofan_inspect', 'v8_deopt_trace'],

  // WebAssembly & Protocol
  wasm_dump: ['wasm_decompile', 'wasm_disassemble', 'wasm_inspect_sections'],
  proto_auto_detect: ['proto_infer_fields', 'protobuf_decode_raw', 'proto_export_schema'],
  webgpu_capture_commands: ['webgpu_pipeline_dump', 'webgpu_shader_disassemble'],

  // Extension & Automation
  run_extension_workflow: ['workflow_run_inspect', 'workflow_suggest', 'tab_workflow'],
};

const TRANSITION_MAP: ReadonlyMap<string, ReadonlyArray<TransitionEdge>> = (() => {
  const map = new Map<string, TransitionEdge[]>();
  for (const [src, targets] of Object.entries(WORKFLOW_TRANSITION_PAIRS)) {
    const edges: TransitionEdge[] = targets.map((target, idx) => ({
      targetTool: target,
      // Rank decay for secondary targets in the transition list
      weight: Math.max(0.1, 0.45 / Math.sqrt(idx + 1)),
    }));
    map.set(src, edges);
  }
  return map;
})();

/**
 * Resolves contextual transition boosts for candidates given the currently
 * active tools in the agent session.
 *
 * @param activeToolNames Currently active or recently invoked tools in session
 * @returns Map of target tool name -> cumulative transition boost multiplier
 */
function getTransitionBoosts(activeToolNames?: ReadonlySet<string>): ReadonlyMap<string, number> {
  if (!activeToolNames || activeToolNames.size === 0) {
    return new Map();
  }

  const boosts = new Map<string, number>();
  for (const active of activeToolNames) {
    const edges = TRANSITION_MAP.get(active);
    if (!edges) continue;

    for (const { targetTool, weight } of edges) {
      // Skip self-loop
      if (targetTool === active) continue;
      const current = boosts.get(targetTool) ?? 1.0;
      // Cumulative transition boost capped at 1.40x
      boosts.set(targetTool, Math.min(1.4, current + weight));
    }
  }

  return boosts;
}

export const WorkflowTransitionGraph = {
  getTransitionBoosts,
} as const;
