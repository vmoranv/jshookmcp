/**
 * browser domain contract cases — the 59 CDP/page-bound tools.
 *
 * Substrate: a `collector` and `pageController` whose every method raises the
 * same `PrerequisiteError` the real ones raise when no browser is attached
 * (`CodeCollector.getActivePage()` throws `Browser not available: ...`, and
 * `PageController` methods all go through it). That makes the assertion a real
 * product contract rather than a stub artifact:
 *
 *   no browser → a NAMED prerequisite failure, and no fabricated payload
 *   (no screenshots, no metrics, no stealth verdict, no captcha result).
 *
 * Argument-validation cases are included where the tool rejects a call before
 * touching the page at all — those must name the offending argument.
 */
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { BrowserToolHandlers } from '@server/domains/browser/handlers.impl';

type Args = Record<string, unknown>;

const NO_BROWSER = 'Browser not available: no browser launched (bench)';

/**
 * Any property access yields a function that raises the no-browser
 * PrerequisiteError SYNCHRONOUSLY. Synchronous matters: a few handlers start a
 * background call without awaiting it, and a rejected promise from that call
 * becomes an unhandled rejection that fails the whole run — a synchronous throw
 * is caught by the handler's own try/catch. Covers every collector /
 * page-controller method without enumerating the (large) surface.
 */
function unavailableSurface(): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return undefined;
        return () => {
          throw new PrerequisiteError(NO_BROWSER);
        };
      },
    },
  );
}

function noBrowserHandlers(): BrowserToolHandlers {
  const collector = unavailableSurface();
  const pageController = unavailableSurface();
  return new BrowserToolHandlers(
    collector as never,
    pageController as never,
    unavailableSurface() as never,
    unavailableSurface() as never,
    {} as never,
  );
}

/** Flatten a handler call, capturing a throw as text. */
async function call(
  run: () => Promise<unknown>,
): Promise<{ ok: boolean; body?: Args; text: string }> {
  try {
    const response = await run();
    const first = (response as { content?: Array<{ text?: string }> }).content?.[0]?.text;
    if (typeof first !== 'string') {
      return { ok: true, body: response as Args, text: JSON.stringify(response) };
    }
    try {
      return { ok: true, body: JSON.parse(first) as Args, text: first };
    } catch {
      return { ok: true, body: { raw: first }, text: first };
    }
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * A no-browser call must fail and name the missing browser. Any payload key
 * listed in `forbidden` proves data was fabricated alongside the failure.
 */
function prerequisiteFailure(v: unknown, forbidden: string[] = []): true | string {
  const r = v as { ok: boolean; body?: Args; text: string };
  const data = r.ok ? (r.body ?? {}) : { raw: r.text };
  const serialized = JSON.stringify(data);
  if (!/Browser not available|No active page|not available|PREREQUISITE/i.test(serialized)) {
    return `expected a named no-browser failure: ${serialized.slice(0, 220)}`;
  }
  for (const key of forbidden) {
    if (data[key] !== undefined) return `must not return "${key}" without a browser`;
  }
  return true;
}

/** A stop-without-start refusal must name the matching start step. */
function namesStartStep(v: unknown, pattern: RegExp): true | string {
  const r = v as { ok: boolean; body?: Args; text: string };
  const serialized = r.ok ? JSON.stringify(r.body) : r.text;
  if (/Browser not available|No active page|not available/i.test(serialized)) return true;
  return pattern.test(serialized)
    ? true
    : `refusal should name the start step ${pattern}: ${serialized.slice(0, 220)}`;
}

/** Camoufox status without a server must be an explicit not-running answer. */
function expectsNotRunning(v: unknown): true | string {
  const r = v as { ok: boolean; body?: Args; text: string };
  const b = r.ok ? (r.body ?? {}) : { raw: r.text };
  if (b['running'] === false) {
    return b['wsEndpoint'] === null || b['wsEndpoint'] === undefined
      ? true
      : `must not report an endpoint while not running`;
  }
  return /Browser not available|not available/i.test(JSON.stringify(b))
    ? true
    : `expected running:false, got ${JSON.stringify(b).slice(0, 200)}`;
}

/** A rejection must name the given argument. */
function namesArgument(v: unknown, pattern: RegExp): true | string {
  const r = v as { ok: boolean; body?: Args; text: string };
  const serialized = r.ok ? JSON.stringify(r.body) : r.text;
  return pattern.test(serialized)
    ? true
    : `rejection does not name ${pattern}: ${serialized.slice(0, 220)}`;
}

const handlers = noBrowserHandlers();

interface CaseSpec {
  readonly name: string;
  readonly tool: string;
  readonly note: string;
  readonly forbidden?: string[];
  readonly run: () => Promise<unknown>;
  readonly validate?: (v: unknown) => true | string;
}

/** Tools that must surface the no-browser prerequisite instead of inventing data. */
const PREREQUISITE_CASES: readonly CaseSpec[] = [
  {
    name: 'browser_launch/reports-launch-failure',
    tool: 'browser_launch',
    note: 'launching is delegated to the collector; a collector that cannot launch produces a named failure, never a fake session',
    run: () => call(() => handlers.handleBrowserLaunch({})),
  },
  {
    name: 'browser_close/reports-close-failure',
    tool: 'browser_close',
    note: 'closing without a browser reports the failure instead of claiming the browser was closed',
    run: () => call(() => handlers.handleBrowserClose({})),
  },
  {
    name: 'browser_list_cdp_targets/requires-collector',
    tool: 'browser_list_cdp_targets',
    note: 'CDP target discovery needs the collector and must not return a fabricated target list',
    forbidden: ['targets'],
    run: () => call(() => handlers.handleBrowserListCdpTargets({})),
  },
  {
    name: 'browser_detach_cdp_target/requires-attached-target',
    tool: 'browser_detach_cdp_target',
    note: 'detaching needs an attached target session; without one the failure is named',
    run: () => call(() => handlers.handleBrowserDetachCdpTarget({})),
  },
  {
    name: 'browser_select_tab/requires-collector',
    tool: 'browser_select_tab',
    note: 'tab selection needs the collector page list; no fabricated selection',
    run: () => call(() => handlers.handleBrowserSelectTab({ index: 0 })),
  },
  {
    name: 'page_navigate/requires-page',
    tool: 'page_navigate',
    note: 'navigation needs the page controller; the failure names the missing browser',
    run: () => call(() => handlers.handlePageNavigate({ url: 'https://app.example.test/' })),
  },
  {
    name: 'page_reload/requires-page',
    tool: 'page_reload',
    note: 'reload needs a page and reports its absence by name',
    run: () => call(() => handlers.handlePageReload({})),
  },
  {
    name: 'page_forward/requires-page',
    tool: 'page_forward',
    note: 'history navigation needs a page',
    run: () => call(() => handlers.handlePageForward({})),
  },
  {
    name: 'page_list_frames/requires-page',
    tool: 'page_list_frames',
    note: 'frame enumeration needs a page and must not return an empty frame list as success',
    forbidden: ['frames'],
    run: () => call(() => handlers.handlePageListFrames({})),
  },
  {
    name: 'page_type/requires-page',
    tool: 'page_type',
    note: 'typing needs a page; the failure is named rather than silently dropping the input',
    run: () => call(() => handlers.handlePageType({ text: 'hello' })),
  },
  {
    name: 'page_hover/requires-page',
    tool: 'page_hover',
    note: 'hovering needs a page',
    run: () => call(() => handlers.handlePageHover({ selector: '#btn' })),
  },
  {
    name: 'page_scroll/requires-page',
    tool: 'page_scroll',
    note: 'scrolling needs a page',
    run: () => call(() => handlers.handlePageScroll({})),
  },
  {
    name: 'page_select/requires-page',
    tool: 'page_select',
    note: 'selecting an option needs a page',
    run: () => call(() => handlers.handlePageSelect({ selector: 'select', value: '1' })),
  },
  {
    name: 'page_screenshot/requires-page',
    tool: 'page_screenshot',
    note: 'screenshots need a page; no image payload may be fabricated',
    forbidden: ['base64', 'data', 'path'],
    run: () => call(() => handlers.handlePageScreenshot({})),
  },
  {
    name: 'page_wait_for_selector/requires-page',
    tool: 'page_wait_for_selector',
    note: 'waiting needs a page',
    run: () => call(() => handlers.handlePageWaitForSelector({ selector: '#ready' })),
  },
  {
    name: 'page_press_key/requires-page',
    tool: 'page_press_key',
    note: 'key presses need a page',
    run: () => call(() => handlers.handlePagePressKey({ key: 'Enter' })),
  },
  {
    name: 'page_handle_dialog/requires-page',
    tool: 'page_handle_dialog',
    note: 'dialog handling needs a page; the failure surfaces instead of reporting a handler was installed',
    forbidden: ['installed'],
    run: () => call(() => handlers.handlePageHandleDialog({})),
  },
  {
    name: 'page_inject_script/requires-page',
    tool: 'page_inject_script',
    note: 'injection needs a page',
    run: () => call(() => handlers.handlePageInjectScript({ script: 'window.__bench = 1;' })),
  },
  {
    name: 'page_emulate_device/requires-page',
    tool: 'page_emulate_device',
    note: 'device emulation needs a page and reports the missing browser',
    run: () => call(() => handlers.handlePageEmulateDevice({ device: 'iPhone 13' })),
  },
  {
    name: 'page_coverage_start/requires-page',
    tool: 'page_coverage_start',
    note: 'coverage collection needs a page and must not report a started session',
    forbidden: ['started'],
    run: () => call(() => handlers.handlePageCoverageStart({})),
  },
  {
    name: 'page_coverage_stop/not-running-honest',
    tool: 'page_coverage_stop',
    note: 'stopping coverage that never started is refused by naming the start step',
    run: () => call(() => handlers.handlePageCoverageStop({})),
    validate: (v) => namesStartStep(v, /page_coverage_start/),
  },
  {
    name: 'captcha_detect/requires-page',
    tool: 'captcha_detect',
    note: 'captcha detection needs a page and must not report "no captcha found"',
    forbidden: ['detected', 'found'],
    run: () => call(() => handlers.handleCaptchaDetect({})),
  },
  {
    name: 'captcha_wait/requires-page',
    tool: 'captcha_wait',
    note: 'waiting for a captcha needs a page',
    run: () => call(() => handlers.handleCaptchaWait({})),
  },
  {
    name: 'captcha_vision_solve/requires-page',
    tool: 'captcha_vision_solve',
    note: 'vision solving needs a page and must not return a solution string',
    forbidden: ['solution', 'token'],
    run: () => call(() => handlers.handleCaptchaVisionSolve({})),
  },
  {
    name: 'widget_challenge_solve/requires-page',
    tool: 'widget_challenge_solve',
    note: 'widget solving needs a page; no fabricated token',
    forbidden: ['solution', 'token'],
    run: () => call(() => handlers.handleWidgetChallengeSolve({})),
  },
  {
    name: 'human_mouse/requires-page',
    tool: 'human_mouse',
    note: 'synthetic humanised input needs a page',
    run: () => call(() => handlers.handleHumanMouse({ toX: 10, toY: 10 })),
  },
  {
    name: 'human_scroll/requires-page',
    tool: 'human_scroll',
    note: 'humanised scrolling needs a page',
    run: () => call(() => handlers.handleHumanScroll({})),
  },
  {
    name: 'human_typing/requires-page',
    tool: 'human_typing',
    note: 'humanised typing needs a page',
    run: () => call(() => handlers.handleHumanTyping({ text: 'hello' })),
  },
  {
    name: 'stealth_inject/requires-page',
    tool: 'stealth_inject',
    note: 'stealth injection needs a page and must not report an applied profile',
    forbidden: ['applied'],
    run: () => call(() => handlers.handleStealthInject({})),
  },
  {
    name: 'stealth_set_user_agent/requires-page',
    tool: 'stealth_set_user_agent',
    note: 'UA override needs a page',
    run: () => call(() => handlers.handleStealthSetUserAgent({ userAgent: 'bench/1.0' })),
  },
  {
    name: 'stealth_verify/requires-page',
    tool: 'stealth_verify',
    note: 'verification needs a page; a failed read must not become a passing verdict',
    forbidden: ['passed'],
    run: () => call(() => handlers.handleStealthVerify({})),
  },
  {
    name: 'browser_font_fingerprint/requires-page',
    tool: 'browser_font_fingerprint',
    note: 'font fingerprinting needs page evaluation; no fabricated font list',
    forbidden: ['fonts'],
    run: () => call(() => handlers.handleBrowserFontFingerprint({})),
  },
  {
    name: 'framework_state_extract/requires-page',
    tool: 'framework_state_extract',
    note: 'framework state extraction needs CDP; the failure is named',
    forbidden: ['state'],
    run: () => call(() => handlers.handleFrameworkStateExtract({})),
  },
  {
    name: 'indexeddb_dump/requires-page',
    tool: 'indexeddb_dump',
    note: 'IndexedDB dumping needs page evaluation; no fabricated records',
    forbidden: ['records', 'databases'],
    run: () => call(() => handlers.handleIndexedDBDump({})),
  },
  {
    name: 'js_heap_search/requires-page',
    tool: 'js_heap_search',
    note: 'JS heap search needs a page; no fabricated matches',
    forbidden: ['matches', 'results'],
    run: () => call(() => handlers.handleJSHeapSearch({ query: 'token' })),
  },
  {
    name: 'v8_type_profile/requires-cdp',
    tool: 'v8_type_profile',
    note: 'type profiling needs a CDP session; the failure names that capability',
    run: () => call(() => handlers.handleV8TypeProfile({})),
  },
  {
    name: 'browser_cdp_performance_metrics/requires-cdp',
    tool: 'browser_cdp_performance_metrics',
    note: 'CDP performance metrics need a session; no zeroed metric object',
    forbidden: ['metrics'],
    run: () => call(() => handlers.handleBrowserCdpPerformanceMetrics({})),
  },
  {
    name: 'browser_resource_timing/requires-page',
    tool: 'browser_resource_timing',
    note: 'resource timing needs page evaluation; no fabricated entries',
    forbidden: ['entries', 'resources'],
    run: () => call(() => handlers.handleBrowserResourceTiming({})),
  },
  {
    name: 'browser_get_metrics/requires-cdp',
    tool: 'browser_get_metrics',
    note: 'performance metrics need a CDP session; no fabricated metrics object',
    forbidden: ['metrics'],
    run: () => call(() => handlers.handleBrowserGetMetrics({})),
  },
  {
    name: 'browser_trace_start/requires-cdp',
    tool: 'browser_trace_start',
    note: 'starting a trace needs a tracing session; must not claim tracing started',
    forbidden: ['started'],
    run: () => call(() => handlers.handleBrowserTraceStart({})),
  },
  {
    name: 'browser_trace_stop/not-in-progress-honest',
    tool: 'browser_trace_stop',
    note: 'stopping a trace that never started is refused by naming the start step',
    run: () => call(() => handlers.handleBrowserTraceStop({})),
    validate: (v) => namesStartStep(v, /browser_trace_start/),
  },
  {
    name: 'browser_cpu_profile_start/requires-cdp',
    tool: 'browser_cpu_profile_start',
    note: 'starting CPU profiling needs a CDP session; must not claim profiling started',
    forbidden: ['started'],
    run: () => call(() => handlers.handleBrowserCpuProfileStart({})),
  },
  {
    name: 'browser_cpu_profile_stop/not-in-progress-honest',
    tool: 'browser_cpu_profile_stop',
    note: 'stopping a profile that never started is refused by naming the start step',
    run: () => call(() => handlers.handleBrowserCpuProfileStop({})),
    validate: (v) => namesStartStep(v, /browser_cpu_profile_start/),
  },
  {
    name: 'camoufox_server/status-reports-not-running',
    tool: 'camoufox_server',
    note: 'the Camoufox driver status reports running:false with no endpoint when no server exists — never a fabricated running:true',
    run: () => call(() => handlers.handleCamoufoxServerDispatch({ action: 'status' })),
    validate: (v) => expectsNotRunning(v),
  },
];

/** Tools whose contract is argument validation before any page access. */
const ARGUMENT_CASES: readonly CaseSpec[] = [
  {
    name: 'browser_attach/requires-connection-target',
    tool: 'browser_attach',
    note: 'attach needs browserURL/wsEndpoint/autoConnect/userDataDir/channel and names them',
    run: () => call(() => handlers.handleBrowserAttach({})),
    validate: (v) => namesArgument(v, /browserURL|wsEndpoint|autoConnect|userDataDir|channel/),
  },
  {
    name: 'browser_attach_cdp_target/requires-targetId',
    tool: 'browser_attach_cdp_target',
    note: 'attaching to a CDP target needs its targetId',
    run: () => call(() => handlers.handleBrowserAttachCdpTarget({})),
    validate: (v) => namesArgument(v, /targetId/),
  },
  {
    name: 'browser_evaluate_cdp_target/requires-code',
    tool: 'browser_evaluate_cdp_target',
    note: 'target evaluation needs code/script/expression',
    run: () => call(() => handlers.handleBrowserEvaluateCdpTarget({})),
    validate: (v) => namesArgument(v, /code|script|expression/),
  },
  {
    name: 'page_click/requires-selector',
    tool: 'page_click',
    note: 'clicking needs a selector',
    run: () => call(() => handlers.handlePageClick({})),
    validate: (v) => namesArgument(v, /selector/),
  },
  {
    name: 'page_upload_files/requires-selector',
    tool: 'page_upload_files',
    note: 'uploads need the input selector',
    run: () => call(() => handlers.handlePageUploadFiles({})),
    validate: (v) => namesArgument(v, /selector/),
  },
  {
    name: 'page_evaluate/requires-code',
    tool: 'page_evaluate',
    note: 'evaluation needs code/script/expression',
    run: () => call(() => handlers.handlePageEvaluate({})),
    validate: (v) => namesArgument(v, /code|script|expression/),
  },
  {
    name: 'page_set_viewport/requires-positive-size',
    tool: 'page_set_viewport',
    note: 'the viewport needs positive integer width/height',
    run: () => call(() => handlers.handlePageSetViewport({})),
    validate: (v) => namesArgument(v, /width must be a positive integer/),
  },
  {
    name: 'page_block_script/requires-urlPattern',
    tool: 'page_block_script',
    note: 'blocking a script needs the URL pattern to match',
    run: () => call(() => handlers.handlePageBlockScript({})),
    validate: (v) => namesArgument(v, /urlPattern/),
  },
  {
    name: 'page_cookies/rejects-unknown-action',
    tool: 'page_cookies',
    note: 'the cookie dispatcher lists get/set/clear on an unknown action',
    run: () => call(() => handlers.handlePageCookiesDispatch({})),
    validate: (v) => namesArgument(v, /get, set, clear/),
  },
  {
    name: 'console_execute/requires-expression',
    tool: 'console_execute',
    note: 'console execution needs the expression to evaluate',
    run: () => call(() => handlers.handleConsoleExecute({})),
    validate: (v) => namesArgument(v, /expression/),
  },
  {
    name: 'service_worker_deliver_push/requires-identity',
    tool: 'service_worker_deliver_push',
    note: 'delivering a push needs the SW origin and registration id',
    run: () => call(() => handlers.handleServiceWorkerDeliverPush({})),
    validate: (v) => namesArgument(v, /origin and registrationId/),
  },
  {
    name: 'service_worker_dispatch_sync/requires-identity',
    tool: 'service_worker_dispatch_sync',
    note: 'dispatching a sync event needs the SW origin and registration id',
    run: () => call(() => handlers.handleServiceWorkerDispatchSync({})),
    validate: (v) => namesArgument(v, /origin and registrationId/),
  },
  {
    name: 'camoufox_geolocation/requires-locale',
    tool: 'camoufox_geolocation',
    note: 'geolocation emulation needs the locale to derive coordinates from',
    run: () => call(() => handlers.handleCamoufoxGeolocation({})),
    validate: (v) => namesArgument(v, /locale/),
  },
  {
    name: 'tab_workflow/lists-actions',
    tool: 'tab_workflow',
    note: 'the tab workflow dispatcher lists its actions on an unknown one',
    run: () => call(() => handlers.handleTabWorkflow({})),
    validate: (v) => namesArgument(v, /list, alias_bind|Valid:/),
  },
  {
    name: 'browser_performance_observer/requires-entryTypes',
    tool: 'browser_performance_observer',
    note: 'the observer needs at least one entry type to observe',
    run: () => call(() => handlers.handleBrowserPerformanceObserver({})),
    validate: (v) => namesArgument(v, /entryTypes/),
  },
];

export const browserContractCases = [
  ...PREREQUISITE_CASES.map((spec) => ({
    name: spec.name,
    tool: spec.tool,
    origin: 'homemade' as const,
    reference: `no-browser contract: ${spec.note}`,
    run: spec.run,
    validate: (v: unknown) =>
      spec.validate ? spec.validate(v) : prerequisiteFailure(v, spec.forbidden ?? []),
  })),
  ...ARGUMENT_CASES.map((spec) => ({
    name: spec.name,
    tool: spec.tool,
    origin: 'homemade' as const,
    reference: `argument contract: ${spec.note}`,
    run: spec.run,
    validate: (v: unknown) => (spec.validate ? spec.validate(v) : true),
  })),
];
