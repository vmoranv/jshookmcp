import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, ensureBrowserCore, toolLookup } from '@server/domains/shared/registry';
import { browserTools, advancedBrowserToolDefinitions } from '@server/domains/browser/definitions';
import type { BrowserToolHandlers } from '@server/domains/browser/index';

const DOMAIN = 'browser' as const;
const DEP_KEY = 'browserHandlers' as const;
type H = BrowserToolHandlers;
const t = toolLookup([...browserTools, ...advancedBrowserToolDefinitions]);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

async function ensure(ctx: MCPServerContext): Promise<H> {
  const { BrowserToolHandlers } = await import('@server/domains/browser/index');
  await ensureBrowserCore(ctx);

  if (!ctx.browserHandlers) {
    ctx.browserHandlers = new BrowserToolHandlers(
      ctx.collector!,
      ctx.pageController!,
      ctx.scriptManager!,
      ctx.consoleMonitor!,
      ctx.eventBus,
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
    tools: ['page_navigate', 'page_screenshot', 'page_click', 'page_type', 'page_evaluate'],
    hint: 'Browser automation workflow: bootstrap browser/page state -> navigate -> interact -> extract data',
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

  registrations: [
    { tool: t('get_detailed_data'), domain: DOMAIN, bind: b((h, a) => h.handleGetDetailedData(a)) },
    { tool: t('browser_attach'), domain: DOMAIN, bind: b((h, a) => h.handleBrowserAttach(a)) },
    { tool: t('browser_list_tabs'), domain: DOMAIN, bind: b((h, a) => h.handleBrowserListTabs(a)) },
    {
      tool: t('browser_list_cdp_targets'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleBrowserListCdpTargets(a)),
    },
    {
      tool: t('browser_select_tab'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleBrowserSelectTab(a)),
    },
    {
      tool: t('browser_attach_cdp_target'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleBrowserAttachCdpTarget(a)),
    },
    {
      tool: t('browser_detach_cdp_target'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleBrowserDetachCdpTarget(a)),
    },
    {
      tool: t('browser_evaluate_cdp_target'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleBrowserEvaluateCdpTarget(a)),
    },
    { tool: t('browser_launch'), domain: DOMAIN, bind: b((h, a) => h.handleBrowserLaunch(a)) },
    { tool: t('browser_close'), domain: DOMAIN, bind: b((h, a) => h.handleBrowserClose(a)) },
    { tool: t('browser_status'), domain: DOMAIN, bind: b((h, a) => h.handleBrowserStatus(a)) },
    { tool: t('page_navigate'), domain: DOMAIN, bind: b((h, a) => h.handlePageNavigate(a)) },
    { tool: t('page_reload'), domain: DOMAIN, bind: b((h, a) => h.handlePageReload(a)) },
    { tool: t('page_back'), domain: DOMAIN, bind: b((h, a) => h.handlePageBack(a)) },
    { tool: t('page_forward'), domain: DOMAIN, bind: b((h, a) => h.handlePageForward(a)) },

    { tool: t('page_click'), domain: DOMAIN, bind: b((h, a) => h.handlePageClick(a)) },
    { tool: t('page_type'), domain: DOMAIN, bind: b((h, a) => h.handlePageType(a)) },
    { tool: t('page_select'), domain: DOMAIN, bind: b((h, a) => h.handlePageSelect(a)) },
    { tool: t('page_hover'), domain: DOMAIN, bind: b((h, a) => h.handlePageHover(a)) },
    { tool: t('page_scroll'), domain: DOMAIN, bind: b((h, a) => h.handlePageScroll(a)) },
    {
      tool: t('page_wait_for_selector'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePageWaitForSelector(a)),
    },
    { tool: t('page_evaluate'), domain: DOMAIN, bind: b((h, a) => h.handlePageEvaluate(a)) },
    { tool: t('page_screenshot'), domain: DOMAIN, bind: b((h, a) => h.handlePageScreenshot(a)) },
    { tool: t('get_all_scripts'), domain: DOMAIN, bind: b((h, a) => h.handleGetAllScripts(a)) },
    { tool: t('get_script_source'), domain: DOMAIN, bind: b((h, a) => h.handleGetScriptSource(a)) },
    { tool: t('console_monitor'), domain: DOMAIN, bind: b((h, a) => h.handleConsoleMonitor(a)) },
    { tool: t('console_get_logs'), domain: DOMAIN, bind: b((h, a) => h.handleConsoleGetLogs(a)) },
    { tool: t('console_execute'), domain: DOMAIN, bind: b((h, a) => h.handleConsoleExecute(a)) },

    {
      tool: t('page_inject_script'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePageInjectScript(a)),
    },
    { tool: t('page_cookies'), domain: DOMAIN, bind: b((h, a) => h.handlePageCookiesDispatch(a)) },
    { tool: t('page_set_viewport'), domain: DOMAIN, bind: b((h, a) => h.handlePageSetViewport(a)) },
    {
      tool: t('page_emulate_device'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePageEmulateDevice(a)),
    },
    {
      tool: t('page_local_storage'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePageLocalStorageDispatch(a)),
    },
    { tool: t('page_press_key'), domain: DOMAIN, bind: b((h, a) => h.handlePagePressKey(a)) },

    { tool: t('captcha_detect'), domain: DOMAIN, bind: b((h, a) => h.handleCaptchaDetect(a)) },
    { tool: t('captcha_wait'), domain: DOMAIN, bind: b((h, a) => h.handleCaptchaWait(a)) },
    { tool: t('captcha_config'), domain: DOMAIN, bind: b((h, a) => h.handleCaptchaConfig(a)) },
    { tool: t('stealth_inject'), domain: DOMAIN, bind: b((h, a) => h.handleStealthInject(a)) },
    {
      tool: t('stealth_set_user_agent'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleStealthSetUserAgent(a)),
    },
    {
      tool: t('stealth_configure_jitter'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleStealthConfigureJitter(a)),
    },
    {
      tool: t('stealth_generate_fingerprint'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleStealthGenerateFingerprint(a)),
    },
    {
      tool: t('stealth_verify'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleStealthVerify(a)),
    },
    {
      tool: t('camoufox_geolocation'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleCamoufoxGeolocation(a)),
    },
    {
      tool: t('camoufox_server'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleCamoufoxServerDispatch(a)),
    },
    {
      tool: t('framework_state_extract'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleFrameworkStateExtract(a)),
    },
    { tool: t('indexeddb_dump'), domain: DOMAIN, bind: b((h, a) => h.handleIndexedDBDump(a)) },
    { tool: t('js_heap_search'), domain: DOMAIN, bind: b((h, a) => h.handleJSHeapSearch(a)) },
    { tool: t('tab_workflow'), domain: DOMAIN, bind: b((h, a) => h.handleTabWorkflow(a)) },
    // Human behavior simulation
    { tool: t('human_mouse'), domain: DOMAIN, bind: b((h, a) => h.handleHumanMouse(a)) },
    { tool: t('human_scroll'), domain: DOMAIN, bind: b((h, a) => h.handleHumanScroll(a)) },
    { tool: t('human_typing'), domain: DOMAIN, bind: b((h, a) => h.handleHumanTyping(a)) },
    // CAPTCHA solving
    {
      tool: t('captcha_vision_solve'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleCaptchaVisionSolve(a)),
    },
    {
      tool: t('widget_challenge_solve'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleWidgetChallengeSolve(a)),
    },
    // ── JSDOM (headless DOM, no browser) ──
    {
      tool: t('browser_jsdom_parse'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleJsdomParse(a)),
    },
    {
      tool: t('browser_jsdom_query'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleJsdomQuery(a)),
    },
    {
      tool: t('browser_jsdom_execute'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleJsdomExecute(a)),
    },
    {
      tool: t('browser_jsdom_serialize'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleJsdomSerialize(a)),
    },
    {
      tool: t('browser_jsdom_cookies'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleJsdomCookies(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
