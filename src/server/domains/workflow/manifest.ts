import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, ensureBrowserCore, toolLookup } from '@server/domains/shared/registry';
import { workflowToolDefinitions } from '@server/domains/workflow/definitions';
import { WorkflowHandlers } from '@server/domains/workflow/index';

const DOMAIN = 'workflow' as const;
const DEP_KEY = 'workflowHandlers' as const;
type H = WorkflowHandlers;
const t = toolLookup(workflowToolDefinitions);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  ensureBrowserCore(ctx);

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
  return ctx.workflowHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  ensure,

  workflowRule: {
    patterns: [/(workflow|extension|run)/i, /(工作流|扩展|运行)/i],
    priority: 95,
    tools: ['run_extension_workflow', 'list_extension_workflows'],
    hint: 'Extension workflow: list available workflows -> run the best matching workflow',
  },

  registrations: [
    {
      tool: t('page_script_register'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePageScriptRegister(a)),
    },
    { tool: t('page_script_run'), domain: DOMAIN, bind: b((h, a) => h.handlePageScriptRun(a)) },
    { tool: t('api_probe_batch'), domain: DOMAIN, bind: b((h, a) => h.handleApiProbeBatch(a)) },
    { tool: t('js_bundle_search'), domain: DOMAIN, bind: b((h, a) => h.handleJsBundleSearch(a)) },
    {
      tool: t('list_extension_workflows'),
      domain: DOMAIN,
      bind: b((h) => h.handleListExtensionWorkflows()),
    },
    {
      tool: t('run_extension_workflow'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleRunExtensionWorkflow(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
