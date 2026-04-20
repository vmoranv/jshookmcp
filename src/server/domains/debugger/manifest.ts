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
  profiles: ['workflow', 'full'],
  ensure,

  prerequisites: {
    debugger_lifecycle: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    breakpoint: [
      {
        condition: 'Browser must be launched',
        fix: 'Call browser_launch and debugger_lifecycle(enable) first',
      },
    ],
  },

  registrations: [
    {
      tool: t('debugger_lifecycle'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleDebuggerLifecycle(a)),
    },
    { tool: t('debugger_pause'), domain: DOMAIN, bind: b((h, a) => h.handleDebuggerPause(a)) },
    { tool: t('debugger_resume'), domain: DOMAIN, bind: b((h, a) => h.handleDebuggerResume(a)) },
    { tool: t('debugger_step'), domain: DOMAIN, bind: b((h, a) => h.handleDebuggerStep(a)) },
    { tool: t('breakpoint'), domain: DOMAIN, bind: b((h, a) => h.handleBreakpoint(a)) },
    { tool: t('get_call_stack'), domain: DOMAIN, bind: b((h, a) => h.handleGetCallStack(a)) },
    {
      tool: t('debugger_evaluate'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleDebuggerEvaluateDispatch(a)),
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
      tool: t('get_object_properties'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleGetObjectProperties(a)),
    },
    {
      tool: t('get_scope_variables_enhanced'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleGetScopeVariablesEnhanced(a)),
    },
    { tool: t('debugger_session'), domain: DOMAIN, bind: b((h, a) => h.handleDebuggerSession(a)) },
    { tool: t('watch'), domain: DOMAIN, bind: b((h, a) => h.handleWatch(a)) },
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
