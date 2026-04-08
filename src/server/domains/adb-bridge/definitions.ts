import { tool } from '@server/registry/tool-builder';

export const adbBridgeTools = [
  tool('adb_device_list')
    .desc('List Android devices that are currently reachable through ADB.')
    .readOnly()
    .idempotent()
    .build(),

  tool('adb_shell')
    .desc('Run an ADB shell command on a specific Android device.')
    .string('serial', 'Required. Android device serial or emulator id.')
    .string('command', 'Required. Shell command to execute.')
    .required('serial', 'command')
    .openWorld()
    .build(),

  tool('adb_apk_pull')
    .desc('Pull an APK file from an Android device to a local path.')
    .string('serial', 'Required. Android device serial or emulator id.')
    .string('packageName', 'Required. Android package name, for example com.example.app.')
    .string('outputPath', 'Optional. Local destination path for the APK.')
    .required('serial', 'packageName')
    .openWorld()
    .build(),

  tool('adb_apk_analyze')
    .desc('Analyze an installed APK — package name, version, permissions, activities, services, receivers.')
    .string('serial', 'Required. Android device serial or emulator id.')
    .string('packageName', 'Required. Android package name, for example com.example.app.')
    .required('serial', 'packageName')
    .openWorld()
    .build(),

  tool('adb_webview_list')
    .desc('List debuggable WebView targets via ADB port forwarding to Chrome DevTools. Requires android:debuggable="true".')
    .string('serial', 'Required. Android device serial or emulator id.')
    .number('hostPort', 'Optional. Local port to use for forwarding.', { default: 9222 })
    .required('serial')
    .openWorld()
    .build(),

  tool('adb_webview_attach')
    .desc('Attach to a WebView via ADB port forwarding; returns WebSocket debugger URL for CDP.')
    .string('serial', 'Required. Android device serial or emulator id.')
    .string('targetId', 'Required. WebView target id returned by adb_webview_list.')
    .number('hostPort', 'Optional. Local port to use for forwarding.', { default: 9222 })
    .required('serial', 'targetId')
    .openWorld()
    .build(),
];
