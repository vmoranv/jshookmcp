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
  tool('sourcemap_coverage', (t) =>
    t
      .desc('Summarize mapped and unmapped source coverage.')
      .string('sourceMapUrl', 'Source map URL.')
      .string('scriptUrl', 'Script URL for relative map resolution.')
      .required('sourceMapUrl'),
  ),
  tool('sourcemap_lookup', (t) =>
    t
      .desc(
        'Resolve generated code position to original source (default), or — when originalSource ' +
          'is supplied — resolve original source:line:column back to the generated position. ' +
          'Supports indexed (sectioned) source maps transparently.',
      )
      .string('sourceMapUrl', 'Source map URL.')
      .string('scriptUrl', 'Script URL for relative map resolution.')
      .number('line', 'Generated line number (forward lookup).', { minimum: 1 })
      .number('column', 'Generated column number (forward lookup).', { minimum: 0 })
      .string(
        'originalSource',
        'Original source path. When set, performs reverse lookup (original -> generated) and line/column refer to the original position.',
      )
      .number('originalLine', 'Original line number (reverse lookup).', { minimum: 1 })
      .number('originalColumn', 'Original column number (reverse lookup).', { minimum: 0 })
      .required('sourceMapUrl'),
  ),
  tool('sourcemap_reconstruct_tree', (t) =>
    t
      .desc(
        'Reconstruct source files from a source map. When a vendor stripped sourcesContent, set inferMissing=true to emit a best-effort name+position skeleton (from mapping segments) instead of a placeholder.',
      )
      .string('sourceMapUrl', 'Source map URL.')
      .string('outputDir', 'Output directory under the project root.')
      .boolean(
        'inferMissing',
        'For sources with null sourcesContent, infer a name+position skeleton from the decoded mapping segments instead of writing a placeholder comment.',
        { default: false },
      )
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
  tool('sourcemap_diff', (t) =>
    t
      .desc(
        'Compare two source map revisions: which sources were added/removed, per-source mapping ' +
          'segment deltas, and generated-position shifts beyond a configurable threshold (default 1 line).',
      )
      .string('sourceMapUrl', 'First source map URL.')
      .string('sourceMapUrlB', 'Second source map URL.')
      .string('scriptUrl', 'Script URL for relative map A resolution.')
      .string('scriptUrlB', 'Script URL for relative map B resolution.')
      .number(
        'positionThreshold',
        'Min generated-line delta to flag a segment as "shifted" (default 1).',
        { minimum: 1, default: 1 },
      )
      .required('sourceMapUrl', 'sourceMapUrlB')
      .query(),
  ),
];
