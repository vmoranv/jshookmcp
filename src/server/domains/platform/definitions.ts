import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

export const platformTools: Tool[] = [
  tool('platform_capabilities', (t) =>
    t.desc('Report platform tool backend availability.').query(),
  ),
  tool('miniapp_pkg_scan', (t) =>
    t
      .desc('Scan local directories for miniapp package files.')
      .string(
        'searchPath',
        'Optional scan root. Defaults to the MiniApp/Cache and MiniApp/Plugin directories.',
      ),
  ),
  tool('miniapp_pkg_unpack', (t) =>
    t
      .desc('Unpack a miniapp package.')
      .string('inputPath', 'Required. Path to the miniapp package file.')
      .string(
        'outputDir',
        'Optional output directory. Defaults to a generated temporary artifacts directory.',
      )
      .required('inputPath'),
  ),
  tool('miniapp_pkg_analyze', (t) =>
    t
      .desc('Analyze an unpacked miniapp package.')
      .string('unpackedDir', 'Required. Path to the unpacked directory.')
      .required('unpackedDir'),
  ),
  tool('asar_extract', (t) =>
    t
      .desc(
        'List or unpack the files of an Electron ASAR archive into a folder (listOnly only lists them).',
      )
      .string('inputPath', 'Required. Path to the ASAR file.')
      .string(
        'outputDir',
        'Optional extraction directory. Defaults to a generated temporary artifacts directory.',
      )
      .boolean(
        'listOnly',
        'Optional. Defaults to false. When true, only lists files without extracting.',
        {
          default: false,
        },
      )
      .required('inputPath'),
  ),
  tool('electron_inspect_app', (t) =>
    t
      .desc('Analyze Electron app structure: main/renderer entry, preload, IPC.')
      .string('appPath', 'Path to Electron app (.exe or app directory)')
      .required('appPath'),
  ),
  tool('electron_scan_userdata', (t) =>
    t
      .desc('Scan a directory for Electron JSON userdata files.')
      .string('dirPath', 'Directory path to scan for JSON files')
      .number('maxFiles', 'Optional. Maximum number of JSON files to read. Defaults to 20.', {
        default: 20,
        minimum: 1,
        maximum: 10000,
      })
      .number(
        'maxFileSizeKB',
        'Optional. Per-file size limit in KB. Larger files are skipped. Defaults to 1024.',
        {
          default: 1024,
          minimum: 1,
          maximum: 102400,
        },
      )
      .required('dirPath')
      .query(),
  ),
  tool('asar_search', (t) =>
    t
      .desc('Grep text patterns inside ASAR archive contents without extraction.')
      .string('inputPath', 'Required. Path to the ASAR file.')
      .string('pattern', 'Required. Regular expression string.')
      .string('fileGlob', 'Optional file extension filter. Defaults to *.js.', { default: '*.js' })
      .number('maxResults', 'Optional. Maximum number of matches to return. Defaults to 100.', {
        default: 100,
        minimum: 1,
        maximum: 10000,
      })
      .required('inputPath', 'pattern')
      .query(),
  ),
  tool('electron_check_fuses', (t) =>
    t
      .desc('Read Electron fuse states.')
      .string('exePath', 'Required. Path to the Electron .exe file.')
      .required('exePath')
      .query(),
  ),
  tool('electron_patch_fuses', (t) =>
    t
      .desc('Patch Electron fuse states.')
      .string('exePath', 'Electron .exe file path')
      .enum(
        'profile',
        ['debug', 'custom'],
        'Patch profile. "debug" enables debug-related fuses. "custom" requires a fuses object.',
        { default: 'debug' },
      )
      .object(
        'fuses',
        {},
        'For profile="custom". Map of fuse names to ENABLE/DISABLE. E.g. {"RunAsNode": "ENABLE"}.',
      )
      .boolean('createBackup', 'Create a .exe.bak backup before patching.', { default: true })
      .required('exePath')
      .destructive(),
  ),
  tool('v8_bytecode_decompile', (t) =>
    t
      .desc('Decompile or extract strings from V8 bytecode files.')
      .string('filePath', 'Path to .jsc bytecode file')
      .required('filePath')
      .query(),
  ),
  tool('electron_launch_debug', (t) =>
    t
      .desc('Launch Electron with main and renderer CDP ports.')
      .string('exePath', 'Electron .exe file path')
      .number('mainPort', 'Main process inspect port.', {
        default: 9229,
        minimum: 1,
        maximum: 65535,
      })
      .number('rendererPort', 'Renderer remote debugging port.', {
        default: 9222,
        minimum: 1,
        maximum: 65535,
      })
      .array('args', { type: 'string' }, 'Extra command-line arguments.')
      .boolean('skipFuseCheck', 'Skip fuse status check.', { default: false })
      .boolean(
        'skipBinaryCheck',
        'Skip Electron binary validation. Use when the target exe has been renamed (e.g. Code.exe, Discord.exe).',
        { default: false },
      )
      .number('waitMs', 'Milliseconds to wait for CDP ports.', {
        default: 8000,
        minimum: 1000,
        maximum: 120000,
      })
      .requiredOpenWorld('exePath'),
  ),
  tool('electron_debug_status', (t) =>
    t
      .desc('Check status of dual-CDP debug sessions launched by electron_launch_debug.')
      .string('sessionId', 'Optional. Check specific session. Omit to list all.')
      .query(),
  ),
  tool('electron_ipc_sniff', (t) =>
    t
      .desc('Monitor Electron IPC messages.')
      .enum('action', ['start', 'dump', 'stop', 'list', 'guide'], 'Action to perform.', {
        default: 'guide',
      })
      .number('port', 'Renderer CDP port (--remote-debugging-port).', {
        default: 9222,
        minimum: 1,
        maximum: 65535,
      })
      .string('sessionId', 'Session ID for dump/stop.')
      .boolean('clear', 'Clear captured messages after dump.', { default: true })
      .openWorld(),
  ),
  tool('electron_verify_integrity', (t) =>
    t
      .desc(
        'Verify Electron ASAR integrity: parse the ElectronAsarIntegrity JSON embedded in the ' +
          'main binary, locate each referenced ASAR, and compare the on-disk SHA256/SHA512 hash ' +
          'against the embedded hash. A mismatch means the ASAR was tampered with after build.',
      )
      .string('exePath', 'Required. Path to the Electron executable (.exe / main binary).')
      .string(
        'asarPath',
        'Optional. Explicit ASAR path. Defaults to auto-detection at resources/app.asar.',
      )
      .required('exePath')
      .query(),
  ),
  tool('asar_deobfuscate', (t) =>
    t
      .desc(
        'Scan every .js script inside this electron archive to find files to deobfuscate: ' +
          'classify obfuscation indicators (string-array arrays, webpack bundles, control-flow ' +
          'flattening, dynamic code, minification) and optionally extract flagged files ' +
          'unchanged to a directory for downstream deobfuscation. This tool returns an ' +
          'inventory, not deobfuscated scripts.',
      )
      .string('inputPath', 'Required. Path to the ASAR file.')
      .string('fileGlob', 'Optional file extension filter. Defaults to *.js.', { default: '*.js' })
      .boolean(
        'extract',
        'Optional. Defaults to true; extracts files above the score threshold into outputDir for downstream deobfuscation.',
        { default: true },
      )
      .string(
        'outputDir',
        'Optional extraction directory. Defaults to a generated temporary artifacts directory.',
      )
      .number('maxFiles', 'Optional. Maximum number of files to scan. Defaults to 500.', {
        default: 500,
        minimum: 1,
        maximum: 10000,
      })
      .required('inputPath')
      .query(),
  ),
  tool('asar_repack', (t) =>
    t
      .desc(
        'Pack a directory tree into an Electron ASAR archive (inverse of asar_extract). ' +
          'Walks the input directory and writes a valid .asar (4xUInt32LE pickle prefix + ' +
          'JSON header + data segment) that parseAsarBuffer and Electron accept. Closes the ' +
          'unpack → patch → repack → retest loop without leaving jshookmcp.',
      )
      .string('inputDir', 'Required. Source directory to pack.')
      .string(
        'outputPath',
        'Optional output .asar path. Defaults to a generated temporary artifacts path.',
      )
      .required('inputDir')
      .query(),
  ),
  tool('electron_verify_signature', (t) =>
    t
      .desc(
        "Inspect a packaged Electron binary's own code signature (PE Authenticode on Windows, " +
          'Mach-O embedded code signature on macOS). Pure-TS structural parse: locates the ' +
          'WIN_CERTIFICATE / SuperBlob, decodes the PKCS#7 SignedData, and surfaces the cert ' +
          'chain, signer, digest algorithm, and (macOS) the CodeDirectory ident + best-effort ' +
          'cdhash. No codesign/signtool dependency (runs in any CI). Cryptographic signature ' +
          'validity and timestamp counter-signatures are out of scope (verified:false).',
      )
      .string('exePath', 'Required. Path to the Electron executable (.exe / macOS app binary).')
      .required('exePath')
      .query(),
  ),
];
