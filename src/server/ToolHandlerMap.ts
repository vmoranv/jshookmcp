import type { ToolHandler } from './types.js';
import { BrowserToolHandlers } from './domains/browser/index.js';
import { DebuggerToolHandlers } from './domains/debugger/index.js';
import { AdvancedToolHandlers } from './domains/network/index.js';
import { AIHookToolHandlers, HookPresetToolHandlers } from './domains/hooks/index.js';
import { ProcessToolHandlers } from './domains/process/index.js';

import { CoreAnalysisHandlers } from './domains/analysis/index.js';
import { CoreMaintenanceHandlers } from './domains/maintenance/index.js';

interface ToolHandlerMapDependencies {
  browserHandlers: BrowserToolHandlers;
  debuggerHandlers: DebuggerToolHandlers;
  advancedHandlers: AdvancedToolHandlers;
  aiHookHandlers: AIHookToolHandlers;
  hookPresetHandlers: HookPresetToolHandlers;
  coreAnalysisHandlers: CoreAnalysisHandlers;
  coreMaintenanceHandlers: CoreMaintenanceHandlers;
  processHandlers: ProcessToolHandlers;
}

type HandlerResolver = (
  deps: ToolHandlerMapDependencies
) => (args: Record<string, unknown>) => Promise<unknown>;

const TOOL_HANDLER_BINDINGS: Array<readonly [string, HandlerResolver]> = [
  [
    'get_token_budget_stats',
    (deps) => () => deps.coreMaintenanceHandlers.handleGetTokenBudgetStats(),
  ],
  ['manual_token_cleanup', (deps) => () => deps.coreMaintenanceHandlers.handleManualTokenCleanup()],
  ['reset_token_budget', (deps) => () => deps.coreMaintenanceHandlers.handleResetTokenBudget()],
  ['get_cache_stats', (deps) => () => deps.coreMaintenanceHandlers.handleGetCacheStats()],
  [
    'smart_cache_cleanup',
    (deps) => (args) =>
      deps.coreMaintenanceHandlers.handleSmartCacheCleanup(args.targetSize as number | undefined),
  ],
  ['clear_all_caches', (deps) => () => deps.coreMaintenanceHandlers.handleClearAllCaches()],
  ['collect_code', (deps) => (args) => deps.coreAnalysisHandlers.handleCollectCode(args)],
  ['search_in_scripts', (deps) => (args) => deps.coreAnalysisHandlers.handleSearchInScripts(args)],
  [
    'extract_function_tree',
    (deps) => (args) => deps.coreAnalysisHandlers.handleExtractFunctionTree(args),
  ],
  ['deobfuscate', (deps) => (args) => deps.coreAnalysisHandlers.handleDeobfuscate(args)],
  ['understand_code', (deps) => (args) => deps.coreAnalysisHandlers.handleUnderstandCode(args)],
  ['detect_crypto', (deps) => (args) => deps.coreAnalysisHandlers.handleDetectCrypto(args)],
  ['manage_hooks', (deps) => (args) => deps.coreAnalysisHandlers.handleManageHooks(args)],
  [
    'detect_obfuscation',
    (deps) => (args) => deps.coreAnalysisHandlers.handleDetectObfuscation(args),
  ],
  [
    'advanced_deobfuscate',
    (deps) => (args) => deps.coreAnalysisHandlers.handleAdvancedDeobfuscate(args),
  ],
  ['clear_collected_data', (deps) => () => deps.coreAnalysisHandlers.handleClearCollectedData()],
  ['get_collection_stats', (deps) => () => deps.coreAnalysisHandlers.handleGetCollectionStats()],
  ['get_detailed_data', (deps) => (args) => deps.browserHandlers.handleGetDetailedData(args)],
  ['browser_attach', (deps) => (args) => deps.browserHandlers.handleBrowserAttach(args)],
  ['browser_list_tabs', (deps) => (args) => deps.browserHandlers.handleBrowserListTabs(args)],
  ['browser_select_tab', (deps) => (args) => deps.browserHandlers.handleBrowserSelectTab(args)],
  ['browser_launch', (deps) => (args) => deps.browserHandlers.handleBrowserLaunch(args)],
  ['browser_close', (deps) => (args) => deps.browserHandlers.handleBrowserClose(args)],
  ['browser_status', (deps) => (args) => deps.browserHandlers.handleBrowserStatus(args)],
  ['page_navigate', (deps) => (args) => deps.browserHandlers.handlePageNavigate(args)],
  ['page_reload', (deps) => (args) => deps.browserHandlers.handlePageReload(args)],
  ['page_back', (deps) => (args) => deps.browserHandlers.handlePageBack(args)],
  ['page_forward', (deps) => (args) => deps.browserHandlers.handlePageForward(args)],
  ['dom_query_selector', (deps) => (args) => deps.browserHandlers.handleDOMQuerySelector(args)],
  ['dom_query_all', (deps) => (args) => deps.browserHandlers.handleDOMQueryAll(args)],
  ['dom_get_structure', (deps) => (args) => deps.browserHandlers.handleDOMGetStructure(args)],
  ['dom_find_clickable', (deps) => (args) => deps.browserHandlers.handleDOMFindClickable(args)],
  ['page_click', (deps) => (args) => deps.browserHandlers.handlePageClick(args)],
  ['page_type', (deps) => (args) => deps.browserHandlers.handlePageType(args)],
  ['page_select', (deps) => (args) => deps.browserHandlers.handlePageSelect(args)],
  ['page_hover', (deps) => (args) => deps.browserHandlers.handlePageHover(args)],
  ['page_scroll', (deps) => (args) => deps.browserHandlers.handlePageScroll(args)],
  [
    'page_wait_for_selector',
    (deps) => (args) => deps.browserHandlers.handlePageWaitForSelector(args),
  ],
  ['page_evaluate', (deps) => (args) => deps.browserHandlers.handlePageEvaluate(args)],
  ['page_screenshot', (deps) => (args) => deps.browserHandlers.handlePageScreenshot(args)],
  ['get_all_scripts', (deps) => (args) => deps.browserHandlers.handleGetAllScripts(args)],
  ['get_script_source', (deps) => (args) => deps.browserHandlers.handleGetScriptSource(args)],
  ['console_enable', (deps) => (args) => deps.browserHandlers.handleConsoleEnable(args)],
  ['console_get_logs', (deps) => (args) => deps.browserHandlers.handleConsoleGetLogs(args)],
  ['console_execute', (deps) => (args) => deps.browserHandlers.handleConsoleExecute(args)],
  [
    'dom_get_computed_style',
    (deps) => (args) => deps.browserHandlers.handleDOMGetComputedStyle(args),
  ],
  ['dom_find_by_text', (deps) => (args) => deps.browserHandlers.handleDOMFindByText(args)],
  ['dom_get_xpath', (deps) => (args) => deps.browserHandlers.handleDOMGetXPath(args)],
  ['dom_is_in_viewport', (deps) => (args) => deps.browserHandlers.handleDOMIsInViewport(args)],
  ['page_get_performance', (deps) => (args) => deps.browserHandlers.handlePageGetPerformance(args)],
  ['page_inject_script', (deps) => (args) => deps.browserHandlers.handlePageInjectScript(args)],
  ['page_set_cookies', (deps) => (args) => deps.browserHandlers.handlePageSetCookies(args)],
  ['page_get_cookies', (deps) => (args) => deps.browserHandlers.handlePageGetCookies(args)],
  ['page_clear_cookies', (deps) => (args) => deps.browserHandlers.handlePageClearCookies(args)],
  ['page_set_viewport', (deps) => (args) => deps.browserHandlers.handlePageSetViewport(args)],
  ['page_emulate_device', (deps) => (args) => deps.browserHandlers.handlePageEmulateDevice(args)],
  [
    'page_get_local_storage',
    (deps) => (args) => deps.browserHandlers.handlePageGetLocalStorage(args),
  ],
  [
    'page_set_local_storage',
    (deps) => (args) => deps.browserHandlers.handlePageSetLocalStorage(args),
  ],
  ['page_press_key', (deps) => (args) => deps.browserHandlers.handlePagePressKey(args)],
  ['page_get_all_links', (deps) => (args) => deps.browserHandlers.handlePageGetAllLinks(args)],
  ['captcha_detect', (deps) => (args) => deps.browserHandlers.handleCaptchaDetect(args)],
  ['captcha_wait', (deps) => (args) => deps.browserHandlers.handleCaptchaWait(args)],
  ['captcha_config', (deps) => (args) => deps.browserHandlers.handleCaptchaConfig(args)],
  ['stealth_inject', (deps) => (args) => deps.browserHandlers.handleStealthInject(args)],
  [
    'stealth_set_user_agent',
    (deps) => (args) => deps.browserHandlers.handleStealthSetUserAgent(args),
  ],
  [
    'camoufox_server_launch',
    (deps) => (args) => deps.browserHandlers.handleCamoufoxServerLaunch(args),
  ],
  [
    'camoufox_server_close',
    (deps) => (args) => deps.browserHandlers.handleCamoufoxServerClose(args),
  ],
  [
    'camoufox_server_status',
    (deps) => (args) => deps.browserHandlers.handleCamoufoxServerStatus(args),
  ],
  ['framework_state_extract', (deps) => (args) => deps.browserHandlers.handleFrameworkStateExtract(args)],
  ['indexeddb_dump', (deps) => (args) => deps.browserHandlers.handleIndexedDBDump(args)],
  ['ai_hook_generate', (deps) => (args) => deps.aiHookHandlers.handleAIHookGenerate(args)],
  ['ai_hook_inject', (deps) => (args) => deps.aiHookHandlers.handleAIHookInject(args)],
  ['ai_hook_get_data', (deps) => (args) => deps.aiHookHandlers.handleAIHookGetData(args)],
  ['ai_hook_list', (deps) => (args) => deps.aiHookHandlers.handleAIHookList(args)],
  ['ai_hook_clear', (deps) => (args) => deps.aiHookHandlers.handleAIHookClear(args)],
  ['ai_hook_toggle', (deps) => (args) => deps.aiHookHandlers.handleAIHookToggle(args)],
  ['ai_hook_export', (deps) => (args) => deps.aiHookHandlers.handleAIHookExport(args)],
  ['hook_preset', (deps) => (args) => deps.hookPresetHandlers.handleHookPreset(args)],
  ['debugger_enable', (deps) => (args) => deps.debuggerHandlers.handleDebuggerEnable(args)],
  ['debugger_disable', (deps) => (args) => deps.debuggerHandlers.handleDebuggerDisable(args)],
  ['debugger_pause', (deps) => (args) => deps.debuggerHandlers.handleDebuggerPause(args)],
  ['debugger_resume', (deps) => (args) => deps.debuggerHandlers.handleDebuggerResume(args)],
  ['debugger_step_into', (deps) => (args) => deps.debuggerHandlers.handleDebuggerStepInto(args)],
  ['debugger_step_over', (deps) => (args) => deps.debuggerHandlers.handleDebuggerStepOver(args)],
  ['debugger_step_out', (deps) => (args) => deps.debuggerHandlers.handleDebuggerStepOut(args)],
  ['breakpoint_set', (deps) => (args) => deps.debuggerHandlers.handleBreakpointSet(args)],
  ['breakpoint_remove', (deps) => (args) => deps.debuggerHandlers.handleBreakpointRemove(args)],
  ['breakpoint_list', (deps) => (args) => deps.debuggerHandlers.handleBreakpointList(args)],
  ['get_call_stack', (deps) => (args) => deps.debuggerHandlers.handleGetCallStack(args)],
  ['debugger_evaluate', (deps) => (args) => deps.debuggerHandlers.handleDebuggerEvaluate(args)],
  [
    'debugger_evaluate_global',
    (deps) => (args) => deps.debuggerHandlers.handleDebuggerEvaluateGlobal(args),
  ],
  [
    'debugger_wait_for_paused',
    (deps) => (args) => deps.debuggerHandlers.handleDebuggerWaitForPaused(args),
  ],
  [
    'debugger_get_paused_state',
    (deps) => (args) => deps.debuggerHandlers.handleDebuggerGetPausedState(args),
  ],
  [
    'breakpoint_set_on_exception',
    (deps) => (args) => deps.debuggerHandlers.handleBreakpointSetOnException(args),
  ],
  [
    'get_object_properties',
    (deps) => (args) => deps.debuggerHandlers.handleGetObjectProperties(args),
  ],
  [
    'get_scope_variables_enhanced',
    (deps) => (args) => deps.debuggerHandlers.handleGetScopeVariablesEnhanced(args),
  ],
  ['debugger_save_session', (deps) => (args) => deps.debuggerHandlers.handleSaveSession(args)],
  ['debugger_load_session', (deps) => (args) => deps.debuggerHandlers.handleLoadSession(args)],
  ['debugger_export_session', (deps) => (args) => deps.debuggerHandlers.handleExportSession(args)],
  ['debugger_list_sessions', (deps) => (args) => deps.debuggerHandlers.handleListSessions(args)],
  ['watch_add', (deps) => (args) => deps.debuggerHandlers.handleWatchAdd(args)],
  ['watch_remove', (deps) => (args) => deps.debuggerHandlers.handleWatchRemove(args)],
  ['watch_list', (deps) => (args) => deps.debuggerHandlers.handleWatchList(args)],
  ['watch_evaluate_all', (deps) => (args) => deps.debuggerHandlers.handleWatchEvaluateAll(args)],
  ['watch_clear_all', (deps) => (args) => deps.debuggerHandlers.handleWatchClearAll(args)],
  ['xhr_breakpoint_set', (deps) => (args) => deps.debuggerHandlers.handleXHRBreakpointSet(args)],
  [
    'xhr_breakpoint_remove',
    (deps) => (args) => deps.debuggerHandlers.handleXHRBreakpointRemove(args),
  ],
  ['xhr_breakpoint_list', (deps) => (args) => deps.debuggerHandlers.handleXHRBreakpointList(args)],
  [
    'event_breakpoint_set',
    (deps) => (args) => deps.debuggerHandlers.handleEventBreakpointSet(args),
  ],
  [
    'event_breakpoint_set_category',
    (deps) => (args) => deps.debuggerHandlers.handleEventBreakpointSetCategory(args),
  ],
  [
    'event_breakpoint_remove',
    (deps) => (args) => deps.debuggerHandlers.handleEventBreakpointRemove(args),
  ],
  [
    'event_breakpoint_list',
    (deps) => (args) => deps.debuggerHandlers.handleEventBreakpointList(args),
  ],
  ['blackbox_add', (deps) => (args) => deps.debuggerHandlers.handleBlackboxAdd(args)],
  ['blackbox_add_common', (deps) => (args) => deps.debuggerHandlers.handleBlackboxAddCommon(args)],
  ['blackbox_list', (deps) => (args) => deps.debuggerHandlers.handleBlackboxList(args)],
  ['network_enable', (deps) => (args) => deps.advancedHandlers.handleNetworkEnable(args)],
  ['network_disable', (deps) => (args) => deps.advancedHandlers.handleNetworkDisable(args)],
  ['network_get_status', (deps) => (args) => deps.advancedHandlers.handleNetworkGetStatus(args)],
  [
    'network_get_requests',
    (deps) => (args) => deps.advancedHandlers.handleNetworkGetRequests(args),
  ],
  [
    'network_get_response_body',
    (deps) => (args) => deps.advancedHandlers.handleNetworkGetResponseBody(args),
  ],
  ['network_get_stats', (deps) => (args) => deps.advancedHandlers.handleNetworkGetStats(args)],
  [
    'performance_get_metrics',
    (deps) => (args) => deps.advancedHandlers.handlePerformanceGetMetrics(args),
  ],
  [
    'performance_start_coverage',
    (deps) => (args) => deps.advancedHandlers.handlePerformanceStartCoverage(args),
  ],
  [
    'performance_stop_coverage',
    (deps) => (args) => deps.advancedHandlers.handlePerformanceStopCoverage(args),
  ],
  [
    'performance_take_heap_snapshot',
    (deps) => (args) => deps.advancedHandlers.handlePerformanceTakeHeapSnapshot(args),
  ],
  [
    'console_get_exceptions',
    (deps) => (args) => deps.advancedHandlers.handleConsoleGetExceptions(args),
  ],
  [
    'console_inject_script_monitor',
    (deps) => (args) => deps.advancedHandlers.handleConsoleInjectScriptMonitor(args),
  ],
  [
    'console_inject_xhr_interceptor',
    (deps) => (args) => deps.advancedHandlers.handleConsoleInjectXhrInterceptor(args),
  ],
  [
    'console_inject_fetch_interceptor',
    (deps) => (args) => deps.advancedHandlers.handleConsoleInjectFetchInterceptor(args),
  ],
  [
    'console_clear_injected_buffers',
    (deps) => (args) => deps.advancedHandlers.handleConsoleClearInjectedBuffers(args),
  ],
  [
    'console_reset_injected_interceptors',
    (deps) => (args) => deps.advancedHandlers.handleConsoleResetInjectedInterceptors(args),
  ],
  [
    'console_inject_function_tracer',
    (deps) => (args) => deps.advancedHandlers.handleConsoleInjectFunctionTracer(args),
  ],
  ['webpack_enumerate', (deps) => (args) => deps.coreAnalysisHandlers.handleWebpackEnumerate(args)],
  ['source_map_extract', (deps) => (args) => deps.coreAnalysisHandlers.handleSourceMapExtract(args)],
  ['electron_attach', (deps) => ((args) => deps.processHandlers.handleElectronAttach(args)) as ToolHandler],
  // Process management tools
  ['process_find', (deps) => ((args) => deps.processHandlers.handleProcessFind(args)) as ToolHandler],
  ['process_list', (deps) => (((_args) => deps.processHandlers.handleProcessFind({ pattern: '' })) as ToolHandler)],
  ['process_get', (deps) => ((args) => deps.processHandlers.handleProcessGet(args)) as ToolHandler],
  ['process_windows', (deps) => ((args) => deps.processHandlers.handleProcessWindows(args)) as ToolHandler],
  ['process_find_chromium', (deps) => ((args) => deps.processHandlers.handleProcessFindChromium(args)) as ToolHandler],
  ['process_check_debug_port', (deps) => ((args) => deps.processHandlers.handleProcessCheckDebugPort(args)) as ToolHandler],
  ['process_launch_debug', (deps) => ((args) => deps.processHandlers.handleProcessLaunchDebug(args)) as ToolHandler],
  ['process_kill', (deps) => ((args) => deps.processHandlers.handleProcessKill(args)) as ToolHandler],
  ['memory_read', (deps) => ((args) => deps.processHandlers.handleMemoryRead(args)) as ToolHandler],
  ['memory_write', (deps) => ((args) => deps.processHandlers.handleMemoryWrite(args)) as ToolHandler],
  ['memory_scan', (deps) => ((args) => deps.processHandlers.handleMemoryScan(args)) as ToolHandler],
  // Advanced memory tools
  ['memory_check_protection', (deps) => ((args) => deps.processHandlers.handleMemoryCheckProtection(args)) as ToolHandler],
  ['memory_protect', (deps) => ((args) => deps.processHandlers.handleMemoryCheckProtection(args)) as ToolHandler],
  ['memory_scan_filtered', (deps) => ((args) => deps.processHandlers.handleMemoryScanFiltered(args)) as ToolHandler],
  ['memory_batch_write', (deps) => ((args) => deps.processHandlers.handleMemoryBatchWrite(args)) as ToolHandler],
  ['memory_dump_region', (deps) => ((args) => deps.processHandlers.handleMemoryDumpRegion(args)) as ToolHandler],
  ['memory_list_regions', (deps) => ((args) => deps.processHandlers.handleMemoryListRegions(args)) as ToolHandler],
  // Injection tools
  ['inject_dll', (deps) => ((args) => deps.processHandlers.handleInjectDll(args)) as ToolHandler],
  ['module_inject_dll', (deps) => ((args) => deps.processHandlers.handleInjectDll(args)) as ToolHandler],
  ['inject_shellcode', (deps) => ((args) => deps.processHandlers.handleInjectShellcode(args)) as ToolHandler],
  ['module_inject_shellcode', (deps) => ((args) => deps.processHandlers.handleInjectShellcode(args)) as ToolHandler],
  // Anti-detection tools
  ['check_debug_port', (deps) => ((args) => deps.processHandlers.handleCheckDebugPort(args)) as ToolHandler],
  ['enumerate_modules', (deps) => ((args) => deps.processHandlers.handleEnumerateModules(args)) as ToolHandler],
  ['module_list', (deps) => ((args) => deps.processHandlers.handleEnumerateModules(args)) as ToolHandler],
];

export const HANDLED_TOOL_NAMES: ReadonlySet<string> = new Set(
  TOOL_HANDLER_BINDINGS.map(([name]) => name)
);

export function createToolHandlerMap(
  deps: ToolHandlerMapDependencies
): Record<string, ToolHandler> {
  return Object.fromEntries(
    TOOL_HANDLER_BINDINGS.map(([toolName, resolver]) => [toolName, resolver(deps) as ToolHandler])
  );
}
