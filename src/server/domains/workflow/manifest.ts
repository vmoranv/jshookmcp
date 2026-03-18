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

  // Delegate to browser/network domain ensures via handlerDeps proxy
  // instead of importing and instantiating concrete handler classes directly.
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
  profiles: ['workflow', 'full'],
  ensure,
  registrations: [
    {
      tool: t('web_api_capture_session'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleWebApiCaptureSession(a)),
    },
    {
      tool: t('register_account_flow'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleRegisterAccountFlow(a)),
    },
    {
      tool: t('page_script_register'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePageScriptRegister(a)),
    },
    { tool: t('page_script_run'), domain: DOMAIN, bind: b((h, a) => h.handlePageScriptRun(a)) },
    { tool: t('api_probe_batch'), domain: DOMAIN, bind: b((h, a) => h.handleApiProbeBatch(a)) },
    { tool: t('js_bundle_search'), domain: DOMAIN, bind: b((h, a) => h.handleJsBundleSearch(a)) },
    { tool: t('batch_register'), domain: DOMAIN, bind: b((h, a) => h.handleBatchRegister(a)) },
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
