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
      .desc('Fetch a source map from URL and parse to original sources.')
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
  tool('sourcemap_parse_v4', (t) =>
    t
      .desc('Parse source map with ECMA-426 v4 scope/debug-id support; falls back to v3.')
      .string('sourceMapUrl', 'Source map URL to parse.')
      .boolean('extractScopes', 'Extract and decode scope information from v4 x_scopes field', {
        default: true,
      })
      .boolean('extractDebugIds', 'Extract debug-id mappings for source correlation', {
        default: true,
      })
      .boolean('compareV3', 'Compare v4 fields against v3 baseline and report differences', {
        default: false,
      })
      .required('sourceMapUrl'),
  ),
];
