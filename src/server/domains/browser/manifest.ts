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
import type { BrowserFleetRouter } from '@server/runtime/BrowserFleetRouter';

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
    { tool: 'get_offloaded_data', method: 'handleGetOffloadedData' },
    { tool: 'browser_attach', method: 'handleBrowserAttach' },
    { tool: 'browser_list_tabs', method: 'handleBrowserListTabs' },
    { tool: 'browser_list_cdp_targets', method: 'handleBrowserListCdpTargets' },
    { tool: 'browser_select_tab', method: 'handleBrowserSelectTab' },
    { tool: 'browser_attach_cdp_target', method: 'handleBrowserAttachCdpTarget' },
    { tool: 'browser_detach_cdp_target', method: 'handleBrowserDetachCdpTarget' },
    { tool: 'browser_evaluate_cdp_target', method: 'handleBrowserEvaluateCdpTarget' },
    { tool: 'browser_list_workers', method: 'handleBrowserListWorkers' },
    { tool: 'browser_worker_scripts', method: 'handleBrowserWorkerScripts' },
    { tool: 'browser_font_fingerprint', method: 'handleBrowserFontFingerprint' },
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
    { tool: 'page_coverage_start', method: 'handlePageCoverageStart' },
    { tool: 'page_coverage_stop', method: 'handlePageCoverageStop' },
    { tool: 'page_block_script', method: 'handlePageBlockScript' },
    { tool: 'page_cookies', method: 'handlePageCookiesDispatch' },
    { tool: 'page_set_viewport', method: 'handlePageSetViewport' },
    { tool: 'page_emulate_device', method: 'handlePageEmulateDevice' },
    { tool: 'page_local_storage', method: 'handlePageLocalStorageDispatch' },
    { tool: 'page_session_storage', method: 'handlePageSessionStorageDispatch' },
    { tool: 'page_storage_info', method: 'handlePageStorageInfo' },
    { tool: 'browser_passkey_seed', method: 'handleBrowserPasskeySeed' },
    { tool: 'page_press_key', method: 'handlePagePressKey' },
    { tool: 'page_handle_dialog', method: 'handlePageHandleDialog' },
    { tool: 'service_worker_deliver_push', method: 'handleServiceWorkerDeliverPush' },
    { tool: 'service_worker_dispatch_sync', method: 'handleServiceWorkerDispatchSync' },
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
    { tool: 'browser_performance_observer', method: 'handleBrowserPerformanceObserver' },
    { tool: 'browser_resource_timing', method: 'handleBrowserResourceTiming' },
    { tool: 'browser_cdp_performance_metrics', method: 'handleBrowserCdpPerformanceMetrics' },
    { tool: 'v8_type_profile', method: 'handleV8TypeProfile' },
    { tool: 'browser_get_metrics', method: 'handleBrowserGetMetrics' },
    { tool: 'browser_trace_start', method: 'handleBrowserTraceStart' },
    { tool: 'browser_trace_stop', method: 'handleBrowserTraceStop' },
    { tool: 'browser_cpu_profile_start', method: 'handleBrowserCpuProfileStart' },
    { tool: 'browser_cpu_profile_stop', method: 'handleBrowserCpuProfileStop' },
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
    const schedulerConfig = ctx.config?.mcp;
    const coordinator =
      getDomainInstance?.<BrowserSessionCoordinator>('browserSessionCoordinator') ??
      (compatCtx.browserSessionCoordinator as BrowserSessionCoordinator | undefined) ??
      new BrowserSessionCoordinator(() => ctx.collector, {
        policy: schedulerConfig?.browserSessionSchedulerPolicy,
        maxPending: schedulerConfig?.browserSessionQueueMaxPending,
        maxPendingPerSession: schedulerConfig?.browserSessionQueueMaxPendingPerSession,
        waitTimeoutMs: schedulerConfig?.browserSessionQueueWaitTimeoutMs,
      });
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
      getDomainInstance?.<BrowserFleetRouter>('browserFleetRouter'),
      ctx.elicitationBridge,
    );
  }
  return ctx.browserHandlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  browser_launch: ['open a new browser here', 'spin up chrome for me', '启动浏览器'],
  browser_attach: ['take over my chrome', 'connect to the running browser', '接管浏览器'],
  browser_close: ['shut the browser down', 'kill the chrome session', '关闭浏览器'],
  browser_status: ['browser alive check', 'is a page open', '浏览器状态'],
  browser_list_tabs: ['which tabs are open', 'enumerate open tabs', '列出标签页'],
  browser_select_tab: ['switch to that tab', 'focus another tab', '切换标签页'],
  browser_list_workers: ['page web workers list', 'enumerate worker threads', '列出 worker'],
  browser_worker_scripts: ['scripts running in workers', 'worker code list', 'worker 脚本'],
  browser_attach_cdp_target: [
    'take over a cdp target',
    'attach to iframe context',
    '接管 cdp 目标',
  ],
  browser_detach_cdp_target: [
    'release the cdp target',
    'stop driving that context',
    '分离 cdp 目标',
  ],
  browser_evaluate_cdp_target: [
    'run js inside that target',
    'evaluate in iframe context',
    '目标内求值',
  ],
  browser_list_cdp_targets: ['what contexts exist', 'enumerate cdp targets', '列出 cdp 目标'],
  browser_codegen_start: ['record my actions as code', 'start codegen capture', '开始录制代码'],
  browser_codegen_stop: ['finish action recording', 'stop codegen and emit script', '结束录制代码'],
  browser_get_metrics: ['page counters snapshot', 'runtime metrics readout', '页面指标'],
  browser_cdp_performance_metrics: [
    'cdp performance counters',
    'raw performance numbers',
    'cdp 性能指标',
  ],
  browser_performance_observer: [
    'observe page performance entries',
    'long tasks and paints',
    '性能观察',
  ],
  browser_resource_timing: ['how long each resource took', 'resource load timings', '资源耗时'],
  browser_trace_start: ['begin a chrome trace', 'record tracing categories', '开始 trace'],
  browser_trace_stop: ['finish the chrome trace', 'collect trace result', '停止 trace'],
  browser_cpu_profile_start: ['start sampling the cpu', 'begin js cpu profiling', '开始 cpu 采样'],
  browser_cpu_profile_stop: ['finish cpu sampling', 'collect cpu profile result', '停止 cpu 采样'],
  browser_font_fingerprint: [
    'enumerate font fingerprints',
    'which fonts are detectable',
    '字体指纹',
  ],
  browser_jsdom_parse: ['parse html without a browser', 'offline dom from markup', '离线解析 html'],
  browser_jsdom_query: ['query the offline dom', 'css selectors without browser', '离线 dom 查询'],
  browser_jsdom_execute: ['run scripts on the offline dom', 'execute jsdom code', '离线执行脚本'],
  browser_jsdom_serialize: [
    'serialize the offline dom back',
    'output html from jsdom',
    '离线 dom 序列化',
  ],
  browser_jsdom_cookies: ['offline cookie parsing', 'read cookies from html', '离线 cookie'],
  browser_passkey_seed: ['seed webauthn passkeys', 'fake passkey credentials', 'passkey 种子'],
  camoufox_server: ['start the stealth firefox', 'launch camoufox browser', '启动 camoufox'],
  camoufox_geolocation: ['fake gps in camoufox', 'set spoofed location', '伪造定位'],
  captcha_config: ['configure captcha handling', 'set captcha switches', '验证码配置'],
  captcha_detect: ['is there a captcha here', 'check for challenge widgets', '检测验证码'],
  captcha_wait: ['wait until the captcha resolves', 'poll challenge status', '等待验证码'],
  captcha_vision_solve: ['solve the captcha by vision', 'ocr the challenge image', '视觉过验证码'],
  captcha_solver_capabilities: [
    'which solvers are available',
    'captcha solving support',
    '求解能力',
  ],
  widget_challenge_solve: ['solve the checkbox widget', 'handle cf challenge', '过挑战组件'],
  console_execute: ['run code in the console context', 'evaluate on the console', '控制台执行'],
  console_get_logs: ['show console output', 'collected console messages', '控制台日志'],
  console_monitor: ['watch console output live', 'follow console messages', '监控控制台'],
  framework_state_extract: [
    'pull react or vue state',
    'extract framework internals',
    '提取框架状态',
  ],
  get_all_scripts: ['list scripts on the page', 'enumerate loaded js files', '列出脚本'],
  get_script_source: ['fetch a script its code', 'download script text', '取脚本源码'],
  get_detailed_data: [
    'fetch the stored detail chunks',
    'read offloaded response data',
    '取分片数据',
  ],
  get_offloaded_data: ['read the offloaded raw bytes', 'large response store read', '取落盘数据'],
  human_mouse: ['move the mouse like a person', 'humanlike mouse path', '拟人鼠标'],
  human_scroll: ['scroll like a human would', 'natural scroll behavior', '拟人滚动'],
  human_typing: ['type with human rhythm', 'keystroke cadence typing', '拟人输入'],
  indexeddb_dump: ['dump the indexeddb store', 'export offline database', '导出 indexeddb'],
  js_heap_search: ['search strings in the heap', 'find values inside js memory', '堆内搜索'],
  page_back: ['go back one page', 'navigate to previous entry', '后退'],
  page_forward: ['go forward again', 'next history entry', '前进'],
  page_navigate: ['open this url', 'go to a web address', '打开网址'],
  page_reload: ['refresh the page', 'reload current document', '刷新页面'],
  page_click: ['click this element', 'press a dom node', '点击元素'],
  page_type: ['type text into a field', 'enter keyboard input', '输入文本'],
  page_select: ['choose an option in the dropdown', 'pick a select value', '选择下拉项'],
  page_hover: ['hover over this element', 'mouse over the node', '悬停元素'],
  page_scroll: ['scroll the page down', 'scroll to this position', '滚动页面'],
  page_upload_files: ['attach files to the input', 'upload through the file picker', '上传文件'],
  page_wait_for_selector: [
    'wait until this element appears',
    'block on selector match',
    '等待元素',
  ],
  page_evaluate: [
    'run javascript in the page',
    'evaluate an expression in page context',
    '页面执行 js',
  ],
  page_screenshot: ['take a picture of the page', 'capture visual snapshot', '页面截图'],
  page_cookies: ['read and set cookies', 'manage browser cookies', '管理 cookie'],
  page_local_storage: [
    'inspect localstorage entries',
    'read local key value store',
    '查看 localStorage',
  ],
  page_session_storage: [
    'inspect sessionstorage entries',
    'per-tab storage values',
    '查看 sessionStorage',
  ],
  page_storage_info: ['storage usage overview', 'quota and usage numbers', '存储概况'],
  page_set_viewport: ['resize the page viewport', 'change window size', '设置视口'],
  page_emulate_device: ['pretend to be a phone', 'device emulation profile', '设备模拟'],
  page_press_key: ['press a keyboard key', 'send a key press', '按键'],
  page_handle_dialog: ['accept or dismiss the popup', 'answer the js dialog', '处理弹窗'],
  page_list_frames: ['list frames on the page', 'enumerate iframes', '列出 iframe'],
  page_inject_script: ['inject custom js into the page', 'add my own script', '注入脚本'],
  page_block_script: ['stop these scripts from loading', 'block urls from loading', '拦截脚本'],
  page_coverage_start: ['start js coverage collection', 'record executed code', '开始覆盖率'],
  page_coverage_stop: ['collect js coverage result', 'stop coverage recording', '停止覆盖率'],
  service_worker_deliver_push: [
    'deliver a push event to the worker',
    'fire push payload',
    '推送事件',
  ],
  service_worker_dispatch_sync: ['dispatch a sync event', 'trigger background sync', '同步事件'],
  stealth_inject: ['apply stealth hardening', 'mask automation signals', '注入隐身'],
  stealth_set_user_agent: ['change the user agent', 'override the ua string', '改 ua'],
  stealth_configure_jitter: [
    'randomize stealth timings',
    'configure fingerprint jitter',
    '抖动配置',
  ],
  stealth_generate_fingerprint: [
    'build a fake fingerprint',
    'generate consistent identity',
    '生成指纹',
  ],
  stealth_verify: ['check for automation leaks', 'verify stealth is applied', '验证隐身'],
  tab_workflow: ['coordinate work across tabs', 'multi tab orchestration', '多标签编排'],
  v8_type_profile: ['collect v8 type feedback', 'which types each function sees', '类型画像'],
};

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

  // Document-expansion keywords for the retrieval layer (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
