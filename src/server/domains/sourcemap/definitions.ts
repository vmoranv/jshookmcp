import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const sourcemapTools: Tool[] = [
  tool('sourcemap_discover')
    .desc('自动发现页面中的 SourceMap（CDP scriptParsed + 脚本尾部注释回退）')
    .boolean('includeInline', '包含 data: URI 内联 SourceMap', { default: true })
    .build(),

  tool('sourcemap_fetch_and_parse')
    .desc('获取并解析 SourceMap v3（纯 TypeScript VLQ 解码），还原映射统计')
    .string('sourceMapUrl', 'SourceMap URL（绝对/相对/data: URI）')
    .string('scriptUrl', '用于解析相对路径的脚本 URL')
    .required('sourceMapUrl')
    .build(),

  tool('sourcemap_reconstruct_tree')
    .desc('从 SourceMap 重建原始项目文件树并写出到目录')
    .string('sourceMapUrl', 'SourceMap URL')
    .string('outputDir', '输出目录')
    .required('sourceMapUrl')
    .build(),
];
