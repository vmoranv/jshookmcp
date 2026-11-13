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
import {
  SessionScopedResourcePool,
  sessionResourcePoolOptions,
} from '@server/runtime/SessionScopedResourcePool';

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
    { tool: 'workflow_conditional_step', method: 'handleWorkflowConditionalStepTool' },
    { tool: 'workflow_retry_policy', method: 'handleWorkflowRetryPolicyTool' },
    { tool: 'workflow_suggest', method: 'handleWorkflowSuggestTool' },
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
    const createHandlers = () =>
      new WorkflowHandlers({
        browserHandlers: browserHandlers!,
        advancedHandlers: advancedHandlers!,
        serverContext: ctx,
      });
    if (typeof ctx.setDomainInstance === 'function') {
      const pool = new SessionScopedResourcePool(
        createHandlers,
        undefined,
        sessionResourcePoolOptions(ctx.config?.mcp),
      );
      ctx.setDomainInstance('sessionWorkflowHandlersPool', pool);
      ctx.workflowHandlers = pool.getProxy();
    } else {
      ctx.workflowHandlers = createHandlers();
    }
  }

  // Macro handlers (merged from the former macro domain)
  if (!ctx.macroHandlers) {
    ctx.macroHandlers = new MacroToolHandlers(ctx);
  }

  return ctx.workflowHandlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  api_probe_batch: ['probe many endpoints at once', 'batch request health check', '批量探测接口'],
  js_bundle_search: ['find code inside bundles', 'search bundled javascript', 'bundle 内检索'],
  list_extension_workflows: ['what workflows exist', 'enumerate plugin recipes', '列出工作流'],
  list_macros: ['show saved macros', 'enumerate macro library', '列出宏'],
  page_script_register: [
    'install a script before page load',
    'persistent inject on navigate',
    '预载脚本',
  ],
  page_script_run: ['run a script right now in page', 'execute ad hoc page code', '执行页面脚本'],
  reverse_session: ['start a reversing session', 'begin analysis workspace', '开逆向会话'],
  run_extension_workflow: ['execute a plugin recipe', 'run the workflow steps', '运行工作流'],
  run_macro: ['play back a macro', 'execute recorded macro', '运行宏'],
  workflow_conditional_step: ['branch workflow on condition', 'if step in recipe', '条件步骤'],
  workflow_retry_policy: ['configure retry behavior', 'rerun on failure policy', '重试策略'],
  workflow_run_inspect: ['inspect a workflow execution', 'see run details', '检查运行'],
  workflow_suggest: ['recommend a recipe', 'which workflow fits this task', '推荐工作流'],
};

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

  // Document-expansion keywords for the retrieval layer (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
