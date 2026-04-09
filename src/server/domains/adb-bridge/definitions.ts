import { tool } from '@server/registry/tool-builder';

export const adbBridgeTools = [
  tool('adb_device_list', (t) =>
    t.desc('List Android devices that are currently reachable through ADB.').query(),
  ),

  tool('adb_shell', (t) =>
    t
      .desc('Run an ADB shell command on a specific Android device.')
      .string('serial', 'Required. Android device serial or emulator id.')
      .string('command', 'Required. Shell command to execute.')
      .requiredOpenWorld('serial', 'command'),
  ),

  tool('adb_apk_pull', (t) =>
    t
      .desc('Pull an APK file from an Android device to a local path.')
      .string('serial', 'Required. Android device serial or emulator id.')
      .string('packageName', 'Required. Android package name, for example com.example.app.')
      .string('outputPath', 'Optional. Local destination path for the APK.')
      .requiredOpenWorld('serial', 'packageName'),
  ),

  tool('adb_apk_analyze', (t) =>
    t
      .desc(
        'Analyze an installed APK — package name, version, permissions, activities, services, receivers.',
      )
      .string('serial', 'Required. Android device serial or emulator id.')
      .string('packageName', 'Required. Android package name, for example com.example.app.')
      .requiredOpenWorld('serial', 'packageName'),
  ),

  tool('adb_webview_list', (t) =>
    t
      .desc(
        'List debuggable WebView targets via ADB port forwarding to Chrome DevTools. Requires android:debuggable="true".',
      )
      .string('serial', 'Required. Android device serial or emulator id.')
      .number('hostPort', 'Optional. Local port to use for forwarding.', { default: 9222 })
      .requiredOpenWorld('serial'),
  ),

  tool('adb_webview_attach', (t) =>
    t
      .desc('Attach to a WebView via ADB port forwarding; returns WebSocket debugger URL for CDP.')
      .string('serial', 'Required. Android device serial or emulator id.')
      .string('targetId', 'Required. WebView target id returned by adb_webview_list.')
      .number('hostPort', 'Optional. Local port to use for forwarding.', { default: 9222 })
      .requiredOpenWorld('serial', 'targetId'),
  ),
];
