import { tool } from '@server/registry/tool-builder';
import { ADB_WEBVIEW_HOST_PORT_DEFAULT } from '@src/constants';

export const adbBridgeTools = [
  tool('adb_device_list', (t) =>
    t.desc('List all connected Android devices and emulators.').query(),
  ),

  tool('adb_shell', (t) =>
    t
      .desc('Execute an ADB shell command on a specific device.')
      .string('serial', 'Android device serial or emulator id')
      .string('command', 'Shell command to run (e.g. "getprop ro.build.version.release")')
      .boolean(
        'allowNonZero',
        'Return stdout/stderr/exitCode instead of raising an MCP runtime error on non-zero exit.',
        { default: true },
      )
      .number('timeoutMs', 'Optional command timeout in milliseconds.')
      .number('maxBufferBytes', 'Optional stdout/stderr max buffer in bytes.')
      .required('serial', 'command'),
  ),

  tool('adb_install', (t) =>
    t
      .desc('Install one APK or a split-APK set onto a device with parsed success output.')
      .string('serial', 'Android device serial or emulator id')
      .string('apkPath', 'Single local APK path to install')
      .array('apkPaths', { type: 'string' }, 'Split APK paths for adb install-multiple')
      .boolean('reinstall', 'Pass -r to reinstall an existing package.', { default: true })
      .boolean('allowDowngrade', 'Pass -d to allow version downgrade.', { default: false })
      .boolean('grantPermissions', 'Pass -g to grant runtime permissions.', { default: false })
      .boolean('allowTestOnly', 'Pass -t to allow testOnly APKs.', { default: true })
      .boolean('installSplit', 'Force adb install-multiple even for a single supplied path.', {
        default: false,
      })
      .string('user', 'Optional Android user id for --user')
      .requiredOpenWorld('serial'),
  ),

  tool('adb_uninstall', (t) =>
    t
      .desc('Uninstall a package from a device, optionally keeping app data.')
      .string('serial', 'Android device serial or emulator id')
      .string('packageName', 'Android package name to uninstall')
      .boolean('keepData', 'Pass -k to keep app data and cache directories.', { default: false })
      .requiredOpenWorld('serial', 'packageName'),
  ),

  tool('adb_input_tap', (t) =>
    t
      .desc('Send a touchscreen tap event through adb shell input.')
      .string('serial', 'Android device serial or emulator id')
      .number('x', 'Screen x coordinate')
      .number('y', 'Screen y coordinate')
      .requiredOpenWorld('serial', 'x', 'y'),
  ),

  tool('adb_input_swipe', (t) =>
    t
      .desc('Send a touchscreen swipe event through adb shell input.')
      .string('serial', 'Android device serial or emulator id')
      .number('x1', 'Start x coordinate')
      .number('y1', 'Start y coordinate')
      .number('x2', 'End x coordinate')
      .number('y2', 'End y coordinate')
      .number('durationMs', 'Optional swipe duration in milliseconds')
      .requiredOpenWorld('serial', 'x1', 'y1', 'x2', 'y2'),
  ),

  tool('adb_input_keyevent', (t) =>
    t
      .desc('Send an Android keyevent name or numeric key code through adb shell input.')
      .string('serial', 'Android device serial or emulator id')
      .string('keyCode', 'Android key code or name, for example BACK, HOME, or 4')
      .requiredOpenWorld('serial', 'keyCode'),
  ),

  tool('adb_input_text', (t) =>
    t
      .desc('Send text through adb shell input text with Android-safe whitespace encoding.')
      .string('serial', 'Android device serial or emulator id')
      .string('text', 'Text to enter on the device')
      .requiredOpenWorld('serial', 'text'),
  ),

  tool('adb_proc_maps', (t) =>
    t
      .desc(
        'Read and parse /proc/PID/maps from a device, resolving PID from packageName when needed.',
      )
      .string('serial', 'Android device serial or emulator id')
      .string('pid', 'Android process id')
      .string('packageName', 'Package name used to resolve PID with pidof -s')
      .string('localPath', 'Optional local path to write the raw maps snapshot')
      .boolean('includeRaw', 'Include raw maps text in the response.', { default: false })
      .requiredOpenWorld('serial'),
  ),

  tool('adb_root_check', (t) =>
    t
      .desc('Probe root indicators such as su, Magisk, test-keys, SELinux, and shell uid.')
      .string('serial', 'Android device serial or emulator id')
      .requiredOpenWorld('serial')
      .query(),
  ),

  tool('adb_getprop', (t) =>
    t
      .desc(
        'Dump and parse Android system properties (getprop) into a structured map with a curated device fingerprint (model, SDK, ABI, build fingerprint, security patch, bootloader lock).',
      )
      .string('serial', 'Required. Android device serial or emulator id.')
      .string(
        'pattern',
        'Optional JavaScript regex applied to property keys (e.g. "ro.build" keeps only build properties).',
      )
      .requiredOpenWorld('serial')
      .query(),
  ),

  tool('adb_screenshot', (t) =>
    t
      .desc('Capture a PNG screenshot through adb exec-out screencap -p.')
      .string('serial', 'Android device serial or emulator id')
      .string('localPath', 'Optional local output PNG path')
      .requiredOpenWorld('serial'),
  ),

  tool('adb_screenrecord', (t) =>
    t
      .desc('Record a short MP4 screen capture through adb shell screenrecord and pull it locally.')
      .string('serial', 'Android device serial or emulator id')
      .string('localPath', 'Optional local output MP4 path')
      .string('remotePath', 'Optional temporary device MP4 path')
      .number(
        'durationSec',
        'Recording duration in seconds, clamped to Android screenrecord limits',
      )
      .number('bitRateMbps', 'Optional video bit rate in megabits per second')
      .string('size', 'Optional video size such as 1280x720')
      .requiredOpenWorld('serial'),
  ),

  tool('adb_port_forward', (t) =>
    t
      .desc('Manage ADB forward/reverse port mappings for device-host bridge workflows.')
      .string('serial', 'Android device serial or emulator id')
      .enum('action', ['add', 'remove', 'remove_all', 'list'], 'Port mapping action')
      .enum(
        'direction',
        ['forward', 'reverse'],
        'forward maps host→device; reverse maps device→host',
      )
      .string('local', 'Host-side endpoint such as tcp:9222')
      .string('remote', 'Device-side endpoint such as tcp:8080 or localabstract:webview_devtools')
      .requiredOpenWorld('serial', 'action', 'direction'),
  ),

  tool('adb_apk_pull', (t) =>
    t
      .desc('Pull an APK from a device to the local filesystem.')
      .string('serial', 'Android device serial or emulator id')
      .string('packageName', 'Android package name (e.g. com.example.app)')
      .string('outputPath', 'Local directory to save the APK (default: current directory)')
      .string('outputFile', 'Optional explicit local file path for a single base APK pull')
      .boolean('includeSplits', 'Pull all split APKs returned by pm path, not just base.apk', {
        default: false,
      })
      .boolean('validateZip', 'Verify pulled APK files are regular ZIP/APK files', {
        default: true,
      })
      .required('serial', 'packageName'),
  ),

  tool('adb_apk_analyze', (t) =>
    t
      .desc('Analyze an installed APK: package, permissions, activities, and security info.')
      .string('serial', 'Required. Android device serial or emulator id.')
      .string('packageName', 'Required. Android package name, for example com.example.app.')
      .requiredOpenWorld('serial', 'packageName'),
  ),

  tool('adb_package_summary', (t) =>
    t
      .desc(
        'Return structured Android package metadata: launcher, uid, versions, permissions, components, and native library dirs.',
      )
      .string('serial', 'Required. Android device serial or emulator id.')
      .string('packageName', 'Required. Android package name, for example com.example.app.')
      .requiredOpenWorld('serial', 'packageName')
      .query(),
  ),

  tool('adb_logcat_query', (t) =>
    t
      .desc('Capture and filter Android logcat output in-process without shell grep pipelines.')
      .string('serial', 'Required. Android device serial or emulator id.')
      .string(
        'packageName',
        'Optional package name. If present, PID is resolved and used as a filter.',
      )
      .string('pid', 'Optional process id filter.')
      .string('pattern', 'Optional JavaScript regex applied to each logcat line.')
      .number('tail', 'Number of latest logcat records to request from Android.', { default: 500 })
      .number('maxLines', 'Maximum matching lines returned.', { default: 100 })
      .boolean('clearBefore', 'Clear logcat before capture.', { default: false })
      .enum(
        'minPriority',
        ['V', 'D', 'I', 'W', 'E', 'F', 'S'],
        'Minimum logcat priority to return (e.g. "W" keeps Warn/Error/Fatal/Silent)',
      )
      .boolean(
        'structured',
        'Parse each line into {timestamp,pid,tid,priority,tag,message} (uses threadtime format)',
        { default: false },
      )
      .requiredOpenWorld('serial')
      .query(),
  ),

  tool('adb_app_cold_start_trace', (t) =>
    t
      .desc(
        'High-level Android startup trace: force-stop, clear logcat, start activity with -W, wait, collect PID-filtered logs, and parse launch/Looper timing.',
      )
      .string('serial', 'Required. Android device serial or emulator id.')
      .string('packageName', 'Required. Android package name, for example com.example.app.')
      .string('activity', 'Optional component activity. Defaults to resolved launcher activity.')
      .number('waitMs', 'Milliseconds to wait after am start before reading logcat.', {
        default: 5000,
      })
      .number('logcatTail', 'Number of logcat records to inspect after launch.', { default: 800 })
      .array(
        'extraPatterns',
        { type: 'string' },
        'Optional additional case-insensitive regex filters for logcat lines.',
      )
      .requiredOpenWorld('serial', 'packageName'),
  ),

  tool('adb_file_pull', (t) =>
    t
      .desc('Pull a file from an Android device using normal ADB permissions.')
      .string('serial', 'Required. Android device serial or emulator id.')
      .string('remotePath', 'Required. Path on the Android device.')
      .string('localPath', 'Required. Destination path on the local filesystem.')
      .requiredOpenWorld('serial', 'remotePath', 'localPath'),
  ),

  tool('adb_file_push', (t) =>
    t
      .desc('Push a local file to an Android device using normal ADB permissions.')
      .string('serial', 'Required. Android device serial or emulator id.')
      .string('localPath', 'Required. Local file path.')
      .string('remotePath', 'Required. Destination path on the Android device.')
      .requiredOpenWorld('serial', 'localPath', 'remotePath'),
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
      .number('hostPort', 'Optional. Local port to use for forwarding.', {
        default: ADB_WEBVIEW_HOST_PORT_DEFAULT,
      })
      .requiredOpenWorld('serial'),
  ),

  tool('adb_webview_attach', (t) =>
    t
      .desc('Attach to a WebView via ADB; returns WebSocket debugger URL for CDP.')
      .string('serial', 'Required. Android device serial or emulator id.')
      .string('targetId', 'Required. WebView target id returned by adb_webview_list.')
      .number('hostPort', 'Optional. Local port to use for forwarding.', {
        default: ADB_WEBVIEW_HOST_PORT_DEFAULT,
      })
      .requiredOpenWorld('serial', 'targetId'),
  ),
];
