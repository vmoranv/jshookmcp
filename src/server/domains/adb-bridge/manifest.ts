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
  ],
});

async function ensure(ctx: MCPServerContext): Promise<ADBBridgeHandlers> {
  const { ADBBridgeHandlers } = await import('./handlers');
  const existingHandlers = ctx.getDomainInstance<ADBBridgeHandlers>(DEP_KEY);
  if (existingHandlers) {
    return existingHandlers;
  }

  const handlers = new ADBBridgeHandlers();
  ctx.setDomainInstance(DEP_KEY, handlers);
  return handlers;
}

const manifest: DomainManifest<'adbBridgeHandlers', ADBBridgeHandlers, 'adb-bridge'> = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full'],
  registrations,
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
