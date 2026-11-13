import type { MCPServerContext } from '@server/MCPServer.context';
import type { DomainManifest, ToolRegistration } from '@server/registry/contracts';
import { defineMethodRegistrations, toolLookup } from '@server/domains/shared/registry';
import { adbBridgeTools } from './definitions';
import type { ADBBridgeHandlers } from './handlers';

const DOMAIN = 'adb-bridge';
const DEP_KEY = 'adbBridgeHandlers';

const toolByName = toolLookup(adbBridgeTools);
const registrations: ToolRegistration[] = defineMethodRegistrations<
  ADBBridgeHandlers,
  (typeof adbBridgeTools)[number]['name']
>({
  domain: DOMAIN,
  depKey: DEP_KEY,
  lookup: toolByName,
  entries: [
    { tool: 'adb_device_list', method: 'handleDeviceListTool' },
    { tool: 'adb_apk_pull', method: 'handleApkPullTool' },
    { tool: 'adb_shell', method: 'handleShellTool' },
    { tool: 'adb_install', method: 'handleInstallTool' },
    { tool: 'adb_uninstall', method: 'handleUninstallTool' },
    { tool: 'adb_input_tap', method: 'handleInputTapTool' },
    { tool: 'adb_input_swipe', method: 'handleInputSwipeTool' },
    { tool: 'adb_input_keyevent', method: 'handleInputKeyeventTool' },
    { tool: 'adb_input_text', method: 'handleInputTextTool' },
    { tool: 'adb_proc_maps', method: 'handleProcMapsTool' },
    { tool: 'adb_root_check', method: 'handleRootCheckTool' },
    { tool: 'adb_getprop', method: 'handleGetpropTool' },
    { tool: 'adb_screenshot', method: 'handleScreenshotTool' },
    { tool: 'adb_screenrecord', method: 'handleScreenrecordTool' },
    { tool: 'adb_port_forward', method: 'handlePortForwardTool' },
    { tool: 'adb_apk_analyze', method: 'handleAnalyzeApkTool' },
    { tool: 'adb_package_summary', method: 'handlePackageSummaryTool' },
    { tool: 'adb_logcat_query', method: 'handleLogcatQueryTool' },
    { tool: 'adb_app_cold_start_trace', method: 'handleAppColdStartTraceTool' },
    { tool: 'adb_file_pull', method: 'handleFilePullTool' },
    { tool: 'adb_file_push', method: 'handleFilePushTool' },
    { tool: 'adb_pull_native_libs', method: 'handlePullNativeLibsTool' },
    { tool: 'adb_webview_list', method: 'handleWebViewListTool' },
    { tool: 'adb_webview_attach', method: 'handleWebViewAttachTool' },
    { tool: 'adb_dumpsys', method: 'handleDumpsysTool' },
    { tool: 'adb_ui_dump', method: 'handleUiDumpTool' },
  ],
});

async function ensure(ctx: MCPServerContext): Promise<ADBBridgeHandlers> {
  const { ADBBridgeHandlers } = await import('./handlers');
  const existingHandlers = ctx.getDomainInstance<ADBBridgeHandlers>(DEP_KEY);
  if (existingHandlers) {
    return existingHandlers;
  }

  const handlers = new ADBBridgeHandlers();
  handlers.setEventBus(ctx.eventBus);
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

// ── Document-expansion keywords (search retrieval layer) ──
// Query phrases bridging user vocabulary to this tool's vocabulary without
// duplicating name/description tokens. Folded into generated-tool-catalog by
// scripts/generate-domains-index.mjs; weighted SEARCH_SCENE_KEYWORD_WEIGHT.
const SCENE_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  adb_apk_analyze: [
    'analyze the apk on the phone',
    'inspect the installed package',
    '分析手机 apk',
  ],
  adb_apk_pull: ['download the apk from device', 'pull installer off the phone', '拉取 apk'],
  adb_app_cold_start_trace: ['measure app cold start', 'launch timing trace', '冷启动追踪'],
  adb_device_list: ['what phones are connected', 'list adb devices', '列出设备'],
  adb_dumpsys: ['dump android system services', 'read dumpsys output', '系统服务转储'],
  adb_file_pull: ['copy a file off the phone', 'download from device', '拉取文件'],
  adb_file_push: ['copy a file onto the phone', 'upload to device', '推送文件'],
  adb_getprop: ['read android system properties', 'device build fingerprint', '系统属性'],
  adb_input_keyevent: ['send a key press to the phone', 'inject keyevent', '注入按键'],
  adb_input_swipe: 'swipe gesture on the phone screen'.split(' '),
  adb_input_tap: ['tap the phone screen at a point', 'inject a touch', '注入点击'],
  adb_input_text: ['type text on the phone', 'inject text input', '注入文本'],
  adb_install: ['install an apk on the device', 'sideload the package', '安装 apk'],
  adb_logcat_query: ['read the android logcat', 'filter device logs', '查 logcat'],
  adb_package_summary: ['package info on device', 'summarize installed app', '包摘要'],
  adb_port_forward: ['forward a device port', 'adb tcp forwarding', '端口转发'],
  adb_proc_maps: ['read process memory maps on device', 'proc maps of android app', '进程 maps'],
  adb_pull_native_libs: ['download the native libraries', 'pull so files from app', '拉取 so 库'],
  adb_root_check: ['is the phone rooted', 'check su availability', '检查 root'],
  adb_screenrecord: ['record the phone screen', 'capture device video', '录屏'],
  adb_screenshot: ['capture the phone screen', 'take device screenshot', '手机截图'],
  adb_shell: ['run a shell command on the phone', 'adb shell exec', '手机执行命令'],
  adb_ui_dump: ['dump the ui hierarchy', 'view the android view tree', 'ui 树'],
  adb_uninstall: ['remove an app from the device', 'uninstall package', '卸载应用'],
  adb_webview_attach: ['debug the app webview', 'attach to webview cdp', '接管 webview'],
  adb_webview_list: ['list webviews in the app', 'which webviews are debuggable', '列出 webview'],
};

const manifest: DomainManifest<'adbBridgeHandlers', ADBBridgeHandlers, 'adb-bridge'> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  registrations,

  // Document-expansion keywords (SCENE_KEYWORDS above).
  sceneKeywords: SCENE_KEYWORDS,

  ensure,
  workflowRule: {
    patterns: [
      /(android|adb|mobile|apk|device).*(list|shell|pull|analyze)/i,
      /(android|adb).*(logcat|cold\s*start|startup|launch|activity|pid)/i,
      /(adb|android).*(webview|chrome|debug|cdp|inspect)/i,
      /(android|adb).*(native|\.so|libapp|libflutter|shared\s+library)/i,
      /(adb|android).*(install|uninstall|tap|swipe|keyevent|input|screenshot|screenrecord|record|root|proc|maps|forward|reverse|port|getprop|propert|fingerprint)/i,
    ],
    priority: 75,
    tools: [
      'adb_device_list',
      'adb_shell',
      'adb_install',
      'adb_uninstall',
      'adb_input_tap',
      'adb_input_swipe',
      'adb_input_keyevent',
      'adb_input_text',
      'adb_proc_maps',
      'adb_root_check',
      'adb_getprop',
      'adb_screenshot',
      'adb_screenrecord',
      'adb_port_forward',
      'adb_apk_pull',
      'adb_apk_analyze',
      'adb_package_summary',
      'adb_logcat_query',
      'adb_app_cold_start_trace',
      'adb_file_pull',
      'adb_file_push',
      'adb_pull_native_libs',
      'adb_webview_list',
      'adb_webview_attach',
    ],
    hint: 'Android/ADB: list devices → pull/analyze APK → package summary → cold-start/logcat trace → debug WebViews via CDP',
  },
  prerequisites: {
    '*': [
      {
        condition: 'ADB server binary must be in PATH',
        fix: 'Install Android Platform Tools: https://developer.android.com/studio/command-line/adb',
      },
    ],
    adb_webview_list: [
      {
        condition: 'App must have android:debuggable="true"',
        fix: 'Use a debug build of the Android app',
      },
    ],
    adb_webview_attach: [
      {
        condition: 'App must have android:debuggable="true"',
        fix: 'Use a debug build of the Android app',
      },
    ],
  },
  toolDependencies: [
    {
      from: 'browser',
      to: 'adb-bridge',
      relation: 'uses',
      weight: 0.7,
    },
  ],
};

export default manifest;
