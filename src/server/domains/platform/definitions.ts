import type { Tool } from '@modelcontextprotocol/sdk/types.js';
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
        '可选。指定扫描根目录；不提供时使用默认路径（MiniApp/Cache 与 MiniApp/Plugin）。',
      ),
  ),
  tool('miniapp_pkg_unpack', (t) =>
    t
      .desc('Unpack a miniapp package.')
      .string('inputPath', '必填。小程序包文件路径。')
      .string('outputDir', '可选。输出目录；不提供时自动生成 artifacts 临时目录。')
      .required('inputPath'),
  ),
  tool('miniapp_pkg_analyze', (t) =>
    t
      .desc('Analyze an unpacked miniapp package.')
      .string('unpackedDir', '必填。已解包目录路径。')
      .required('unpackedDir'),
  ),
  tool('asar_extract', (t) =>
    t
      .desc('Extract files from an Electron ASAR archive.')
      .string('inputPath', '必填。asar 文件路径。')
      .string('outputDir', '可选。提取目录；不提供时自动生成 artifacts 临时目录。')
      .boolean('listOnly', '可选。默认 false；true 时仅列出文件清单，不执行提取。', {
        default: false,
      })
      .required('inputPath'),
  ),
  tool('electron_inspect_app', (t) =>
    t
      .desc('Inspect an Electron app structure.')
      .string('appPath', 'Path to Electron app (.exe or app directory)')
      .required('appPath'),
  ),
  tool('electron_scan_userdata', (t) =>
    t
      .desc('Scan a directory for Electron JSON userdata files.')
      .string('dirPath', 'Directory path to scan for JSON files')
      .number('maxFiles', '可选。最多读取的 JSON 文件数量。默认 20。', {
        default: 20,
        minimum: 1,
        maximum: 10000,
      })
      .number('maxFileSizeKB', '可选。单个文件大小上限（KB）。超限文件跳过。默认 1024。', {
        default: 1024,
        minimum: 1,
        maximum: 102400,
      })
      .required('dirPath')
      .query(),
  ),
  tool('asar_search', (t) =>
    t
      .desc('Search text inside an ASAR archive.')
      .string('inputPath', '必填。ASAR 文件路径。')
      .string('pattern', '必填。正则表达式字符串。')
      .string('fileGlob', '可选。文件扩展名过滤。默认 *.js。', { default: '*.js' })
      .number('maxResults', '可选。最大返回匹配数。默认 100。', {
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
      .string('exePath', '必填。Electron .exe 文件路径。')
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
      .desc('Monitor Electron IPC via renderer-side hooks.')
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
];
