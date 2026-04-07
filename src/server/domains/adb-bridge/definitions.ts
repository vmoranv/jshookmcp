import { tool } from '@server/registry/tool-builder';

export const adbBridgeTools = [
  tool('adb_device_list')
    .desc(
      'List all connected Android devices via ADB. Returns serial, model, product, state, SDK version, and ABI for each device.',
    )
    .readOnly()
    .idempotent()
    .build(),

  tool('adb_shell')
    .desc(
      'Execute an ADB shell command on a specific Android device. Supports any command: dumpsys, pm, am, logcat, getprop, etc.',
    )
    .string('serial', 'Required. Device serial number.')
    .string('command', 'Required. Shell command to execute on the device.')
    .required('serial', 'command')
    .openWorld()
    .build(),

  tool('adb_apk_pull')
    .desc('Pull an APK file from an Android device to a local path via ADB.')
    .string('serial', 'Required. Device serial number.')
    .string('packageName', 'Required. Package name to pull (e.g. com.example.app).')
    .string(
      'outputPath',
      'Optional. Local file path to save the APK. Auto-generated if not provided.',
    )
    .required('serial', 'packageName')
    .readOnly()
    .idempotent()
    .build(),

  tool('adb_apk_analyze')
    .desc(
      'Analyze an installed APK on an Android device — extract package name, version, permissions, activities, services, and receivers via dumpsys.',
    )
    .string('serial', 'Required. Device serial number.')
    .string('packageName', 'Required. Package name to analyze (e.g. com.example.app).')
    .required('serial', 'packageName')
    .readOnly()
    .idempotent()
    .build(),

  tool('adb_webview_list')
    .desc(
      'List debuggable WebView targets on an Android device via ADB port forwarding to Chrome DevTools. Requires the app to have android:debuggable="true".',
    )
    .string('serial', 'Required. Device serial number.')
    .number('hostPort', 'Optional. Local port for ADB forwarding. Default: 9222.', {
      default: 9222,
    })
    .required('serial')
    .readOnly()
    .idempotent()
    .build(),

  tool('adb_webview_attach')
    .desc(
      'Attach to a WebView target on an Android device via ADB port forwarding. Sets up CDP debugging channel. Returns WebSocket debugger URL.',
    )
    .string('serial', 'Required. Device serial number.')
    .string('targetId', 'Required. WebView target ID from adb_webview_list.')
    .number('hostPort', 'Optional. Local port for ADB forwarding. Default: 9222.', {
      default: 9222,
    })
    .required('serial', 'targetId')
    .openWorld()
    .build(),
];
