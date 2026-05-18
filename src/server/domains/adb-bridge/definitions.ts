import { tool } from '@server/registry/tool-builder';

export const adbBridgeTools = [
  tool('adb_device_list', (t) =>
    t.desc('List all connected Android devices and emulators.').query(),
  ),

  tool('adb_shell', (t) =>
    t
      .desc('Execute an ADB shell command on a specific device.')
      .string('serial', 'Android device serial or emulator id')
      .string('command', 'Shell command to run (e.g. "getprop ro.build.version.release")')
      .required('serial', 'command'),
  ),

  tool('adb_apk_pull', (t) =>
    t
      .desc('Pull an APK from a device to the local filesystem.')
      .string('serial', 'Android device serial or emulator id')
      .string('packageName', 'Android package name (e.g. com.example.app)')
      .string('outputPath', 'Local directory to save the APK (default: current directory)')
      .required('serial', 'packageName'),
  ),

  tool('adb_apk_analyze', (t) =>
    t
      .desc('Analyze an installed APK: package, permissions, activities, and security info.')
      .string('serial', 'Required. Android device serial or emulator id.')
      .string('packageName', 'Required. Android package name, for example com.example.app.')
      .requiredOpenWorld('serial', 'packageName'),
  ),

  tool('adb_pull_native_libs', (t) =>
    t
      .desc('Pull native shared libraries (.so) for an installed app from a device.')
      .string('serial', 'Required. Android device serial or emulator id.')
      .string('packageName', 'Required. Android package name, for example com.example.app.')
      .string(
        'outputPath',
        'Optional. Local directory to save extracted libraries into (default: current directory).',
      )
      .boolean(
        'includeSystemLibs',
        'Optional. Include system/nativeLibraryDir entries outside the app package path.',
        { default: false },
      )
      .requiredOpenWorld('serial', 'packageName'),
  ),

  tool('adb_webview_list', (t) =>
    t
      .desc('List debuggable WebView targets connected via ADB.')
      .string('serial', 'Required. Android device serial or emulator id.')
      .number('hostPort', 'Optional. Local port to use for forwarding.', { default: 9222 })
      .requiredOpenWorld('serial'),
  ),

  tool('adb_webview_attach', (t) =>
    t
      .desc('Attach to a WebView via ADB; returns WebSocket debugger URL for CDP.')
      .string('serial', 'Required. Android device serial or emulator id.')
      .string('targetId', 'Required. WebView target id returned by adb_webview_list.')
      .number('hostPort', 'Optional. Local port to use for forwarding.', { default: 9222 })
      .requiredOpenWorld('serial', 'targetId'),
  ),
];
