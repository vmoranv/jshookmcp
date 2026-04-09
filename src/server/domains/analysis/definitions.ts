import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool, type ToolBuilder } from '@server/registry/tool-builder';

// Shared schema for webcrack mappings
const webcrackMappingsSchema = {
  type: 'array' as const,
  description: 'Remapping rules for unpacked bundle module paths',
  items: {
    type: 'object' as const,
    properties: {
      path: { type: 'string' as const, description: 'New module path when matched' },
      pattern: { type: 'string' as const, description: 'Match text or regex' },
      matchType: {
        type: 'string' as const,
        enum: ['includes', 'regex', 'exact'],
        description: 'How to interpret pattern',
        default: 'includes',
      },
      target: {
        type: 'string' as const,
        enum: ['code', 'path'],
        description: 'Match against source code or module path',
        default: 'code',
      },
    },
    required: ['path', 'pattern'],
  },
};

/** Shared webcrack options added to a builder */
function withWebcrackOpts(b: ToolBuilder) {
  return b
    .boolean('unpack', 'Unpack webpack/browserify bundles', { default: true })
    .boolean('unminify', 'Reformat and unminify code', { default: true })
    .boolean('jsx', 'Decompile React.createElement to JSX', { default: true })
    .boolean('mangle', 'Rename obfuscated identifiers', { default: false })
    .string('outputDir', 'Directory to save deobfuscated artifacts')
    .boolean('forceOutput', 'Remove outputDir before saving', { default: false })
    .boolean('includeModuleCode', 'Include module source in bundle output', { default: false })
    .number('maxBundleModules', 'Maximum bundle modules to return', { default: 100 })
    .prop('mappings', webcrackMappingsSchema);
}

export const coreTools: Tool[] = [
  tool('collect_code', (t) =>
    t
      .desc(
        'Collect JavaScript from a target website in summary, priority, incremental, or full mode',
      )
      .string('url', 'Target website URL')
      .boolean('includeInline', 'Include inline scripts', { default: true })
      .boolean('includeExternal', 'Include external scripts', { default: true })
      .boolean('includeDynamic', 'Include dynamically loaded scripts', { default: false })
      .enum('smartMode', ['summary', 'priority', 'incremental', 'full'], 'Collection mode', {
        default: 'full',
      })
      .boolean('compress', 'Enable compression', { default: false })
      .number('maxTotalSize', 'Maximum total size in bytes', { default: 2097152 })
      .number('maxFileSize', 'Maximum single file size in KB', { default: 500 })
      .array('priorities', { type: 'string' }, 'Preferred URL patterns for priority mode')
      .boolean('returnSummaryOnly', 'Return summary only', { default: false })
      .requiredOpenWorld('url'),
  ),
  tool('search_in_scripts', (t) =>
    t
      .desc('Search collected scripts by keyword or regex pattern')
      .string('keyword', 'Search keyword or regex pattern')
      .boolean('isRegex', 'Treat keyword as regex', { default: false })
      .boolean('caseSensitive', 'Case-sensitive search', { default: false })
      .number('contextLines', 'Context lines around each match', { default: 3 })
      .number('maxMatches', 'Maximum matches', { default: 100 })
      .boolean('returnSummary', 'Return summary instead of full payload', { default: false })
      .number('maxContextSize', 'Max response size before summary fallback', { default: 50000 })
      .required('keyword')
      .query(),
  ),
  tool('extract_function_tree', (t) =>
    t
      .desc('Extract a function and its dependency tree from collected scripts')
      .string('scriptId', 'Script identifier')
      .string('functionName', 'Function name to extract')
      .number('maxDepth', 'Maximum dependency traversal depth', { default: 3 })
      .number('maxSize', 'Maximum output size in KB', { default: 500 })
      .boolean('includeComments', 'Include comments in extracted source', { default: true })
      .required('scriptId', 'functionName'),
  ),
  tool('deobfuscate', (t) =>
    withWebcrackOpts(
      t
        .desc('Run webcrack-powered JavaScript deobfuscation with bundle unpacking')
        .string('code', 'Obfuscated JavaScript source')
        .enum('llm', ['gpt-4', 'claude'], 'Preferred LLM for analysis', { default: 'gpt-4' })
        .boolean('aggressive', 'Aggressive deobfuscation strategy', { default: false }),
    ).required('code'),
  ),
  tool('understand_code', (t) =>
    t
      .desc('Run semantic code analysis for structure, behavior, and risks')
      .string('code', 'Source code to analyze')
      .prop('context', { type: 'object', description: 'Additional contextual data' })
      .enum('focus', ['structure', 'business', 'security', 'all'], 'Analysis focus', {
        default: 'all',
      })
      .required('code'),
  ),
  tool('detect_crypto', (t) =>
    t
      .desc('Detect cryptographic algorithms and usage patterns in source code')
      .string('code', 'Source code for crypto analysis')
      .required('code')
      .query(),
  ),
  tool('manage_hooks', (t) =>
    t
      .desc('Create, inspect, and clear JavaScript runtime hooks')
      .enum('action', ['create', 'list', 'records', 'clear'], 'Hook management operation')
      .string('target', 'Hook target identifier')
      .enum(
        'type',
        ['function', 'xhr', 'fetch', 'websocket', 'localstorage', 'cookie'],
        'Hook target type',
      )
      .enum('hookAction', ['log', 'block', 'modify'], 'Hook behavior', { default: 'log' })
      .string('customCode', 'Custom JavaScript hook payload')
      .string('hookId', 'Hook identifier')
      .requiredOpenWorld('action'),
  ),
  tool('detect_obfuscation', (t) =>
    t
      .desc('Detect obfuscation techniques in JavaScript source')
      .string('code', 'Source code to inspect')
      .boolean('generateReport', 'Include human-readable report', { default: true })
      .required('code')
      .query(),
  ),
  tool('advanced_deobfuscate', (t) =>
    withWebcrackOpts(
      t
        .desc('Advanced deobfuscation with webcrack backend')
        .string('code', 'Obfuscated JavaScript source')
        .boolean('detectOnly', 'Detect only without transformation', { default: false })
        .boolean('aggressiveVM', 'Aggressive VM deobfuscation', { default: false })
        .boolean('useASTOptimization', 'Apply AST optimization after transformation', {
          default: true,
        })
        .number('timeout', 'Operation timeout in ms', { default: 60000 }),
    ).required('code'),
  ),
  tool('webcrack_unpack', (t) =>
    withWebcrackOpts(
      t
        .desc('Run webcrack bundle unpacking and return extracted module graph')
        .string('code', 'Bundled or obfuscated JavaScript source'),
    ).required('code'),
  ),
  tool('clear_collected_data', (t) =>
    t.desc('Clear collected script data, caches, and in-memory indexes').destructive(),
  ),
  tool('get_collection_stats', (t) =>
    t.desc('Get collection, cache, and compression statistics').query(),
  ),
  tool('webpack_enumerate', (t) =>
    t
      .desc('Enumerate webpack modules in current page and search for keywords')
      .string('searchKeyword', 'Keyword to search across module exports')
      .boolean('forceRequireAll', 'Force-require every module', { default: false })
      .number('maxResults', 'Maximum matching modules', { default: 20 })
      .openWorld(),
  ),
  tool('source_map_extract', (t) =>
    t
      .desc('Find and parse JavaScript source maps to recover original source code')
      .boolean('includeContent', 'Include full source file content', { default: false })
      .string('filterPath', 'Filter by path substring')
      .number('maxFiles', 'Maximum source files', { default: 50 })
      .query(),
  ),
];
