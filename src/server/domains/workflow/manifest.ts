import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import {
  defineMethodRegistrations,
  ensureBrowserCore,
  toolLookup,
} from '@server/domains/shared/registry';
import { workflowToolDefinitions } from '@server/domains/workflow/definitions';
import { macroTools } from '@server/domains/workflow/macro/definitions';
import type { WorkflowHandlers } from '@server/domains/workflow/index';
import type { MacroToolHandlers } from '@server/domains/workflow/macro';

const DOMAIN = 'workflow' as const;
const DEP_KEY = 'workflowHandlers' as const;
const MACRO_DEP_KEY = 'macroHandlers' as const;
type H = WorkflowHandlers;
type M = MacroToolHandlers;
const t = toolLookup([...workflowToolDefinitions, ...macroTools]);
const registrations = defineMethodRegistrations<
  H,
  (typeof workflowToolDefinitions)[number]['name']
>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'page_script_register', method: 'handlePageScriptRegisterTool' },
    { tool: 'page_script_run', method: 'handlePageScriptRunTool' },
    { tool: 'api_probe_batch', method: 'handleApiProbeBatchTool' },
    { tool: 'js_bundle_search', method: 'handleJsBundleSearchTool' },
    { tool: 'list_extension_workflows', method: 'handleListExtensionWorkflowsTool' },
    { tool: 'run_extension_workflow', method: 'handleRunExtensionWorkflowTool' },
    { tool: 'reverse_session', method: 'handleReverseSessionTool', profiles: ['full'] },
    { tool: 'workflow_run_inspect', method: 'handleWorkflowRunInspectTool' },
  ],
});
const macroRegistrations = defineMethodRegistrations<M, (typeof macroTools)[number]['name']>({
  domain: DOMAIN,
  depKey: MACRO_DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'run_macro', method: 'handleRunMacroTool', profiles: ['full'] },
    { tool: 'list_macros', method: 'handleListMacrosTool', profiles: ['full'] },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { WorkflowHandlers } = await import('@server/domains/workflow/index');
  const { MacroToolHandlers } = await import('@server/domains/workflow/macro');
  await ensureBrowserCore(ctx);

  // Delegate via handlerDeps proxy, not direct imports
  const browserHandlers = ctx.handlerDeps.browserHandlers as typeof ctx.browserHandlers;
  const advancedHandlers = ctx.handlerDeps.advancedHandlers as typeof ctx.advancedHandlers;

  if (!ctx.workflowHandlers) {
    ctx.workflowHandlers = new WorkflowHandlers({
      browserHandlers: browserHandlers!,
      advancedHandlers: advancedHandlers!,
      serverContext: ctx,
    });
  }

  // Macro handlers (merged from the former macro domain)
  if (!ctx.macroHandlers) {
    ctx.macroHandlers = new MacroToolHandlers(ctx);
  }

  return ctx.workflowHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  secondaryDepKeys: ['macroHandlers'],
  profiles: ['workflow', 'full'],
  ensure,

  workflowRule: {
    patterns: [
      /(workflow|extension|run|macro)/i,
      /(工作流|扩展|运行|宏)/i,
      /(reverse|re).*(session|workflow|pipeline|full.?chain|托管|全链路)/i,
      /(android|apk|dex|frida|adb).*(dump|intake|artifact|session)/i,
    ],
    priority: 95,
    tools: [
      'run_extension_workflow',
      'list_extension_workflows',
      'run_macro',
      'list_macros',
      'reverse_session',
    ],
    hint: 'Workflow & macros: list workflows → run workflow; list macros → run macro; reverse_session creates recoverable full-chain reverse evidence workflows.',
  },

  prerequisites: {
    page_script_run: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    api_probe_batch: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
      {
        condition: 'Network monitoring must be enabled',
        fix: 'Call network_monitor(enable) first',
      },
    ],
    js_bundle_search: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    run_extension_workflow: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
  },

  registrations: [...registrations, ...macroRegistrations],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
