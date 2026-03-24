import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const platformTools: Tool[] = [
  {
    name: 'miniapp_pkg_scan',
    description: '扫描本地小程序缓存目录，列出所有 小程序包文件。默认扫描常见 Windows 路径。',
    inputSchema: {
      type: 'object',
      properties: {
        searchPath: {
          type: 'string',
          description:
            '可选。指定扫描根目录；不提供时使用默认路径（MiniApp/Cache 与 MiniApp/Plugin）。',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'miniapp_pkg_unpack',
    description: '解包 小程序包文件。优先调用外部 外部解包工具，失败时自动降级为纯 Node.js 解析。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: '必填。小程序包文件路径。',
        },
        outputDir: {
          type: 'string',
          description: '可选。输出目录；不提供时自动生成 artifacts 临时目录。',
        },
      },
      required: ['inputPath'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'miniapp_pkg_analyze',
    description:
      '分析解包后的小程序结构，提取 pages/subPackages/components/jsFiles/totalSize/appId。',
    inputSchema: {
      type: 'object',
      properties: {
        unpackedDir: {
          type: 'string',
          description: '必填。已解包目录路径。',
        },
      },
      required: ['unpackedDir'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'asar_extract',
    description:
      '提取 Electron app.asar（纯 Node.js 实现，不依赖 @electron/asar）。支持仅列文件模式。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: '必填。asar 文件路径。',
        },
        outputDir: {
          type: 'string',
          description: '可选。提取目录；不提供时自动生成 artifacts 临时目录。',
        },
        listOnly: {
          type: 'boolean',
          description: '可选。默认 false；true 时仅列出文件清单，不执行提取。',
          default: false,
        },
      },
      required: ['inputPath'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'electron_inspect_app',
    description:
      '分析 Electron 应用结构（.exe 或 app 目录）：package.json、main、preload、dependencies、devToolsEnabled。',
    inputSchema: {
      type: 'object',
      properties: {
        appPath: {
          type: 'string',
          description: '必填。Electron .exe 路径或应用目录路径。',
        },
      },
      required: ['appPath'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'electron_scan_userdata',
    description:
      '扫描指定目录中的所有 JSON 文件，返回 raw 内容。适用于 Electron 应用的用户数据目录（Windows: %APPDATA%, macOS: ~/Library/Application Support, Linux: ~/.config）。Agent 自行解读数据。',
    inputSchema: {
      type: 'object',
      properties: {
        dirPath: {
          type: 'string',
          description: '必填。要扫描的目录绝对路径（任意平台）。',
        },
        maxFiles: {
          type: 'number',
          description: '可选。最多读取的 JSON 文件数量。默认 20。',
          default: 20,
        },
        maxFileSizeKB: {
          type: 'number',
          description: '可选。单个文件大小上限（KB）。超限文件跳过。默认 1024。',
          default: 1024,
        },
      },
      required: ['dirPath'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'asar_search',
    description: '在 ASAR 归档内执行正则搜索。Agent 提供 pattern，工具返回匹配文件路径和行内容。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: '必填。ASAR 文件路径。',
        },
        pattern: {
          type: 'string',
          description: '必填。正则表达式字符串。',
        },
        fileGlob: {
          type: 'string',
          description: '可选。文件扩展名过滤。默认 *.js。',
          default: '*.js',
        },
        maxResults: {
          type: 'number',
          description: '可选。最大返回匹配数。默认 100。',
          default: 100,
        },
      },
      required: ['inputPath', 'pattern'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'electron_check_fuses',
    description: '检测 Electron 可执行文件中的 fuse 配置状态（ASAR 完整性校验、RunAsNode 等）。',
    inputSchema: {
      type: 'object',
      properties: {
        exePath: {
          type: 'string',
          description: '必填。Electron .exe 文件路径。',
        },
      },
      required: ['exePath'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'electron_patch_fuses',
    description:
      'Patch Electron binary fuses to enable/disable debug capabilities. Creates backup before patching. Use profile="debug" to enable RunAsNode, NodeOptions, InspectArguments and disable OnlyLoadAppFromAsar.',
    inputSchema: {
      type: 'object',
      properties: {
        exePath: {
          type: 'string',
          description: 'Required. Path to the Electron .exe file to patch.',
        },
        profile: {
          type: 'string',
          enum: ['debug', 'custom'],
          description:
            'Patch profile. "debug" enables debug-related fuses. "custom" requires a fuses object.',
          default: 'debug',
        },
        fuses: {
          type: 'object',
          description:
            'For profile="custom". Map of fuse names to ENABLE/DISABLE. E.g. {"RunAsNode": "ENABLE"}.',
        },
        createBackup: {
          type: 'boolean',
          description: 'Create a .exe.bak backup before patching. Default true.',
          default: true,
        },
      },
      required: ['exePath'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'v8_bytecode_decompile',
    description:
      'Decompile V8 bytecode (.jsc / bytenode) files. Uses view8 Python package for full decompilation (preferred), falls back to built-in constant pool extraction. Returns pseudocode or extracted strings for LLM analysis.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Required. Path to the .jsc or V8 bytecode file.',
        },
      },
      required: ['filePath'],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'electron_launch_debug',
    description:
      'Launch Electron app with dual CDP debugging: --inspect for main process (Node.js) and --remote-debugging-port for renderer (Chromium). Auto-checks fuse status.',
    inputSchema: {
      type: 'object',
      properties: {
        exePath: {
          type: 'string',
          description: 'Required. Path to the Electron .exe file.',
        },
        mainPort: {
          type: 'number',
          description: 'Main process inspect port. Default 9229.',
          default: 9229,
        },
        rendererPort: {
          type: 'number',
          description: 'Renderer remote debugging port. Default 9222.',
          default: 9222,
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Extra command-line arguments.',
        },
        skipFuseCheck: {
          type: 'boolean',
          description: 'Skip fuse status check. Default false.',
          default: false,
        },
        waitMs: {
          type: 'number',
          description: 'Milliseconds to wait for CDP ports. Default 8000.',
          default: 8000,
        },
      },
      required: ['exePath'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'electron_debug_status',
    description: 'Check status of dual-CDP debug sessions launched by electron_launch_debug.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Optional. Check specific session. Omit to list all.',
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'frida_bridge',
    description:
      'Dynamic instrumentation bridge via Frida. Actions: check_env (verify frida installed), generate_script (hook template), attach (live-attach to process), run_script (inject script), detach (disconnect), list_sessions, guide (usage help).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'check_env',
            'generate_script',
            'attach',
            'run_script',
            'detach',
            'list_sessions',
            'guide',
          ],
          description: 'Action to perform. Default: guide.',
        },
        pid: {
          type: 'number',
          description: 'Process ID for attach/run_script.',
        },
        processName: {
          type: 'string',
          description: 'Process name for attach (alternative to pid).',
        },
        sessionId: {
          type: 'string',
          description: 'Session ID for run_script/detach.',
        },
        script: {
          type: 'string',
          description: 'Frida JS script to inject (for run_script).',
        },
        hookType: {
          type: 'string',
          enum: ['intercept', 'replace', 'stalker', 'module_export'],
          description: 'Hook template type (for generate_script). Default: intercept.',
        },
        functionName: {
          type: 'string',
          description: 'Target function name (for generate_script).',
        },
        target: {
          type: 'string',
          description: 'Target process name (for generate_script usage hint).',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'electron_ipc_sniff',
    description:
      'Sniff Electron IPC messages by injecting hooks into ipcRenderer via CDP. Captures invoke/send/sendSync with channel names and arguments. Actions: start (inject hooks), dump (retrieve captured messages), stop (end session), list (show sessions), guide.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'dump', 'stop', 'list', 'guide'],
          description: 'Action to perform. Default: guide.',
        },
        port: {
          type: 'number',
          description: 'Renderer CDP port (--remote-debugging-port). Default: 9222.',
          default: 9222,
        },
        sessionId: {
          type: 'string',
          description: 'Session ID for dump/stop.',
        },
        clear: {
          type: 'boolean',
          description: 'Clear captured messages after dump. Default: true.',
          default: true,
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'jadx_bridge',
    description:
      'JADX decompiler bridge for Android APK/DEX/AAR files. Actions: check_env (verify jadx installed), decompile (run jadx on input), guide (usage help).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['check_env', 'decompile', 'guide'],
          description: 'Action to perform. Default: guide.',
        },
        inputPath: {
          type: 'string',
          description: 'Required for decompile. Path to APK/DEX/AAR file.',
        },
        outputDir: {
          type: 'string',
          description: 'Optional. Output directory for decompiled sources.',
        },
        extraArgs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Extra jadx CLI arguments (e.g. ["--deobf", "--show-bad-code"]).',
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
];
