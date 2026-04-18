import type { MCPServerContext } from '@server/MCPServer.context';
import type { DomainManifest, ToolRegistration } from '@server/registry/contracts';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { adbBridgeTools } from './definitions';
import { ADBBridgeHandlers } from './handlers';

const DOMAIN = 'adb-bridge';
const DEP_KEY = 'adbBridgeHandlers';

const toolByName = toolLookup(adbBridgeTools);
const bind = (
  invoke: (handlers: ADBBridgeHandlers, args: Record<string, unknown>) => Promise<unknown>,
) => bindByDepKey<ADBBridgeHandlers>(DEP_KEY, invoke);

const registrations: ToolRegistration[] = [
  {
    tool: toolByName('adb_device_list'),
    domain: DOMAIN,
    bind: bind((handlers, args) => handlers.handleDeviceList(args)),
  },
  {
    tool: toolByName('adb_shell'),
    domain: DOMAIN,
    bind: bind((handlers, args) => handlers.handleShell(args)),
  },
  {
    tool: toolByName('adb_apk_pull'),
    domain: DOMAIN,
    bind: bind((handlers, args) => handlers.handlePullApk(args)),
  },
  {
    tool: toolByName('adb_apk_analyze'),
    domain: DOMAIN,
    bind: bind((handlers, args) => handlers.handleAnalyzeApk(args)),
  },
  {
    tool: toolByName('adb_webview_list'),
    domain: DOMAIN,
    bind: bind((handlers, args) => handlers.handleWebViewList(args)),
  },
  {
    tool: toolByName('adb_webview_attach'),
    domain: DOMAIN,
    bind: bind((handlers, args) => handlers.handleWebViewAttach(args)),
  },
];

function ensure(ctx: MCPServerContext): ADBBridgeHandlers {
  const existingHandlers = ctx.getDomainInstance<ADBBridgeHandlers>(DEP_KEY);
  if (existingHandlers) {
    return existingHandlers;
  }

  const handlers = new ADBBridgeHandlers();
  handlers.setEventBus(ctx.eventBus);
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
    ],
    priority: 75,
    tools: [
      'adb_device_list',
      'adb_shell',
      'adb_apk_pull',
      'adb_apk_analyze',
      'adb_webview_list',
      'adb_webview_attach',
    ],
    hint: 'Android/ADB: list devices → run shell commands → pull/analyze APK → debug WebViews via CDP',
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
