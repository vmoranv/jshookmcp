import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, ensureBrowserCore, toolLookup } from '@server/domains/shared/registry';
import { browserTools, advancedBrowserToolDefinitions } from '@server/domains/browser/definitions';
import { BrowserToolHandlers } from '@server/domains/browser/index';

const DOMAIN = 'browser' as const;
const DEP_KEY = 'browserHandlers' as const;
type H = BrowserToolHandlers;
const t = toolLookup([...browserTools, ...advancedBrowserToolDefinitions]);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  ensureBrowserCore(ctx);

  if (!ctx.browserHandlers) {
    ctx.browserHandlers = new BrowserToolHandlers(
      ctx.collector!, ctx.pageController!, ctx.domInspector!,
      ctx.scriptManager!, ctx.consoleMonitor!, ctx.llm!,
    );
  }
  return ctx.browserHandlers;
}

const manifest: DomainManifest<typeof DEP_KEY, H, typeof DOMAIN> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['minimal', 'workflow', 'full'],
  ensure,
  registrations: [
    { tool: t('get_detailed_data'), domain: DOMAIN, bind: b((h, a) => h.handleGetDetailedData(a)) },
    { tool: t('browser_attach'), domain: DOMAIN, bind: b((h, a) => h.handleBrowserAttach(a)) },
    { tool: t('browser_list_tabs'), domain: DOMAIN, bind: b((h, a) => h.handleBrowserListTabs(a)) },
    { tool: t('browser_select_tab'), domain: DOMAIN, bind: b((h, a) => h.handleBrowserSelectTab(a)) },
    { tool: t('browser_launch'), domain: DOMAIN, bind: b((h, a) => h.handleBrowserLaunch(a)) },
    { tool: t('browser_close'), domain: DOMAIN, bind: b((h, a) => h.handleBrowserClose(a)) },
    { tool: t('browser_status'), domain: DOMAIN, bind: b((h, a) => h.handleBrowserStatus(a)) },
    { tool: t('page_navigate'), domain: DOMAIN, bind: b((h, a) => h.handlePageNavigate(a)) },
    { tool: t('page_reload'), domain: DOMAIN, bind: b((h, a) => h.handlePageReload(a)) },
    { tool: t('page_back'), domain: DOMAIN, bind: b((h, a) => h.handlePageBack(a)) },
    { tool: t('page_forward'), domain: DOMAIN, bind: b((h, a) => h.handlePageForward(a)) },
    { tool: t('dom_query_selector'), domain: DOMAIN, bind: b((h, a) => h.handleDOMQuerySelector(a)) },
    { tool: t('dom_query_all'), domain: DOMAIN, bind: b((h, a) => h.handleDOMQueryAll(a)) },
    { tool: t('dom_get_structure'), domain: DOMAIN, bind: b((h, a) => h.handleDOMGetStructure(a)) },
    { tool: t('dom_find_clickable'), domain: DOMAIN, bind: b((h, a) => h.handleDOMFindClickable(a)) },
    { tool: t('page_click'), domain: DOMAIN, bind: b((h, a) => h.handlePageClick(a)) },
    { tool: t('page_type'), domain: DOMAIN, bind: b((h, a) => h.handlePageType(a)) },
    { tool: t('page_select'), domain: DOMAIN, bind: b((h, a) => h.handlePageSelect(a)) },
    { tool: t('page_hover'), domain: DOMAIN, bind: b((h, a) => h.handlePageHover(a)) },
    { tool: t('page_scroll'), domain: DOMAIN, bind: b((h, a) => h.handlePageScroll(a)) },
    { tool: t('page_wait_for_selector'), domain: DOMAIN, bind: b((h, a) => h.handlePageWaitForSelector(a)) },
    { tool: t('page_evaluate'), domain: DOMAIN, bind: b((h, a) => h.handlePageEvaluate(a)) },
    { tool: t('page_screenshot'), domain: DOMAIN, bind: b((h, a) => h.handlePageScreenshot(a)) },
    { tool: t('get_all_scripts'), domain: DOMAIN, bind: b((h, a) => h.handleGetAllScripts(a)) },
    { tool: t('get_script_source'), domain: DOMAIN, bind: b((h, a) => h.handleGetScriptSource(a)) },
    { tool: t('console_enable'), domain: DOMAIN, bind: b((h, a) => h.handleConsoleEnable(a)) },
    { tool: t('console_get_logs'), domain: DOMAIN, bind: b((h, a) => h.handleConsoleGetLogs(a)) },
    { tool: t('console_execute'), domain: DOMAIN, bind: b((h, a) => h.handleConsoleExecute(a)) },
    { tool: t('dom_get_computed_style'), domain: DOMAIN, bind: b((h, a) => h.handleDOMGetComputedStyle(a)) },
    { tool: t('dom_find_by_text'), domain: DOMAIN, bind: b((h, a) => h.handleDOMFindByText(a)) },
    { tool: t('dom_get_xpath'), domain: DOMAIN, bind: b((h, a) => h.handleDOMGetXPath(a)) },
    { tool: t('dom_is_in_viewport'), domain: DOMAIN, bind: b((h, a) => h.handleDOMIsInViewport(a)) },
    { tool: t('page_get_performance'), domain: DOMAIN, bind: b((h, a) => h.handlePageGetPerformance(a)) },
    { tool: t('page_inject_script'), domain: DOMAIN, bind: b((h, a) => h.handlePageInjectScript(a)) },
    { tool: t('page_set_cookies'), domain: DOMAIN, bind: b((h, a) => h.handlePageSetCookies(a)) },
    { tool: t('page_get_cookies'), domain: DOMAIN, bind: b((h, a) => h.handlePageGetCookies(a)) },
    { tool: t('page_clear_cookies'), domain: DOMAIN, bind: b((h, a) => h.handlePageClearCookies(a)) },
    { tool: t('page_set_viewport'), domain: DOMAIN, bind: b((h, a) => h.handlePageSetViewport(a)) },
    { tool: t('page_emulate_device'), domain: DOMAIN, bind: b((h, a) => h.handlePageEmulateDevice(a)) },
    { tool: t('page_get_local_storage'), domain: DOMAIN, bind: b((h, a) => h.handlePageGetLocalStorage(a)) },
    { tool: t('page_set_local_storage'), domain: DOMAIN, bind: b((h, a) => h.handlePageSetLocalStorage(a)) },
    { tool: t('page_press_key'), domain: DOMAIN, bind: b((h, a) => h.handlePagePressKey(a)) },
    { tool: t('page_get_all_links'), domain: DOMAIN, bind: b((h, a) => h.handlePageGetAllLinks(a)) },
    { tool: t('captcha_detect'), domain: DOMAIN, bind: b((h, a) => h.handleCaptchaDetect(a)) },
    { tool: t('captcha_wait'), domain: DOMAIN, bind: b((h, a) => h.handleCaptchaWait(a)) },
    { tool: t('captcha_config'), domain: DOMAIN, bind: b((h, a) => h.handleCaptchaConfig(a)) },
    { tool: t('stealth_inject'), domain: DOMAIN, bind: b((h, a) => h.handleStealthInject(a)) },
    { tool: t('stealth_set_user_agent'), domain: DOMAIN, bind: b((h, a) => h.handleStealthSetUserAgent(a)) },
    { tool: t('camoufox_server_launch'), domain: DOMAIN, bind: b((h, a) => h.handleCamoufoxServerLaunch(a)) },
    { tool: t('camoufox_server_close'), domain: DOMAIN, bind: b((h, a) => h.handleCamoufoxServerClose(a)) },
    { tool: t('camoufox_server_status'), domain: DOMAIN, bind: b((h, a) => h.handleCamoufoxServerStatus(a)) },
    { tool: t('framework_state_extract'), domain: DOMAIN, bind: b((h, a) => h.handleFrameworkStateExtract(a)) },
    { tool: t('indexeddb_dump'), domain: DOMAIN, bind: b((h, a) => h.handleIndexedDBDump(a)) },
    { tool: t('js_heap_search'), domain: DOMAIN, bind: b((h, a) => h.handleJSHeapSearch(a)) },
    { tool: t('tab_workflow'), domain: DOMAIN, bind: b((h, a) => h.handleTabWorkflow(a)) },
    // Human behavior simulation
    { tool: t('human_mouse'), domain: DOMAIN, bind: b((h, a) => h.handleHumanMouse(a)) },
    { tool: t('human_scroll'), domain: DOMAIN, bind: b((h, a) => h.handleHumanScroll(a)) },
    { tool: t('human_typing'), domain: DOMAIN, bind: b((h, a) => h.handleHumanTyping(a)) },
    // CAPTCHA solving
    { tool: t('captcha_vision_solve'), domain: DOMAIN, bind: b((h, a) => h.handleCaptchaVisionSolve(a)) },
    { tool: t('widget_challenge_solve'), domain: DOMAIN, bind: b((h, a) => h.handleWidgetChallengeSolve(a)) },
  ],
};

export default manifest;
