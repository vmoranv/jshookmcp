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
    { tool: 'adb_device_list', method: 'handleDeviceList' },
    { tool: 'adb_apk_pull', method: 'handleApkPull' },
    { tool: 'adb_shell', method: 'handleShell' },
    { tool: 'adb_apk_analyze', method: 'handleAnalyzeApk' },
    { tool: 'adb_pull_native_libs', method: 'handlePullNativeLibs' },
    { tool: 'adb_webview_list', method: 'handleWebViewList' },
    { tool: 'adb_webview_attach', method: 'handleWebViewAttach' },
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
      /(android|adb|mobile|apk|device).*(list|shell|pull|analyze|dump)/i,
      /(adb|android).*(webview|chrome|debug|cdp|inspect)/i,
      /(android|adb).*(native|\.so|libapp|libflutter|shared\s+library)/i,
    ],
    priority: 75,
    tools: [
      'adb_device_list',
      'adb_shell',
      'adb_apk_pull',
      'adb_apk_analyze',
      'adb_pull_native_libs',
      'adb_webview_list',
      'adb_webview_attach',
    ],
    hint: 'Android/ADB: list devices → run shell commands → pull/analyze APK or native libs → debug WebViews via CDP',
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
