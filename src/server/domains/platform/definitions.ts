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
];
