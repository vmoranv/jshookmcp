import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, ensureBrowserCore, toolLookup } from '@server/domains/shared/registry';
import { debuggerTools } from '@server/domains/debugger/definitions';
import { DebuggerToolHandlers } from '@server/domains/debugger/index';
import { DebuggerManager } from '@server/domains/shared/modules';
import { RuntimeInspector } from '@server/domains/shared/modules';

const DOMAIN = 'debugger' as const;
const DEP_KEY = 'debuggerHandlers' as const;
type H = DebuggerToolHandlers;
const t = toolLookup(debuggerTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  ensureBrowserCore(ctx);
  if (!ctx.debuggerManager) ctx.debuggerManager = new DebuggerManager(ctx.collector!);
  if (!ctx.runtimeInspector)
    ctx.runtimeInspector = new RuntimeInspector(ctx.collector!, ctx.debuggerManager);
  if (!ctx.debuggerHandlers) {
    ctx.debuggerHandlers = new DebuggerToolHandlers(
      ctx.debuggerManager,
      ctx.runtimeInspector,
      ctx.eventBus,
    );
  }
  return ctx.debuggerHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,

  prerequisites: {
    debugger_enable: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    breakpoint_set: [
      {
        condition: 'Browser must be launched',
        fix: 'Call browser_launch and debugger_enable first',
      },
    ],
  },

  registrations: [
    { tool: t('debugger_enable'), domain: DOMAIN, bind: b((h, a) => h.handleDebuggerEnable(a)) },
    { tool: t('debugger_disable'), domain: DOMAIN, bind: b((h, a) => h.handleDebuggerDisable(a)) },
    { tool: t('debugger_pause'), domain: DOMAIN, bind: b((h, a) => h.handleDebuggerPause(a)) },
    { tool: t('debugger_resume'), domain: DOMAIN, bind: b((h, a) => h.handleDebuggerResume(a)) },
    {
      tool: t('debugger_step_into'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleDebuggerStepInto(a)),
    },
    {
      tool: t('debugger_step_over'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleDebuggerStepOver(a)),
    },
    { tool: t('debugger_step_out'), domain: DOMAIN, bind: b((h, a) => h.handleDebuggerStepOut(a)) },
    { tool: t('breakpoint_set'), domain: DOMAIN, bind: b((h, a) => h.handleBreakpointSet(a)) },
    {
      tool: t('breakpoint_remove'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleBreakpointRemove(a)),
    },
    { tool: t('breakpoint_list'), domain: DOMAIN, bind: b((h, a) => h.handleBreakpointList(a)) },
    { tool: t('get_call_stack'), domain: DOMAIN, bind: b((h, a) => h.handleGetCallStack(a)) },
    {
      tool: t('debugger_evaluate'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleDebuggerEvaluate(a)),
    },
    {
      tool: t('debugger_evaluate_global'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleDebuggerEvaluateGlobal(a)),
    },
    {
      tool: t('debugger_wait_for_paused'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleDebuggerWaitForPaused(a)),
    },
    {
      tool: t('debugger_get_paused_state'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleDebuggerGetPausedState(a)),
    },
    {
      tool: t('breakpoint_set_on_exception'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleBreakpointSetOnException(a)),
    },
    {
      tool: t('get_object_properties'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleGetObjectProperties(a)),
    },
    {
      tool: t('get_scope_variables_enhanced'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleGetScopeVariablesEnhanced(a)),
    },
    { tool: t('debugger_save_session'), domain: DOMAIN, bind: b((h, a) => h.handleSaveSession(a)) },
    { tool: t('debugger_load_session'), domain: DOMAIN, bind: b((h, a) => h.handleLoadSession(a)) },
    {
      tool: t('debugger_export_session'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleExportSession(a)),
    },
    {
      tool: t('debugger_list_sessions'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleListSessions(a)),
    },
    { tool: t('watch_add'), domain: DOMAIN, bind: b((h, a) => h.handleWatchAdd(a)) },
    { tool: t('watch_remove'), domain: DOMAIN, bind: b((h, a) => h.handleWatchRemove(a)) },
    { tool: t('watch_list'), domain: DOMAIN, bind: b((h, a) => h.handleWatchList(a)) },
    {
      tool: t('watch_evaluate_all'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleWatchEvaluateAll(a)),
    },
    { tool: t('watch_clear_all'), domain: DOMAIN, bind: b((h, a) => h.handleWatchClearAll(a)) },
    {
      tool: t('xhr_breakpoint_set'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleXHRBreakpointSet(a)),
    },
    {
      tool: t('xhr_breakpoint_remove'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleXHRBreakpointRemove(a)),
    },
    {
      tool: t('xhr_breakpoint_list'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleXHRBreakpointList(a)),
    },
    {
      tool: t('event_breakpoint_set'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleEventBreakpointSet(a)),
    },
    {
      tool: t('event_breakpoint_set_category'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleEventBreakpointSetCategory(a)),
    },
    {
      tool: t('event_breakpoint_remove'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleEventBreakpointRemove(a)),
    },
    {
      tool: t('event_breakpoint_list'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleEventBreakpointList(a)),
    },
    { tool: t('blackbox_add'), domain: DOMAIN, bind: b((h, a) => h.handleBlackboxAdd(a)) },
    {
      tool: t('blackbox_add_common'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleBlackboxAddCommon(a)),
    },
    { tool: t('blackbox_list'), domain: DOMAIN, bind: b((h, a) => h.handleBlackboxList(a)) },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
