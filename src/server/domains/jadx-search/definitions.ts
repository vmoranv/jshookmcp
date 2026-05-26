import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

/**
 * Tool definitions for the jadx-search domain.
 *
 * `jadx_search_code` performs a read-only, ripgrep-backed (with Node
 * fallback) search across an *existing* jadx decompile directory. The
 * tool does NOT trigger a new decompilation — callers should use the
 * `binary-instrument` domain's jadx tools first to produce sources.
 *
 * @see openspec/changes/add-jadx-search-code/proposal.md
 */
export const jadxSearchTools: Tool[] = [
  tool('jadx_search_code', (t) =>
    t
      .desc(
        'Read-only ripgrep-backed search over an existing jadx decompile ' +
          'directory. ReDoS-guarded; Node fallback.',
      )
      .string(
        'decompileDir',
        'Absolute path to an existing jadx decompile output directory. The tool does ' +
          'not decompile — run jadx via the binary-instrument domain first.',
      )
      .string('query', 'Search query (regex unless `literal:true`)')
      .boolean('literal', 'Treat `query` as a literal string, not a regex', { default: false })
      .boolean('caseInsensitive', 'Case-insensitive matching', { default: false })
      .integer('contextLines', 'Lines of context around each match', {
        default: 2,
        minimum: 0,
        maximum: 20,
      })
      .integer('maxMatchesPerFile', 'Cap on matches recorded per file', { minimum: 1 })
      .integer('maxResults', 'Hard ceiling on total matches across all files', { minimum: 1 })
      .array(
        'globs',
        { type: 'string', description: 'Glob pattern (negative globs may start with !)' },
        'File globs applied during enumeration. Defaults to `**/*.java`, `**/*.kt`.',
      )
      .required('decompileDir', 'query')
      .query(),
  ),
];
