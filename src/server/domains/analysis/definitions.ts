import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const coreTools: Tool[] = [
  {
    name: 'collect_code',
    description:
      'Collect JavaScript code from a target website. Supports summary, priority, incremental, and full collection modes.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Target website URL',
        },
        includeInline: {
          type: 'boolean',
          description: 'Include inline scripts',
          default: true,
        },
        includeExternal: {
          type: 'boolean',
          description: 'Include external scripts',
          default: true,
        },
        includeDynamic: {
          type: 'boolean',
          description: 'Include dynamically loaded scripts',
          default: false,
        },
        smartMode: {
          type: 'string',
          description: 'Collection mode',
          enum: ['summary', 'priority', 'incremental', 'full'],
          default: 'full',
        },
        compress: {
          type: 'boolean',
          description: 'Enable compression for collected content',
          default: false,
        },
        maxTotalSize: {
          type: 'number',
          description: 'Maximum total collection size in bytes',
          default: 2097152,
        },
        maxFileSize: {
          type: 'number',
          description: 'Maximum single file size in KB',
          default: 500,
        },
        priorities: {
          type: 'array',
          description: 'Preferred URL patterns for priority mode',
          items: { type: 'string' },
        },
        returnSummaryOnly: {
          type: 'boolean',
          description: 'Return summary only (legacy compatibility)',
          default: false,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'search_in_scripts',
    description: 'Search collected scripts by keyword or regex pattern.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: 'Search keyword or regex pattern',
        },
        isRegex: {
          type: 'boolean',
          description: 'Treat keyword as a regex pattern',
          default: false,
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Enable case-sensitive search',
          default: false,
        },
        contextLines: {
          type: 'number',
          description: 'Context lines before and after each match',
          default: 3,
        },
        maxMatches: {
          type: 'number',
          description: 'Maximum matches to return',
          default: 100,
        },
        returnSummary: {
          type: 'boolean',
          description: 'Return summary data instead of full match payload',
          default: false,
        },
        maxContextSize: {
          type: 'number',
          description: 'Maximum response size in bytes before summary fallback',
          default: 50000,
        },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'extract_function_tree',
    description: 'Extract a function and its dependency tree from collected scripts.',
    inputSchema: {
      type: 'object',
      properties: {
        scriptId: {
          type: 'string',
          description: 'Script identifier',
        },
        functionName: {
          type: 'string',
          description: 'Function name to extract',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum dependency traversal depth',
          default: 3,
        },
        maxSize: {
          type: 'number',
          description: 'Maximum output size in KB',
          default: 500,
        },
        includeComments: {
          type: 'boolean',
          description: 'Include comments in extracted source',
          default: true,
        },
      },
      required: ['scriptId', 'functionName'],
    },
  },
  {
    name: 'deobfuscate',
    description: 'Run LLM-assisted JavaScript deobfuscation.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Obfuscated JavaScript source',
        },
        llm: {
          type: 'string',
          enum: ['gpt-4', 'claude'],
          description: 'Preferred LLM for analysis',
          default: 'gpt-4',
        },
        aggressive: {
          type: 'boolean',
          description: 'Enable aggressive deobfuscation strategy',
          default: false,
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'understand_code',
    description: 'Run semantic code analysis for structure, behavior, and risks.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Source code to analyze',
        },
        context: {
          type: 'object',
          description: 'Additional contextual data',
        },
        focus: {
          type: 'string',
          enum: ['structure', 'business', 'security', 'all'],
          description: 'Analysis focus',
          default: 'all',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'detect_crypto',
    description: 'Detect cryptographic algorithms and usage patterns in source code.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Source code for crypto analysis',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'manage_hooks',
    description: 'Create, inspect, and clear JavaScript runtime hooks.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'records', 'clear'],
          description: 'Hook management operation',
        },
        target: {
          type: 'string',
          description: 'Hook target identifier',
        },
        type: {
          type: 'string',
          enum: ['function', 'xhr', 'fetch', 'websocket', 'localstorage', 'cookie'],
          description: 'Hook target type',
        },
        hookAction: {
          type: 'string',
          enum: ['log', 'block', 'modify'],
          description: 'Hook behavior',
          default: 'log',
        },
        customCode: {
          type: 'string',
          description: 'Custom JavaScript hook payload',
        },
        hookId: {
          type: 'string',
          description: 'Hook identifier',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'detect_obfuscation',
    description: 'Detect obfuscation techniques in JavaScript source.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Source code to inspect',
        },
        generateReport: {
          type: 'boolean',
          description: 'Include human-readable report output',
          default: true,
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'advanced_deobfuscate',
    description: 'Run advanced deobfuscation with VM-oriented strategies.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Obfuscated JavaScript source',
        },
        detectOnly: {
          type: 'boolean',
          description: 'Only detect techniques without transformation',
          default: false,
        },
        aggressiveVM: {
          type: 'boolean',
          description: 'Enable aggressive VM deobfuscation mode',
          default: false,
        },
        useASTOptimization: {
          type: 'boolean',
          description: 'Apply AST-based optimization after transformation',
          default: true,
        },
        timeout: {
          type: 'number',
          description: 'Operation timeout in milliseconds',
          default: 60000,
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'clear_collected_data',
    description: 'Clear collected script data, caches, and in-memory indexes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_collection_stats',
    description: 'Get collection, cache, and compression statistics.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  // Reclassified reverse-engineering helpers
  {
    name: 'webpack_enumerate',
    description: 'Enumerate all webpack modules in the current page and optionally search for keywords. Useful for finding hidden APIs, flags, or internal logic in bundled applications.',
    inputSchema: {
      type: 'object',
      properties: {
        searchKeyword: {
          type: 'string',
          description: 'Keyword to search across all module exports (case-insensitive). Leave empty to just list all module IDs.',
        },
        forceRequireAll: {
          type: 'boolean',
          description: 'Force-require every module (slower, but finds lazily-loaded modules). Default: true when searchKeyword provided.',
          default: false,
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of matching modules to return',
          default: 20,
        },
      },
    },
  },
  {
    name: 'source_map_extract',
    description: 'Find and parse JavaScript source maps to recover original source code. Useful for reverse engineering minified/bundled applications.',
    inputSchema: {
      type: 'object',
      properties: {
        includeContent: {
          type: 'boolean',
          description: 'Include full source file content (can be large). Default: false (only lists recovered file names).',
          default: false,
        },
        filterPath: {
          type: 'string',
          description: 'Only return source files whose path contains this string (e.g., "src/", ".tsx")',
        },
        maxFiles: {
          type: 'number',
          description: 'Maximum number of source files to return',
          default: 50,
        },
      },
    },
  },
];
