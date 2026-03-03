import type { DomainManifest } from '../../registry/contracts.js';
import { toolLookup } from '../../registry/types.js';
import { bindByDepKey } from '../../registry/bind-helpers.js';
import { workflowToolDefinitions } from './definitions.js';
import { WorkflowHandlers } from './index.js';
import { BrowserToolHandlers } from '../browser/index.js';
import { AdvancedToolHandlers } from '../network/index.js';
import type { MCPServerContext } from '../../MCPServer.context.js';
import { CodeCollector } from '../../../modules/collector/CodeCollector.js';
import { PageController } from '../../../modules/collector/PageController.js';
import { DOMInspector } from '../../../modules/collector/DOMInspector.js';
import { ScriptManager } from '../../../modules/debugger/ScriptManager.js';
import { ConsoleMonitor } from '../../../modules/monitor/ConsoleMonitor.js';
import { LLMService } from '../../../services/LLMService.js';

const DOMAIN = 'workflow' as const;
const DEP_KEY = 'workflowHandlers' as const;
type H = WorkflowHandlers;
const t = toolLookup(workflowToolDefinitions);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  // workflow depends on browser + network handlers
  if (!ctx.collector) {
    ctx.collector = new CodeCollector(ctx.config.puppeteer);
    void ctx.registerCaches();
  }
  if (!ctx.pageController) ctx.pageController = new PageController(ctx.collector);
  if (!ctx.domInspector) ctx.domInspector = new DOMInspector(ctx.collector);
  if (!ctx.scriptManager) ctx.scriptManager = new ScriptManager(ctx.collector);
  if (!ctx.consoleMonitor) ctx.consoleMonitor = new ConsoleMonitor(ctx.collector);
  if (!ctx.llm) ctx.llm = new LLMService(ctx.config.llm);

  if (!ctx.browserHandlers) {
    ctx.browserHandlers = new BrowserToolHandlers(
      ctx.collector, ctx.pageController, ctx.domInspector,
      ctx.scriptManager, ctx.consoleMonitor, ctx.llm,
    );
  }
  if (!ctx.advancedHandlers) {
    ctx.advancedHandlers = new AdvancedToolHandlers(ctx.collector, ctx.consoleMonitor);
  }
  if (!ctx.workflowHandlers) {
    ctx.workflowHandlers = new WorkflowHandlers({
      browserHandlers: ctx.browserHandlers,
      advancedHandlers: ctx.advancedHandlers,
    });
  }
  return ctx.workflowHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full', 'reverse'],
  ensure,
  registrations: [
    { tool: t('web_api_capture_session'), domain: DOMAIN, bind: b((h, a) => h.handleWebApiCaptureSession(a)) },
    { tool: t('register_account_flow'), domain: DOMAIN, bind: b((h, a) => h.handleRegisterAccountFlow(a)) },
    { tool: t('page_script_register'), domain: DOMAIN, bind: b((h, a) => h.handlePageScriptRegister(a)) },
    { tool: t('page_script_run'), domain: DOMAIN, bind: b((h, a) => h.handlePageScriptRun(a)) },
    { tool: t('api_probe_batch'), domain: DOMAIN, bind: b((h, a) => h.handleApiProbeBatch(a)) },
    { tool: t('js_bundle_search'), domain: DOMAIN, bind: b((h, a) => h.handleJsBundleSearch(a)) },
    { tool: t('batch_register'), domain: DOMAIN, bind: b((h, a) => h.handleBatchRegister(a)) },
  ],
};

export default manifest;
