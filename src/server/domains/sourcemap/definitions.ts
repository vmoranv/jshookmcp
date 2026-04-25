import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const sourcemapTools: Tool[] = [
  tool('sourcemap_discover', (t) =>
    t
      .desc('Discover source maps on the current page.')
      .boolean('includeInline', 'Include inline data: source maps.', { default: true }),
  ),
  tool('sourcemap_fetch_and_parse', (t) =>
    t
      .desc('Parse a source map.')
      .string('sourceMapUrl', 'Source map URL.')
      .string('scriptUrl', 'Script URL for relative map resolution.')
      .required('sourceMapUrl'),
  ),
  tool('sourcemap_reconstruct_tree', (t) =>
    t
      .desc('Reconstruct source files from a source map.')
      .string('sourceMapUrl', 'Source map URL.')
      .string('outputDir', 'Output directory under the project root.')
      .required('sourceMapUrl'),
  ),
];
