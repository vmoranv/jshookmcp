import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const sourcemapTools: Tool[] = [
  {
    name: 'sourcemap_discover',
    description:
      '自动发现页面中的 SourceMap。通过 CDP Debugger.scriptParsed 事件收集 sourceMapURL，并回退检查脚本尾部 //# sourceMappingURL= 注释。',
    inputSchema: {
      type: 'object',
      properties: {
        includeInline: {
          type: 'boolean',
          description: '是否包含 data: URI 内联 SourceMap（默认: true）',
          default: true,
        },
      },
    },
  },
  {
    name: 'sourcemap_fetch_and_parse',
    description:
      '获取并解析 SourceMap v3（纯 TypeScript VLQ 解码，不依赖 source-map 包），还原 generated → original 映射统计。',
    inputSchema: {
      type: 'object',
      properties: {
        sourceMapUrl: {
          type: 'string',
          description: 'SourceMap URL（支持绝对 URL、相对 URL、data: URI）',
        },
        scriptUrl: {
          type: 'string',
          description: '可选。用于解析相对 sourceMapUrl 的脚本 URL',
        },
      },
      required: ['sourceMapUrl'],
    },
  },
  {
    name: 'sourcemap_reconstruct_tree',
    description:
      '从 SourceMap 重建原始项目文件树，将 sources + sourcesContent 写出到目录（通过 resolveArtifactPath 生成输出目录）。',
    inputSchema: {
      type: 'object',
      properties: {
        sourceMapUrl: {
          type: 'string',
          description: 'SourceMap URL（支持绝对 URL、相对 URL、data: URI）',
        },
        outputDir: {
          type: 'string',
          description: '可选输出目录（相对项目根目录或绝对路径）',
        },
      },
      required: ['sourceMapUrl'],
    },
  },
  {
    name: 'extension_list_installed',
    description:
      "列出已安装的 Chrome 扩展。通过 CDP Target.getTargets 检测 type='service_worker' 或 'background_page' 的 chrome-extension:// targets。",
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'extension_execute_in_context',
    description:
      '在指定 Chrome 扩展的 background context 中执行代码。通过 Target.attachToTarget 附加后调用 Runtime.evaluate。',
    inputSchema: {
      type: 'object',
      properties: {
        extensionId: {
          type: 'string',
          description: 'Chrome 扩展 ID（32 位 a-p 字符）',
        },
        code: {
          type: 'string',
          description: '要在扩展 background context 执行的 JavaScript 代码',
        },
        returnByValue: {
          type: 'boolean',
          description: 'Runtime.evaluate 是否按值返回（默认: true）',
          default: true,
        },
      },
      required: ['extensionId', 'code'],
    },
  },
];
