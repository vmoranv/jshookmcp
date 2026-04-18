/**
 * E2E Coverage Gap Analyzer
 *
 * Cross-references the MCP server's registered tools against the
 * e2e phase tool lists to identify exercised, skipped, and untested tools.
 * Groups results by domain for per-domain coverage reporting.
 */

import { ALL_PHASES } from '@tests/e2e/phases/index';
import type { CoverageReport, DomainCoverage, ToolCoverageEntry } from '@tests/e2e/helpers/types';

const STRICT_OVERRIDE_TOOLS = new Set<string>([
  'adb_device_list',
  'adb_shell',
  'adb_apk_pull',
  'adb_apk_analyze',
  'adb_webview_list',
  'adb_webview_attach',
  'ai_hook_get_data',
  'ai_hook_inject',
  'ai_hook_toggle',
  'asar_extract',
  'breakpoint_remove',
  'check_debug_port',
  'debugger_load_session',
  'electron_inspect_app',
  'event_breakpoint_remove',
  'export_hook_script',
  'extension_execute_in_context',
  'extension_install',
  'extract_function_tree',
  'frida_attach',
  'frida_detach',
  'frida_enumerate_functions',
  'frida_enumerate_modules',
  'frida_find_symbols',
  'frida_generate_script',
  'frida_list_sessions',
  'frida_run_script',
  'generate_hooks',
  'get_available_plugins',
  'get_detailed_data',
  'get_object_properties',
  'ghidra_analyze',
  'ghidra_decompile',
  'ida_decompile',
  'inject_dll',
  'inject_shellcode',
  'install_extension',
  'jadx_decompile',
  'memory_batch_write',
  'memory_check_protection',
  'memory_dump_region',
  'memory_read',
  'memory_scan',
  'memory_scan_filtered',
  'memory_write',
  'miniapp_pkg_analyze',
  'miniapp_pkg_scan',
  'miniapp_pkg_unpack',
  'network_get_response_body',
  'network_replay_request',
  'process_check_debug_port',
  'process_get',
  'process_kill',
  'process_windows',
  'run_extension_workflow',
  'unidbg_call',
  'unidbg_emulate',
  'unidbg_launch',
  'unidbg_trace',
  'watch_remove',
  'wasm_decompile',
  'wasm_disassemble',
  'wasm_inspect_sections',
  'wasm_offline_run',
  'wasm_optimize',
  'xhr_breakpoint_remove',
]);

/** Extract all tools listed across e2e phases (setup + tools arrays). */
function collectPhaseTools(): Set<string> {
  const phaseTools = new Set<string>();
  for (const phase of ALL_PHASES) {
    for (const tool of phase.tools) {
      phaseTools.add(tool);
    }
    if (Array.isArray(phase.setup)) {
      for (const tool of phase.setup) {
        phaseTools.add(tool);
      }
    }
  }
  return phaseTools;
}

/** Infer domain from tool name prefix. */
function inferDomain(toolName: string): string {
  const prefixMap: [string, string][] = [
    ['page_', 'browser'],
    ['dom_', 'browser'],
    ['browser_', 'browser'],
    ['tab_', 'browser'],
    ['console_', 'browser'],
    ['debugger_', 'debugger'],
    ['breakpoint_', 'debugger'],
    ['xhr_breakpoint_', 'debugger'],
    ['event_breakpoint_', 'debugger'],
    ['watch_', 'debugger'],
    ['get_call_stack', 'debugger'],
    ['get_scope_', 'debugger'],
    ['get_script_', 'debugger'],
    ['get_all_scripts', 'debugger'],
    ['get_detailed_data', 'debugger'],
    ['get_object_properties', 'debugger'],
    ['blackbox_', 'debugger'],
    ['search_in_scripts', 'debugger'],
    ['extract_function_tree', 'debugger'],
    ['collect_code', 'debugger'],
    ['network_', 'network'],
    ['ws_', 'streaming'],
    ['sse_', 'streaming'],
    ['performance_', 'instrumentation'],
    ['profiler_', 'instrumentation'],
    ['memory_', 'memory'],
    ['process_', 'process'],
    ['module_', 'process'],
    ['check_debug_port', 'process'],
    ['enumerate_modules', 'process'],
    ['binary_', 'encoding'],
    ['protobuf_', 'encoding'],
    ['deobfuscate', 'analysis'],
    ['advanced_deobfuscate', 'analysis'],
    ['webcrack_', 'analysis'],
    ['understand_code', 'analysis'],
    ['detect_', 'analysis'],
    ['ai_hook_', 'hooks'],
    ['manage_hooks', 'hooks'],
    ['hook_preset', 'hooks'],
    ['graphql_', 'graphql'],
    ['call_graph_', 'graphql'],
    ['ast_', 'transform'],
    ['crypto_', 'transform'],
    ['sourcemap_', 'sourcemap'],
    ['source_map_', 'sourcemap'],
    ['stealth_', 'stealth'],
    ['captcha_', 'stealth'],
    ['camoufox_', 'stealth'],
    ['human_', 'stealth'],
    ['widget_', 'stealth'],
    ['wasm_', 'wasm'],
    ['antidebug_', 'antidebug'],
    ['webpack_', 'workflow'],
    ['js_bundle_', 'workflow'],
    ['js_heap_', 'workflow'],
    ['web_api_', 'workflow'],
    ['api_probe_', 'workflow'],
    ['script_replace_', 'workflow'],
    ['indexeddb_', 'browser'],
    ['framework_', 'browser'],
    ['extension_', 'extension-registry'],
    ['install_extension', 'extension-registry'],
    ['list_extensions', 'extension-registry'],
    ['reload_extensions', 'extension-registry'],
    ['browse_extension_', 'extension-registry'],
    ['run_extension_', 'extension-registry'],
    ['list_extension_', 'extension-registry'],
    ['asar_', 'platform'],
    ['electron_', 'platform'],
    ['miniapp_', 'platform'],
    ['inject_', 'process'],
    ['frida_', 'native-bridge'],
    ['jadx_', 'native-bridge'],
    ['batch_register', 'extension-registry'],
    ['register_account_', 'extension-registry'],
    ['get_token_budget_', 'maintenance'],
    ['manual_token_', 'maintenance'],
    ['reset_token_', 'maintenance'],
    ['get_cache_stats', 'maintenance'],
    ['smart_cache_', 'maintenance'],
    ['cleanup_', 'maintenance'],
    ['doctor_', 'maintenance'],
    ['boost_profile', 'maintenance'],
    ['unboost_profile', 'maintenance'],
    ['get_collection_stats', 'maintenance'],
    ['clear_', 'maintenance'],
    ['create_task_', 'coordination'],
    ['complete_task_', 'coordination'],
    ['get_task_', 'coordination'],
    ['append_session_', 'coordination'],
    ['save_page_', 'coordination'],
    ['list_page_', 'coordination'],
    ['summarize_trace', 'trace'],
    ['v8_', 'v8-inspector'],
    ['search_tools', 'search'],
    ['execute_sandbox_', 'sandbox'],
    ['cross_domain_', 'cross-domain'],
  ];

  for (const [prefix, domain] of prefixMap) {
    if (toolName.startsWith(prefix) || toolName === prefix) {
      return domain;
    }
  }
  return 'unknown';
}

/**
 * Analyze coverage by cross-referencing registered tools against phase tool lists.
 */
export function analyzeCoverage(
  registeredTools: Map<string, { name: string; inputSchema?: Record<string, unknown> }>,
): CoverageReport {
  const phaseTools = collectPhaseTools();
  const entries: ToolCoverageEntry[] = [];

  for (const [toolName] of registeredTools) {
    const inPhases = phaseTools.has(toolName);
    const isStrictOverride = STRICT_OVERRIDE_TOOLS.has(toolName);

    let status: 'exercised' | 'skipped' | 'untested';
    if (inPhases && !isStrictOverride) {
      status = 'exercised';
    } else if (isStrictOverride) {
      status = 'skipped';
    } else {
      status = 'untested';
    }

    entries.push({
      name: toolName,
      domain: inferDomain(toolName),
      status,
    });
  }

  // Group by domain
  const domainMap = new Map<string, ToolCoverageEntry[]>();
  for (const entry of entries) {
    const list = domainMap.get(entry.domain) ?? [];
    list.push(entry);
    domainMap.set(entry.domain, list);
  }

  const domains: DomainCoverage[] = [];
  for (const [domain, tools] of domainMap) {
    const exercised = tools.filter((t) => t.status === 'exercised').length;
    const skipped = tools.filter((t) => t.status === 'skipped').length;
    const untested = tools.filter((t) => t.status === 'untested').length;
    const total = tools.length;

    domains.push({
      domain,
      total,
      exercised,
      skipped,
      untested,
      coveragePercent: total > 0 ? Math.round(((exercised + skipped) / total) * 100) : 0,
      tools,
    });
  }

  domains.sort((a, b) => a.domain.localeCompare(b.domain));

  const totalTools = entries.length;
  const totalExercised = entries.filter((e) => e.status === 'exercised').length;
  const totalSkipped = entries.filter((e) => e.status === 'skipped').length;
  const totalUntested = entries.filter((e) => e.status === 'untested').length;

  return {
    timestamp: new Date().toISOString(),
    totalTools,
    exercised: totalExercised,
    skipped: totalSkipped,
    untested: totalUntested,
    overallCoveragePercent:
      totalTools > 0 ? Math.round(((totalExercised + totalSkipped) / totalTools) * 100) : 0,
    domains,
    untestedTools: entries.filter((e) => e.status === 'untested').map((e) => e.name),
  };
}

/**
 * Format a coverage report as a human-readable summary.
 */
export function formatCoverageReport(report: CoverageReport): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════',
    ' E2E Coverage Report',
    '═══════════════════════════════════════════════════════',
    '',
    `Total tools: ${report.totalTools}`,
    `Exercised:   ${report.exercised} (${Math.round((report.exercised / report.totalTools) * 100)}%)`,
    `Skipped:     ${report.skipped} (context-dependent, in phase lists)`,
    `Untested:    ${report.untested}`,
    `Coverage:    ${report.overallCoveragePercent}%`,
    '',
    '── Per-Domain Breakdown ──',
    '',
  ];

  for (const domain of report.domains) {
    const bar =
      '█'.repeat(Math.round(domain.coveragePercent / 5)) +
      '░'.repeat(20 - Math.round(domain.coveragePercent / 5));
    lines.push(
      `  ${domain.domain.padEnd(22)} ${bar} ${String(domain.coveragePercent).padStart(3)}% (${domain.exercised}+${domain.skipped}/${domain.total})`,
    );
  }

  if (report.untestedTools.length > 0) {
    lines.push('', '── Untested Tools ──', '');
    for (const tool of report.untestedTools) {
      lines.push(`  ○ ${tool}`);
    }
  }

  return lines.join('\n');
}
