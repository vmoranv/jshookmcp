import type { DomainManifest, MCPServerContext } from '@server/domains/shared/registry';
import { bindByDepKey, toolLookup } from '@server/domains/shared/registry';
import { adbBridgeTools } from '@server/domains/adb-bridge/definitions';
import { ADBBridgeHandlers } from '@server/domains/adb-bridge/handlers';

const DOMAIN = 'adb-bridge' as const;
const DEP_KEY = 'adbBridgeHandlers' as const;
type H = ADBBridgeHandlers;
const t = toolLookup(adbBridgeTools);
const b = (invoke: (h: H, a: Record<string, unknown>) => Promise<unknown>) =>
  bindByDepKey<H>(DEP_KEY, invoke);

function ensure(ctx: MCPServerContext): H {
  if (!(ctx as unknown as Record<string, unknown>)[DEP_KEY]) {
    (ctx as unknown as Record<string, unknown>)[DEP_KEY] = new ADBBridgeHandlers();
  }
  return (ctx as unknown as Record<string, unknown>)[DEP_KEY] as H;
}

const manifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['workflow', 'full'],
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
    adb_device_list: [
      {
        condition: 'ADB server binary must be in PATH',
        fix: 'Install Android Platform Tools: https://developer.android.com/studio/command-line/adb',
      },
    ],
    adb_shell: [
      {
        condition: 'ADB server binary must be in PATH',
        fix: 'Install Android Platform Tools: https://developer.android.com/studio/command-line/adb',
      },
    ],
    adb_apk_pull: [
      {
        condition: 'ADB server binary must be in PATH',
        fix: 'Install Android Platform Tools: https://developer.android.com/studio/command-line/adb',
      },
    ],
    adb_apk_analyze: [
      {
        condition: 'ADB server binary must be in PATH',
        fix: 'Install Android Platform Tools: https://developer.android.com/studio/command-line/adb',
      },
    ],
    adb_webview_list: [
      {
        condition: 'ADB server binary must be in PATH',
        fix: 'Install Android Platform Tools: https://developer.android.com/studio/command-line/adb',
      },
      {
        condition: 'App must have android:debuggable="true"',
        fix: 'Use a debug build of the Android app',
      },
    ],
    adb_webview_attach: [
      {
        condition: 'ADB server binary must be in PATH',
        fix: 'Install Android Platform Tools: https://developer.android.com/studio/command-line/adb',
      },
      {
        condition: 'App must have android:debuggable="true"',
        fix: 'Use a debug build of the Android app',
      },
    ],
  },

  registrations: [
    {
      tool: t('adb_device_list'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleDeviceList(a)),
    },
    {
      tool: t('adb_shell'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleShell(a)),
    },
    {
      tool: t('adb_apk_pull'),
      domain: DOMAIN,
      bind: b((h, a) => h.handlePullApk(a)),
    },
    {
      tool: t('adb_apk_analyze'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleAnalyzeApk(a)),
    },
    {
      tool: t('adb_webview_list'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleWebViewList(a)),
    },
    {
      tool: t('adb_webview_attach'),
      domain: DOMAIN,
      bind: b((h, a) => h.handleWebViewAttach(a)),
    },
  ],
} satisfies DomainManifest<typeof DEP_KEY, H, typeof DOMAIN>;

export default manifest;
