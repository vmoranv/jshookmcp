/**
 * adb-bridge contract cases — extracted from adb-bridge.suite.ts to keep that
 * file focused on the golden parser vectors.
 *
 * Every adb-bridge tool shells out to the adb CLI for a real device. The
 * portable contract on any machine: a missing argument is rejected BY NAME
 * before adb is spawned, or — when the target genuinely cannot be reached —
 * the tool reports success=false carrying adb's own diagnostic and no
 * fabricated device data.
 */
import { ADBBridgeHandlers } from '@server/domains/adb-bridge/handlers.impl';
import { body } from '../harness';

/** Serial used by the remote-command contract cases: no such device exists. */
export const BENCH_SERIAL = 'jshook-bench-no-device';

/** Shared handlers instance for the contract cases. */
export const ADB = new ADBBridgeHandlers();

type Args = Record<string, unknown>;

interface AdbArgCase {
  readonly name: string;
  readonly tool: string;
  readonly args: Args;
  readonly expect: RegExp;
  readonly note: string;
}

const ADB_METHOD_BY_TOOL: Record<string, string> = {
  adb_shell: 'handleShellTool',
  adb_install: 'handleInstallTool',
  adb_uninstall: 'handleUninstallTool',
  adb_input_tap: 'handleInputTapTool',
  adb_input_swipe: 'handleInputSwipeTool',
  adb_input_keyevent: 'handleInputKeyeventTool',
  adb_input_text: 'handleInputTextTool',
  adb_file_pull: 'handleFilePullTool',
  adb_file_push: 'handleFilePushTool',
  adb_apk_pull: 'handleApkPullTool',
  adb_apk_analyze: 'handleAnalyzeApkTool',
  adb_package_summary: 'handlePackageSummaryTool',
  adb_app_cold_start_trace: 'handleAppColdStartTraceTool',
  adb_pull_native_libs: 'handlePullNativeLibsTool',
  adb_port_forward: 'handlePortForwardTool',
  adb_webview_attach: 'handleWebViewAttachTool',
  adb_proc_maps: 'handleProcMapsTool',
};

/**
 * Argument contracts: each tool must reject the call BY NAME before adb runs.
 * One table row per tool keeps the "which argument" decision visible.
 */
const ADB_ARG_TABLE: readonly AdbArgCase[] = [
  {
    name: 'adb_shell/requires-serial',
    tool: 'adb_shell',
    args: {},
    expect: /serial/i,
    note: 'shell needs a device serial',
  },
  {
    name: 'adb_shell/requires-command',
    tool: 'adb_shell',
    args: { serial: BENCH_SERIAL },
    expect: /command/i,
    note: 'shell needs the command text',
  },
  {
    name: 'adb_install/requires-apkPath',
    tool: 'adb_install',
    args: { serial: BENCH_SERIAL },
    expect: /apkPath|apkPaths/i,
    note: 'install needs the APK to install',
  },
  {
    name: 'adb_uninstall/requires-packageName',
    tool: 'adb_uninstall',
    args: { serial: BENCH_SERIAL },
    expect: /packageName/i,
    note: 'uninstall needs the package to remove',
  },
  {
    name: 'adb_input_tap/requires-coordinates',
    tool: 'adb_input_tap',
    args: { serial: BENCH_SERIAL },
    expect: /"x"|\bx\b/i,
    note: 'tap needs coordinates',
  },
  {
    name: 'adb_input_swipe/requires-start-coordinates',
    tool: 'adb_input_swipe',
    args: { serial: BENCH_SERIAL },
    expect: /x1/i,
    note: 'swipe needs start and end coordinates',
  },
  {
    name: 'adb_input_keyevent/requires-keyCode',
    tool: 'adb_input_keyevent',
    args: { serial: BENCH_SERIAL },
    expect: /keyCode/i,
    note: 'key event needs the key code',
  },
  {
    name: 'adb_input_text/requires-text',
    tool: 'adb_input_text',
    args: { serial: BENCH_SERIAL },
    expect: /text/i,
    note: 'text input needs the text to type',
  },
  {
    name: 'adb_file_pull/requires-remotePath',
    tool: 'adb_file_pull',
    args: { serial: BENCH_SERIAL },
    expect: /remotePath/i,
    note: 'pull needs the remote path',
  },
  {
    name: 'adb_file_push/requires-localPath',
    tool: 'adb_file_push',
    args: { serial: BENCH_SERIAL },
    expect: /localPath/i,
    note: 'push needs the local path',
  },
  {
    name: 'adb_apk_pull/requires-packageName',
    tool: 'adb_apk_pull',
    args: { serial: BENCH_SERIAL },
    expect: /packageName/i,
    note: 'APK pull needs the package name',
  },
  {
    name: 'adb_apk_analyze/requires-packageName',
    tool: 'adb_apk_analyze',
    args: { serial: BENCH_SERIAL },
    expect: /packageName/i,
    note: 'APK analysis needs the package name',
  },
  {
    name: 'adb_package_summary/requires-packageName',
    tool: 'adb_package_summary',
    args: { serial: BENCH_SERIAL },
    expect: /packageName/i,
    note: 'package summary needs the package name',
  },
  {
    name: 'adb_app_cold_start_trace/requires-packageName',
    tool: 'adb_app_cold_start_trace',
    args: { serial: BENCH_SERIAL },
    expect: /packageName/i,
    note: 'cold-start tracing needs the package name',
  },
  {
    name: 'adb_pull_native_libs/requires-packageName',
    tool: 'adb_pull_native_libs',
    args: { serial: BENCH_SERIAL },
    expect: /packageName/i,
    note: 'native-lib pull needs the package name',
  },
  {
    name: 'adb_port_forward/requires-action',
    tool: 'adb_port_forward',
    args: { serial: BENCH_SERIAL },
    expect: /add|remove|list/i,
    note: 'port forwarding needs one of add/remove/remove_all/list',
  },
  {
    name: 'adb_webview_attach/requires-targetId',
    tool: 'adb_webview_attach',
    args: { serial: BENCH_SERIAL },
    expect: /targetId/i,
    note: 'WebView attach needs a target id from the list call',
  },
  {
    name: 'adb_proc_maps/requires-pid-or-package',
    tool: 'adb_proc_maps',
    args: { serial: BENCH_SERIAL },
    expect: /pid|packageName/i,
    note: 'proc maps needs a pid or a resolvable package name',
  },
];

/** Invoke a handler method and flatten its ToolResponse to text. */
async function callTool(tool: string, args: Args): Promise<string> {
  const method = ADB_METHOD_BY_TOOL[tool];
  const fn = method
    ? (ADB as unknown as Record<string, ((a: Args) => Promise<unknown>) | undefined>)[method]
    : undefined;
  if (!fn) return `__no_handler__:${tool}`;
  try {
    return JSON.stringify(body(await fn.call(ADB, args)));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** A failure counts when it names a reason (adb error text included). */
export function namedFailure(b: Args): true | string {
  const text = String(b['error'] ?? b['message'] ?? b['stderr'] ?? '');
  return text.length > 0
    ? true
    : `failure without a named reason: ${JSON.stringify(b).slice(0, 160)}`;
}

/** Compare a reported count with the actual collection length. */
export function countMatches(b: Args, key: string, label: string): true | string {
  const value = b[key];
  if (!Array.isArray(value)) return `${key} must be an array: ${JSON.stringify(b).slice(0, 160)}`;
  return b['count'] === value.length
    ? true
    : `count ${String(b['count'])} != ${value.length} ${label}`;
}

export const adbArgCases = ADB_ARG_TABLE.map((spec) => ({
  name: spec.name,
  tool: spec.tool,
  origin: 'homemade' as const,
  reference: `argument contract: ${spec.note} — rejected by name before adb is spawned`,
  run: () => callTool(spec.tool, spec.args),
  validate: (v: unknown) => {
    const text = String(v);
    if (text.startsWith('__no_handler__')) return text;
    return spec.expect.test(text)
      ? true
      : `refusal does not match ${spec.expect}: ${text.slice(0, 200)}`;
  },
}));

/** Remote-command contracts: unreachable serial → explicit failure, no invented data. */
export const adbRemoteCases = [
  {
    name: 'adb_device_list/array-and-count-consistent',
    tool: 'adb_device_list',
    origin: 'homemade' as const,
    reference:
      'listing contract: the device list is an array whose length equals count; with no device attached the list is empty (never a placeholder row)',
    run: async () => JSON.stringify(body(await ADB.handleDeviceListTool({}))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Args;
      if (b['success'] === false) return namedFailure(b);
      return countMatches(b, 'devices', 'devices');
    },
  },
  {
    name: 'adb_root_check/boolean-verdict-with-indicators',
    tool: 'adb_root_check',
    origin: 'homemade' as const,
    reference:
      'verdict contract: the root check answers with a boolean `rooted` plus an indicators array and never claims root without evidence',
    run: async () => JSON.stringify(body(await ADB.handleRootCheckTool({ serial: BENCH_SERIAL }))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Args;
      if (b['success'] === false) return namedFailure(b);
      if (typeof b['rooted'] !== 'boolean') return `rooted must be boolean`;
      const indicators = b['indicators'];
      if (!Array.isArray(indicators)) return `indicators must be an array`;
      if (b['rooted'] === true && indicators.length === 0)
        return `must not report rooted without indicators`;
      return true;
    },
  },
  {
    name: 'adb_getprop/failure-carries-adb-diagnostic',
    tool: 'adb_getprop',
    origin: 'homemade' as const,
    reference:
      'remote-command contract: an unreachable serial yields success=false with adb’s diagnostic and an empty properties map — never invented property values',
    run: async () => JSON.stringify(body(await ADB.handleGetpropTool({ serial: BENCH_SERIAL }))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Args;
      const properties = b['properties'];
      if (b['success'] !== false) {
        if (!properties || typeof properties !== 'object')
          return `success without a properties map`;
        const count = Object.keys(properties as Args).length;
        return b['count'] === count ? true : `count ${String(b['count'])} != ${count} properties`;
      }
      if (properties && Object.keys(properties as Args).length > 0)
        return `must not invent properties on failure`;
      return namedFailure(b);
    },
  },
  {
    name: 'adb_screenshot/failure-is-explicit',
    tool: 'adb_screenshot',
    origin: 'homemade' as const,
    reference:
      'capture contract: an unreachable serial reports success=false with the local path it would have written — no image payload is claimed',
    run: async () => JSON.stringify(body(await ADB.handleScreenshotTool({ serial: BENCH_SERIAL }))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Args;
      if (b['success'] === true) {
        return typeof b['localPath'] === 'string' && b['localPath'].length > 0
          ? true
          : `success without a localPath`;
      }
      if (b['base64'] !== undefined || b['data'] !== undefined)
        return `must not return image bytes on failure`;
      return namedFailure(b);
    },
  },
  {
    name: 'adb_screenrecord/failure-is-explicit',
    tool: 'adb_screenrecord',
    origin: 'homemade' as const,
    reference:
      'capture contract: an unreachable serial reports success=false with the target path, never a fabricated video artifact',
    run: async () =>
      JSON.stringify(body(await ADB.handleScreenrecordTool({ serial: BENCH_SERIAL }))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Args;
      if (b['success'] === true) {
        return typeof b['localPath'] === 'string' && b['localPath'].length > 0
          ? true
          : `success without a localPath`;
      }
      if (b['artifactPath'] !== undefined) return `must not claim an artifact on failure`;
      return namedFailure(b);
    },
  },
  {
    name: 'adb_logcat_query/empty-lines-with-diagnostic',
    tool: 'adb_logcat_query',
    origin: 'homemade' as const,
    reference:
      'query contract: when the log cannot be read the response keeps lines empty and surfaces the adb diagnostic instead of synthesized log rows',
    run: async () =>
      JSON.stringify(body(await ADB.handleLogcatQueryTool({ serial: BENCH_SERIAL }))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Args;
      const lines = b['lines'];
      if (!Array.isArray(lines))
        return `lines must be an array: ${JSON.stringify(b).slice(0, 160)}`;
      if (b['success'] === true) {
        return b['count'] === lines.length
          ? true
          : `count ${String(b['count'])} != ${lines.length} lines`;
      }
      if (lines.length !== 0) return `must not return rows when the read failed`;
      return namedFailure(b);
    },
  },
  {
    name: 'adb_ui_dump/failure-is-explicit',
    tool: 'adb_ui_dump',
    origin: 'homemade' as const,
    reference:
      'dump contract: the uiautomator dump of an unreachable device fails with adb’s diagnostic rather than an empty-but-successful hierarchy',
    run: async () => JSON.stringify(body(await ADB.handleUiDumpTool({ serial: BENCH_SERIAL }))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Args;
      if (b['success'] === true) {
        return b['xml'] !== undefined || b['rawXml'] !== undefined || b['localPath'] !== undefined
          ? true
          : `success without dump payload`;
      }
      if (b['xml'] !== undefined || b['rawXml'] !== undefined)
        return `must not return a hierarchy on failure`;
      return namedFailure(b);
    },
  },
  {
    name: 'adb_webview_list/failure-is-explicit',
    tool: 'adb_webview_list',
    origin: 'homemade' as const,
    reference:
      'discovery contract: with no reachable device the WebView list fails with adb’s diagnostic and no fabricated targets',
    run: async () =>
      JSON.stringify(body(await ADB.handleWebViewListTool({ serial: BENCH_SERIAL }))),
    validate: (v: unknown) => {
      const b = JSON.parse(String(v)) as Args;
      const targets = b['targets'] ?? b['webviews'];
      if (b['success'] === true) {
        return Array.isArray(targets) ? true : `success without a targets array`;
      }
      if (Array.isArray(targets) && targets.length > 0) return `must not invent targets`;
      return namedFailure(b);
    },
  },
];
