import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const platformTools: Tool[] = [
  tool('miniapp_pkg_scan', (t) =>
    t
      .desc('扫描本地小程序缓存目录，列出所有 小程序包文件。默认扫描常见 Windows 路径。')
      .string(
        'searchPath',
        '可选。指定扫描根目录；不提供时使用默认路径（MiniApp/Cache 与 MiniApp/Plugin）。',
      ),
  ),
  tool('miniapp_pkg_unpack', (t) =>
    t
      .desc('解包 小程序包文件。优先调用外部 外部解包工具，失败时自动降级为纯 Node.js 解析。')
      .string('inputPath', '必填。小程序包文件路径。')
      .string('outputDir', '可选。输出目录；不提供时自动生成 artifacts 临时目录。')
      .required('inputPath'),
  ),
  tool('miniapp_pkg_analyze', (t) =>
    t
      .desc('分析解包后的小程序结构，提取 pages/subPackages/components/jsFiles/totalSize/appId。')
      .string('unpackedDir', '必填。已解包目录路径。')
      .required('unpackedDir'),
  ),
  tool('asar_extract', (t) =>
    t
      .desc('提取 Electron app.asar（纯 Node.js 实现，不依赖 @electron/asar）。支持仅列文件模式。')
      .string('inputPath', '必填。asar 文件路径。')
      .string('outputDir', '可选。提取目录；不提供时自动生成 artifacts 临时目录。')
      .boolean('listOnly', '可选。默认 false；true 时仅列出文件清单，不执行提取。', {
        default: false,
      })
      .required('inputPath'),
  ),
  tool('electron_inspect_app', (t) =>
    t
      .desc(
        '分析 Electron 应用结构（.exe 或 app 目录）：package.json、main、preload、dependencies、devToolsEnabled。',
      )
      .string('appPath', '必填。Electron .exe 路径或应用目录路径。')
      .required('appPath'),
  ),
  tool('electron_scan_userdata', (t) =>
    t
      .desc(
        '扫描指定目录中的所有 JSON 文件，返回 raw 内容。适用于 Electron 应用的用户数据目录（Windows: %APPDATA%, macOS: ~/Library/Application Support, Linux: ~/.config）。Agent 自行解读数据。',
      )
      .string('dirPath', '必填。要扫描的目录绝对路径（任意平台）。')
      .number('maxFiles', '可选。最多读取的 JSON 文件数量。默认 20。', { default: 20 })
      .number('maxFileSizeKB', '可选。单个文件大小上限（KB）。超限文件跳过。默认 1024。', {
        default: 1024,
      })
      .required('dirPath')
      .query(),
  ),
  tool('asar_search', (t) =>
    t
      .desc('在 ASAR 归档内执行正则搜索。Agent 提供 pattern，工具返回匹配文件路径和行内容。')
      .string('inputPath', '必填。ASAR 文件路径。')
      .string('pattern', '必填。正则表达式字符串。')
      .string('fileGlob', '可选。文件扩展名过滤。默认 *.js。', { default: '*.js' })
      .number('maxResults', '可选。最大返回匹配数。默认 100。', { default: 100 })
      .required('inputPath', 'pattern')
      .query(),
  ),
  tool('electron_check_fuses', (t) =>
    t
      .desc('检测 Electron 可执行文件中的 fuse 配置状态（ASAR 完整性校验、RunAsNode 等）。')
      .string('exePath', '必填。Electron .exe 文件路径。')
      .required('exePath')
      .query(),
  ),
  tool('electron_patch_fuses', (t) =>
    t
      .desc(
        'Patch Electron binary fuses to enable/disable debug capabilities. Creates backup before patching. Use profile="debug" to enable RunAsNode, NodeOptions, InspectArguments and disable OnlyLoadAppFromAsar.',
      )
      .string('exePath', 'Required. Path to the Electron .exe file to patch.')
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
      .desc(
        'Decompile V8 bytecode (.jsc / bytenode) files. Uses view8 Python package for full decompilation (preferred), falls back to built-in constant pool extraction. Returns pseudocode or extracted strings for LLM analysis.',
      )
      .string('filePath', 'Required. Path to the .jsc or V8 bytecode file.')
      .required('filePath')
      .query(),
  ),
  tool('electron_launch_debug', (t) =>
    t
      .desc(
        'Launch Electron app with dual CDP debugging: --inspect for main process (Node.js) and --remote-debugging-port for renderer (Chromium). Auto-checks fuse status.',
      )
      .string('exePath', 'Required. Path to the Electron .exe file.')
      .number('mainPort', 'Main process inspect port.', { default: 9229 })
      .number('rendererPort', 'Renderer remote debugging port.', { default: 9222 })
      .array('args', { type: 'string' }, 'Extra command-line arguments.')
      .boolean('skipFuseCheck', 'Skip fuse status check.', { default: false })
      .number('waitMs', 'Milliseconds to wait for CDP ports.', { default: 8000 })
      .requiredOpenWorld('exePath'),
  ),
  tool('electron_debug_status', (t) =>
    t
      .desc('Check status of dual-CDP debug sessions launched by electron_launch_debug.')
      .string('sessionId', 'Optional. Check specific session. Omit to list all.')
      .query(),
  ),
  tool('frida_bridge', (t) =>
    t
      .desc(
        'Dynamic instrumentation bridge via Frida. Actions: check_env (verify frida installed), generate_script (hook template), attach (live-attach to process), run_script (inject script), detach (disconnect), list_sessions, guide (usage help).',
      )
      .enum(
        'action',
        [
          'check_env',
          'generate_script',
          'attach',
          'run_script',
          'detach',
          'list_sessions',
          'guide',
        ],
        'Action to perform.',
        { default: 'guide' },
      )
      .number('pid', 'Process ID for attach/run_script.')
      .string('processName', 'Process name for attach (alternative to pid).')
      .string('sessionId', 'Session ID for run_script/detach.')
      .string('script', 'Frida JS script to inject (for run_script).')
      .enum(
        'hookType',
        ['intercept', 'replace', 'stalker', 'module_export'],
        'Hook template type (for generate_script).',
        { default: 'intercept' },
      )
      .string('functionName', 'Target function name (for generate_script).')
      .string('target', 'Target process name (for generate_script usage hint).')
      .openWorld(),
  ),
  tool('electron_ipc_sniff', (t) =>
    t
      .desc(
        'Sniff Electron IPC messages by injecting hooks into ipcRenderer via CDP. Captures invoke/send/sendSync with channel names and arguments. Actions: start (inject hooks), dump (retrieve captured messages), stop (end session), list (show sessions), guide.',
      )
      .enum('action', ['start', 'dump', 'stop', 'list', 'guide'], 'Action to perform.', {
        default: 'guide',
      })
      .number('port', 'Renderer CDP port (--remote-debugging-port).', { default: 9222 })
      .string('sessionId', 'Session ID for dump/stop.')
      .boolean('clear', 'Clear captured messages after dump.', { default: true })
      .openWorld(),
  ),
  tool('jadx_bridge', (t) =>
    t
      .desc(
        'JADX decompiler bridge for Android APK/DEX/AAR files. Actions: check_env (verify jadx installed), decompile (run jadx on input), guide (usage help).',
      )
      .enum('action', ['check_env', 'decompile', 'guide'], 'Action to perform.', {
        default: 'guide',
      })
      .string('inputPath', 'Required for decompile. Path to APK/DEX/AAR file.')
      .string('outputDir', 'Optional. Output directory for decompiled sources.')
      .array(
        'extraArgs',
        { type: 'string' },
        'Extra jadx CLI arguments (e.g. ["--deobf", "--show-bad-code"]).',
      )
      .openWorld(),
  ),
];
