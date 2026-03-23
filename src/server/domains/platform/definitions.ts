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
    description: '扫描指定目录中的所有 JSON 文件，返回 raw 内容。适用于 Electron 应用的用户数据目录（Windows: %APPDATA%, macOS: ~/Library/Application Support, Linux: ~/.config）。Agent 自行解读数据。',
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
];
