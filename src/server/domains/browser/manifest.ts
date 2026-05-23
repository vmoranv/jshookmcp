import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import {
  defineMethodRegistrations,
  ensureBrowserCore,
  toolLookup,
} from '@server/domains/shared/registry';
import { browserTools, advancedBrowserToolDefinitions } from '@server/domains/browser/definitions';
import type { BrowserToolHandlers } from '@server/domains/browser/index';
import { getRuntimeState } from '@server/runtime/ServerRuntimeState';
import { BrowserSessionCoordinator } from '@server/runtime/BrowserSessionCoordinator';

const DOMAIN = 'browser' as const;
const DEP_KEY = 'browserHandlers' as const;
type H = BrowserToolHandlers;
const toolDefinitions = [...browserTools, ...advancedBrowserToolDefinitions] as const;
const t = toolLookup(toolDefinitions);
const registrations = defineMethodRegistrations<H, (typeof toolDefinitions)[number]['name']>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: t,
  entries: [
    { tool: 'get_detailed_data', method: 'handleGetDetailedData' },
    { tool: 'browser_attach', method: 'handleBrowserAttach' },
    { tool: 'browser_list_tabs', method: 'handleBrowserListTabs' },
    { tool: 'browser_list_cdp_targets', method: 'handleBrowserListCdpTargets' },
    { tool: 'browser_select_tab', method: 'handleBrowserSelectTab' },
    { tool: 'browser_attach_cdp_target', method: 'handleBrowserAttachCdpTarget' },
    { tool: 'browser_detach_cdp_target', method: 'handleBrowserDetachCdpTarget' },
    { tool: 'browser_evaluate_cdp_target', method: 'handleBrowserEvaluateCdpTarget' },
    { tool: 'browser_launch', method: 'handleBrowserLaunch' },
    { tool: 'browser_close', method: 'handleBrowserClose' },
    { tool: 'browser_status', method: 'handleBrowserStatus' },
    { tool: 'page_navigate', method: 'handlePageNavigate' },
    { tool: 'page_reload', method: 'handlePageReload' },
    { tool: 'page_back', method: 'handlePageBack' },
    { tool: 'page_forward', method: 'handlePageForward' },
    { tool: 'page_list_frames', method: 'handlePageListFrames' },
    { tool: 'page_click', method: 'handlePageClick' },
    { tool: 'page_type', method: 'handlePageType' },
    { tool: 'page_upload_files', method: 'handlePageUploadFiles' },
    { tool: 'page_select', method: 'handlePageSelect' },
    { tool: 'page_hover', method: 'handlePageHover' },
    { tool: 'page_scroll', method: 'handlePageScroll' },
    { tool: 'page_wait_for_selector', method: 'handlePageWaitForSelector' },
    { tool: 'page_evaluate', method: 'handlePageEvaluate' },
    { tool: 'page_screenshot', method: 'handlePageScreenshot' },
    { tool: 'get_all_scripts', method: 'handleGetAllScripts' },
    { tool: 'get_script_source', method: 'handleGetScriptSource' },
    { tool: 'console_monitor', method: 'handleConsoleMonitor' },
    { tool: 'console_get_logs', method: 'handleConsoleGetLogs' },
    { tool: 'console_execute', method: 'handleConsoleExecute' },
    { tool: 'page_inject_script', method: 'handlePageInjectScript' },
    { tool: 'page_cookies', method: 'handlePageCookiesDispatch' },
    { tool: 'page_set_viewport', method: 'handlePageSetViewport' },
    { tool: 'page_emulate_device', method: 'handlePageEmulateDevice' },
    { tool: 'page_local_storage', method: 'handlePageLocalStorageDispatch' },
    { tool: 'page_press_key', method: 'handlePagePressKey' },
    { tool: 'captcha_detect', method: 'handleCaptchaDetect' },
    { tool: 'captcha_wait', method: 'handleCaptchaWait' },
    { tool: 'captcha_config', method: 'handleCaptchaConfig' },
    { tool: 'stealth_inject', method: 'handleStealthInject' },
    { tool: 'stealth_set_user_agent', method: 'handleStealthSetUserAgent' },
    { tool: 'stealth_configure_jitter', method: 'handleStealthConfigureJitter' },
    { tool: 'stealth_generate_fingerprint', method: 'handleStealthGenerateFingerprint' },
    { tool: 'stealth_verify', method: 'handleStealthVerify' },
    { tool: 'camoufox_geolocation', method: 'handleCamoufoxGeolocation' },
    { tool: 'camoufox_server', method: 'handleCamoufoxServerDispatch' },
    { tool: 'framework_state_extract', method: 'handleFrameworkStateExtract' },
    { tool: 'indexeddb_dump', method: 'handleIndexedDBDump' },
    { tool: 'js_heap_search', method: 'handleJSHeapSearch' },
    { tool: 'tab_workflow', method: 'handleTabWorkflow' },
    { tool: 'browser_codegen_start', method: 'handleBrowserCodegenStart' },
    { tool: 'browser_codegen_stop', method: 'handleBrowserCodegenStop' },
    { tool: 'human_mouse', method: 'handleHumanMouse' },
    { tool: 'human_scroll', method: 'handleHumanScroll' },
    { tool: 'human_typing', method: 'handleHumanTyping' },
    { tool: 'captcha_solver_capabilities', method: 'handleCaptchaSolverCapabilities' },
    { tool: 'captcha_vision_solve', method: 'handleCaptchaVisionSolve' },
    { tool: 'widget_challenge_solve', method: 'handleWidgetChallengeSolve' },
    { tool: 'browser_jsdom_parse', method: 'handleJsdomParse' },
    { tool: 'browser_jsdom_query', method: 'handleJsdomQuery' },
    { tool: 'browser_jsdom_execute', method: 'handleJsdomExecute' },
    { tool: 'browser_jsdom_serialize', method: 'handleJsdomSerialize' },
    { tool: 'browser_jsdom_cookies', method: 'handleJsdomCookies' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { BrowserToolHandlers } = await import('@server/domains/browser/index');
  await ensureBrowserCore(ctx);

  if (!ctx.browserHandlers) {
    const compatCtx = ctx as unknown as Record<string, unknown>;
    const getDomainInstance =
      typeof ctx.getDomainInstance === 'function' ? ctx.getDomainInstance.bind(ctx) : null;
    const setDomainInstance =
      typeof ctx.setDomainInstance === 'function' ? ctx.setDomainInstance.bind(ctx) : null;
    const coordinator =
      getDomainInstance?.<BrowserSessionCoordinator>('browserSessionCoordinator') ??
      (compatCtx.browserSessionCoordinator as BrowserSessionCoordinator | undefined) ??
      new BrowserSessionCoordinator(() => ctx.collector);
    if (setDomainInstance) {
      setDomainInstance('browserSessionCoordinator', coordinator);
    } else {
      compatCtx.browserSessionCoordinator = coordinator;
    }
    ctx.browserHandlers = new BrowserToolHandlers(
      ctx.collector!,
      ctx.pageController!,
      ctx.scriptManager!,
      ctx.consoleMonitor!,
      ctx.eventBus,
      () => coordinator.getCurrentSessionId(),
      coordinator,
      (snapshot) => {
        getRuntimeState(ctx)?.setBrowserAttach(snapshot);
      },
    );
  }
  return ctx.browserHandlers;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
  ensure,

  // ── Routing metadata (consumed by ToolRouter) ──

  workflowRule: {
    patterns: [
      /(browser|page|navigate|screenshot|click|type|scrape)/i,
      /(浏览器|页面|导航|截图|点击|输入|爬取)/i,
    ],
    priority: 90,
    tools: [
      'page_navigate',
      'page_evaluate',
      'browser_jsdom_parse',
      'console_get_logs',
      'page_click',
      'page_type',
      'page_screenshot',
    ],
    hint:
      'Browser automation workflow: bootstrap browser/page state -> inspect page state -> interact -> capture ' +
      'visual ' +
      'evidence only when needed',
  },

  prerequisites: {
    page_navigate: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    page_click: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    page_type: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    page_upload_files: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    page_screenshot: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    page_evaluate: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    page_hover: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    page_back: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    page_forward: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    page_reload: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
    page_scroll: [
      { condition: 'Browser must be launched', fix: 'Call browser_launch or browser_attach first' },
    ],
  },

  registrations,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
