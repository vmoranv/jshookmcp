import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';
import {
  BINARY_STRINGS_MAX_RESULTS_DEFAULT,
  BINARY_STRINGS_MIN_LENGTH_DEFAULT,
} from '@src/constants';
import { getReverseEngineeringConfig } from '@utils/reverseEngineeringConfig';
import { apkPackerTools } from './apk-packer/definitions';
import { binarySecretsTools } from './secrets/definitions';

const reverseConfig = getReverseEngineeringConfig();
const apkConfig = reverseConfig.apk;
const dexConfig = reverseConfig.dex;
const fridaConfig = reverseConfig.frida;

export const binaryInstrumentTools: Tool[] = [
  tool('binary_instrument_capabilities', (t) =>
    t.desc('Report binary instrumentation backend availability.').query(),
  ),
  tool('frida_attach', (t) =>
    t
      .desc('Attach Frida to a local target and open a session.')
      .string('target', 'Process name, PID, or binary path to attach to')
      .required('target'),
  ),
  tool('frida_enumerate_modules', (t) =>
    t
      .desc('List loaded modules in an attached Frida session.')
      .string('sessionId', 'Session id returned by frida_attach')
      .required('sessionId')
      .query(),
  ),
  tool('ghidra_analyze', (t) =>
    t
      .desc('Analyze a binary and return metadata.')
      .string('binaryPath', 'Path to the binary file')
      .number('timeout', 'Optional timeout in milliseconds for headless analysis')
      .required('binaryPath'),
  ),
  tool('generate_hooks', (t) =>
    t
      .desc('Generate a Frida interceptor script for a list of symbols.')
      .array('symbols', { type: 'string' }, 'Symbol names to hook')
      .object(
        'options',
        {
          includeArgs: { type: 'boolean', description: 'Emit argument logging on function entry' },
          includeRetAddr: {
            type: 'boolean',
            description: 'Emit return-address logging on function entry',
          },
        },
        'Optional Frida hook generation flags',
      )
      .required('symbols'),
  ),
  tool('unidbg_emulate', (t) =>
    t
      .desc('Emulate a native function with Unidbg when available.')
      .string('binaryPath', 'Path to the binary file')
      .string('functionName', 'Function name to emulate')
      .array('args', { type: 'string' }, 'Optional string arguments forwarded to emulation')
      .required('binaryPath', 'functionName'),
  ),
  tool('frida_run_script', (t) =>
    t
      .desc('Execute a Frida JavaScript snippet inside an attached Frida session.')
      .string('sessionId', 'Session id returned by frida_attach')
      .string('script', 'Frida JavaScript to execute')
      .required('sessionId', 'script'),
  ),
  tool('frida_detach', (t) =>
    t
      .desc('Detach from a Frida session and clean up resources.')
      .string('sessionId', 'Session id returned by frida_attach')
      .required('sessionId'),
  ),
  tool('frida_list_sessions', (t) =>
    t.desc('List all active Frida attach sessions with target info.').query(),
  ),
  tool('frida_dex_dump', (t) =>
    t
      .desc(
        'Run frida-dexdump as a high-level Android DEX dump helper by package/process name or PID.',
      )
      .string('target', 'Package/process name for -n, for example com.example.app.')
      .number('pid', 'Optional process id for -p. Overrides target when provided.')
      .string('outputDir', 'Required output directory for dumped DEX files.')
      .boolean('usb', 'Use USB device mode (-U).', { default: true })
      .number('timeoutMs', 'Optional timeout in milliseconds.', {
        default: fridaConfig.dexDumpTimeoutMs,
      })
      .required('outputDir'),
  ),
  tool('android_runtime_dump_session', (t) =>
    t
      .desc(
        'Create or inspect a managed Android runtime dump session from Frida/ADB dump artifacts, DEX files, and /proc/PID/maps snapshots.',
      )
      .string('action', 'Session action: start, status, or list. Defaults to start.')
      .string('packageName', 'Android package name for the runtime target.')
      .number('pid', 'Runtime process id when known.')
      .string('outputDir', 'Directory containing dumped DEX/CDEX artifacts for action=start.')
      .string('mapsPath', 'Optional local file containing a /proc/PID/maps snapshot.')
      .string('sessionId', 'Session id for action=status.')
      .number('maxDexFiles', 'Maximum dumped DEX/CDEX files to summarize.', {
        default: dexConfig.artifactDefaultLimit,
      })
      .number('maxDexFileBytes', 'Maximum bytes to read from each dumped DEX/CDEX file.', {
        default: dexConfig.artifactDefaultMaxFileBytes,
      })
      .number('maxTotalDexBytes', 'Maximum total dumped DEX/CDEX bytes to read.', {
        default: dexConfig.artifactDefaultMaxTotalBytes,
      })
      .number('maxMapsBytes', 'Maximum bytes to read from the maps snapshot.')
      .number('maxMapsModules', 'Maximum distinct mapped module paths to return.')
      .query(),
  ),
  tool('frida_generate_script', (t) =>
    t
      .desc('Generate a Frida interceptor or hook script from built-in templates.')
      .string('target', 'Target binary or module name')
      .string('template', 'Hook template type: trace, intercept, replace, log')
      .string('functionName', 'Function name to generate hook for')
      .required('target', 'template'),
  ),
  tool('get_available_plugins', (t) => t.desc('List installed binary analysis plugins.').query()),
  tool('ghidra_decompile', (t) =>
    t
      .desc('Decompile a function using Ghidra.')
      .string('binaryPath', 'Path to the binary file')
      .string('functionName', 'Function name to decompile')
      .required('binaryPath', 'functionName'),
  ),
  tool('ida_decompile', (t) =>
    t
      .desc('Decompile a function using IDA Pro.')
      .string('binaryPath', 'Path to the binary file')
      .string('functionName', 'Function name to decompile')
      .required('binaryPath', 'functionName'),
  ),
  tool('jadx_decompile', (t) =>
    t
      .desc('Decompile an APK class or method with JADX CLI.')
      .string('apkPath', 'Path to the APK file')
      .string('className', 'Fully qualified class name')
      .string('methodName', 'Method name to decompile')
      .required('apkPath', 'className'),
  ),
  tool('jadx_decompile_apk', (t) =>
    t
      .desc(
        'High-level JADX APK decompile: decompile the whole APK to a stable output directory and return sourcesDir for jadx_search_code.',
      )
      .string('apkPath', 'Path to the APK, DEX, or CDEX file')
      .string('outputDir', 'Optional output directory. Defaults to a temp directory.')
      .boolean('noResources', 'Skip resources with --no-res.', { default: false })
      .boolean('force', 'Clear outputDir before decompilation if it exists.', { default: false })
      .required('apkPath'),
  ),
  tool('apktool_decode', (t) =>
    t
      .desc('Decode an APK using apktool to inspect resources, manifest, and smali output.')
      .string('apkPath', 'Path to the APK file')
      .string('outputDir', 'Optional output directory for decoded contents')
      .boolean('force', 'Overwrite output directory if it already exists', { default: false })
      .required('apkPath'),
  ),
  tool('apk_manifest_dump', (t) =>
    t
      .desc('Extract AndroidManifest.xml from an APK for quick inspection.')
      .string('apkPath', 'Path to the APK file')
      .required('apkPath'),
  ),
  tool('apk_manifest_query', (t) =>
    t
      .desc(
        'Return a compact structured AndroidManifest summary: package, launcher activity, app class, SDKs, permissions, components, providers, and SDK/surface hints.',
      )
      .string('apkPath', 'Path to the APK file')
      .boolean('includeRawManifest', 'Include decoded manifest XML in the response.', {
        default: false,
      })
      .array(
        'customSurfaceHints',
        {
          type: 'object',
          description:
            'Caller-supplied literal surface hint rule: {name, patterns:string[], kind?:"protector"|"sdk"}. Patterns are substring matches, not regex.',
        },
        'Optional caller-supplied hint rules. No rule table is bundled by this parameter.',
      )
      .required('apkPath')
      .query(),
  ),
  tool('apk_static_triage', (t) =>
    t
      .desc(
        'One-shot APK triage: ZIP metadata, manifest summary, native libs, asset hints, likely packers/protectors, and recommended next steps.',
      )
      .string('apkPath', 'Path to the APK file')
      .number('maxEntries', 'Maximum ZIP entries to summarize.', {
        default: apkConfig.staticTriageDefaultEntries,
      })
      .array(
        'customSurfaceHints',
        {
          type: 'object',
          description:
            'Caller-supplied literal surface hint rule: {name, patterns:string[], kind?:"protector"|"sdk"}. Patterns are substring matches, not regex.',
        },
        'Optional caller-supplied hint rules. No rule table is bundled by this parameter.',
      )
      .required('apkPath')
      .query(),
  ),
  tool('apk_dex_intake', (t) =>
    t
      .desc(
        'Build a cohesive APK/DEX intake evidence packet: ZIP entries, manifest summary, DEX headers, native libraries, generic surface hints, caller-supplied hint matches, and next actions.',
      )
      .string('apkPath', 'Path to the APK file')
      .number('maxEntries', 'Maximum ZIP entries to include in the evidence packet.', {
        default: apkConfig.staticTriageDefaultEntries,
      })
      .number('maxDexFiles', 'Maximum DEX/CDEX entries to read and summarize.', {
        default: apkConfig.dexIntakeDefaultDexFiles,
      })
      .number('maxDexBytes', 'Maximum bytes to read from each DEX/CDEX entry.', {
        default: dexConfig.artifactDefaultMaxFileBytes,
      })
      .number('maxTotalDexBytes', 'Maximum total DEX/CDEX bytes to read from the APK.', {
        default: dexConfig.artifactDefaultMaxTotalBytes,
      })
      .boolean('includeRawManifest', 'Include decoded manifest XML in the response.', {
        default: false,
      })
      .array(
        'customSurfaceHints',
        {
          type: 'object',
          description:
            'Caller-supplied literal surface hint rule: {name, patterns:string[], kind?:"protector"|"sdk"}. Patterns are substring matches, not regex.',
        },
        'Optional caller-supplied hint rules. No rule table is bundled by this parameter.',
      )
      .required('apkPath')
      .query(),
  ),
  tool('dex_scan_file', (t) =>
    t
      .desc(
        'Scan a binary/memory-dump file for DEX or CompactDex magic and optionally extract hits.',
      )
      .string('filePath', 'Path to a binary, memory dump, DEX, CDEX, VDEX, or APK-extracted blob.')
      .string('outputDir', 'Optional output directory for extracted DEX/CDEX hits.')
      .number('maxHits', 'Maximum DEX/CDEX headers to report.', {
        default: dexConfig.scanDefaultMaxHits,
      })
      .boolean('extract', 'Write discovered hits to outputDir when file sizes are plausible.', {
        default: false,
      })
      .required('filePath')
      .query(),
  ),
  tool('binary_strings_extract', (t) =>
    t
      .desc('Extract printable ASCII/UTF-16LE strings from a binary file with regex filtering.')
      .string('filePath', 'Path to the binary file.')
      .number('minLength', 'Minimum string length.', {
        default: BINARY_STRINGS_MIN_LENGTH_DEFAULT,
      })
      .number('maxResults', 'Maximum strings to return.', {
        default: BINARY_STRINGS_MAX_RESULTS_DEFAULT,
      })
      .string('pattern', 'Optional JavaScript regex filter.')
      .required('filePath')
      .query(),
  ),
  tool('apk_native_libs_list', (t) =>
    t
      .desc('List packaged native shared libraries (.so) inside an APK.')
      .string('apkPath', 'Path to the APK file')
      .required('apkPath')
      .query(),
  ),
  tool('unidbg_launch', (t) =>
    t
      .desc('Emulate a native shared library in Unidbg.')
      .string('soPath', 'Path to the .so library file')
      .string('arch', 'Architecture: arm or arm64')
      .required('soPath'),
  ),
  tool('unidbg_call', (t) =>
    t
      .desc('Call a JNI function in a running Unidbg emulator session.')
      .string('sessionId', 'Session id from unidbg_launch')
      .string('functionName', 'JNI function name to call')
      .required('sessionId', 'functionName'),
  ),
  tool('unidbg_trace', (t) =>
    t
      .desc('Get execution trace from Unidbg session with configurable detail.')
      .string('sessionId', 'Session id from unidbg_launch')
      .required('sessionId'),
  ),
  tool('export_hook_script', (t) =>
    t
      .desc('Export generated hook templates as a complete, runnable Frida script.')
      .string('hookTemplates', 'JSON array of hook template objects'),
  ),
  tool('frida_enumerate_functions', (t) =>
    t
      .desc('Enumerate exported functions for a specific module in a Frida session.')
      .string('sessionId', 'Session id returned by frida_attach')
      .string('moduleName', 'Module name to enumerate exports from')
      .required('sessionId', 'moduleName')
      .query(),
  ),
  tool('frida_find_symbols', (t) =>
    t
      .desc('Search for symbols matching a pattern in a Frida session.')
      .string('sessionId', 'Session id returned by frida_attach')
      .string('pattern', 'Symbol search pattern (e.g. "exports:*libssl*SSL*")')
      .required('sessionId', 'pattern')
      .query(),
  ),
  tool('jadx_search_code', (t) =>
    t
      .desc(
        'Ripgrep-backed search over jadx output. Pass decompileDir for read-only search, or apkPath to auto-decompile to a temporary directory first.',
      )
      .string('decompileDir', 'Absolute path to an existing jadx decompile output directory.')
      .string('apkPath', 'Optional APK path. Used only when decompileDir is omitted.')
      .string('query', 'Search query (regex unless `literal:true`)')
      .boolean('literal', 'Treat `query` as a literal string, not a regex', { default: false })
      .boolean('caseInsensitive', 'Case-insensitive matching', { default: false })
      .integer('contextLines', 'Lines of context around each match', {
        default: 2,
        minimum: 0,
        maximum: 20,
      })
      .integer('maxMatchesPerFile', 'Cap on matches recorded per file', { minimum: 1 })
      .integer('maxResults', 'Hard ceiling on total matches across all files', { minimum: 1 })
      .array(
        'globs',
        { type: 'string', description: 'Glob pattern (negative globs may start with !)' },
        'File globs applied during enumeration. Defaults to `**/*.java`, `**/*.kt`.',
      )
      .required('query')
      .query(),
  ),
  ...apkPackerTools,
  ...binarySecretsTools,
];
