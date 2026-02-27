import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const platformTools: Tool[] = [
  {
    name: 'miniapp_pkg_scan',
    description:
      '扫描本地小程序缓存目录，列出所有 小程序包文件。默认扫描常见 Windows 路径。',
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
  },
  {
    name: 'miniapp_pkg_unpack',
    description:
      '解包 小程序包文件。优先调用外部 外部解包工具，失败时自动降级为纯 Node.js 解析。',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: {
          type: 'string',
          description: '必填。小程序包文件路径。',
        },
        outputDir: {
          type: 'string',
          description:
            '可选。输出目录；不提供时自动生成 artifacts 临时目录。',
        },
      },
      required: ['inputPath'],
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
          description:
            '可选。提取目录；不提供时自动生成 artifacts 临时目录。',
        },
        listOnly: {
          type: 'boolean',
          description:
            '可选。默认 false；true 时仅列出文件清单，不执行提取。',
          default: false,
        },
      },
      required: ['inputPath'],
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
  },
  {
    name: 'frida_bridge',
    description:
      'Frida 集成桥接工具。检测本地 Frida 环境，生成 Frida 脚本模板，并提供与当前浏览器/进程上下文配合使用的指导。不内置 Frida 运行时——需要用户自行安装 frida-tools。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['check_env', 'generate_script', 'guide'],
          description: 'check_env: 检测 frida/frida-tools 安装状态; generate_script: 根据目标生成 Frida hook 脚本模板; guide: 返回 Frida 与本 MCP 协作的使用指南。',
        },
        target: {
          type: 'string',
          description: '目标进程名或 PID（generate_script 时使用）。',
        },
        hookType: {
          type: 'string',
          enum: ['intercept', 'replace', 'stalker', 'module_export'],
          description: '生成脚本的 hook 类型（默认 intercept）。',
          default: 'intercept',
        },
        functionName: {
          type: 'string',
          description: '要 hook 的函数名或符号（generate_script 时使用）。',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'jadx_bridge',
    description:
      'Jadx 集成桥接工具。检测本地 jadx 环境，对 APK/DEX/AAR 执行反编译，并将结果存入 artifacts 目录。不内置 Jadx——需要用户自行安装 jadx CLI。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['check_env', 'decompile', 'guide'],
          description: 'check_env: 检测 jadx 安装状态; decompile: 调用 jadx 反编译指定文件; guide: 返回 Jadx 与本 MCP 协作的使用指南。',
        },
        inputPath: {
          type: 'string',
          description: 'APK/DEX/AAR 文件路径（decompile 时必填）。',
        },
        outputDir: {
          type: 'string',
          description: '可选。反编译输出目录；不提供时自动生成 artifacts 临时目录。',
        },
        extraArgs: {
          type: 'array',
          items: { type: 'string' },
          description: '传给 jadx 的额外参数（如 --deobf, --show-bad-code）。',
        },
      },
      required: ['action'],
    },
  },
];
