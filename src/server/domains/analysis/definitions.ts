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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'deobfuscate',
    description: 'Run webcrack-powered JavaScript deobfuscation with bundle unpacking support.',
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
        unpack: {
          type: 'boolean',
          description: 'Use webcrack to unpack webpack/browserify bundles when possible',
          default: true,
        },
        unminify: {
          type: 'boolean',
          description: 'Use webcrack to reformat and unminify code before post-processing',
          default: true,
        },
        jsx: {
          type: 'boolean',
          description:
            'Ask webcrack to decompile React.createElement trees back to JSX when supported',
          default: true,
        },
        mangle: {
          type: 'boolean',
          description: 'Rename obfuscated identifiers using webcrack mangle pass',
          default: false,
        },
        outputDir: {
          type: 'string',
          description:
            'Optional directory where webcrack should save the deobfuscated code and extracted bundle',
        },
        forceOutput: {
          type: 'boolean',
          description: 'Remove outputDir before saving webcrack artifacts',
          default: false,
        },
        includeModuleCode: {
          type: 'boolean',
          description:
            'Include unpacked module source in bundle output when returning bundle details',
          default: false,
        },
        maxBundleModules: {
          type: 'number',
          description: 'Maximum number of bundle modules to return in the response',
          default: 100,
        },
        mappings: {
          type: 'array',
          description:
            'Optional remapping rules applied to unpacked bundle module paths. Each rule can match against module code or current path.',
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'New module path to assign when the rule matches',
              },
              pattern: {
                type: 'string',
                description: 'Text or regex used to match module code/path',
              },
              matchType: {
                type: 'string',
                enum: ['includes', 'regex', 'exact'],
                description: 'How to interpret pattern',
                default: 'includes',
              },
              target: {
                type: 'string',
                enum: ['code', 'path'],
                description:
                  'Whether to match against module source code or the current module path',
                default: 'code',
              },
            },
            required: ['path', 'pattern'],
          },
        },
      },
      required: ['code'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
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
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'advanced_deobfuscate',
    description:
      'Run advanced deobfuscation with webcrack backend (deprecated legacy flags ignored).',
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
        unpack: {
          type: 'boolean',
          description: 'Use webcrack to unpack webpack/browserify bundles before advanced cleanup',
          default: true,
        },
        unminify: {
          type: 'boolean',
          description: 'Use webcrack unminify pass before VM and AST-oriented cleanup',
          default: true,
        },
        jsx: {
          type: 'boolean',
          description: 'Allow webcrack to decompile React.createElement back to JSX when supported',
          default: true,
        },
        mangle: {
          type: 'boolean',
          description: 'Rename obfuscated identifiers during the webcrack phase',
          default: false,
        },
        outputDir: {
          type: 'string',
          description:
            'Optional directory where webcrack should save the deobfuscated code and extracted bundle',
        },
        forceOutput: {
          type: 'boolean',
          description: 'Remove outputDir before saving webcrack artifacts',
          default: false,
        },
        includeModuleCode: {
          type: 'boolean',
          description:
            'Include unpacked module source in bundle output when returning bundle details',
          default: false,
        },
        maxBundleModules: {
          type: 'number',
          description: 'Maximum number of bundle modules to return in the response',
          default: 100,
        },
        mappings: {
          type: 'array',
          description:
            'Optional remapping rules applied to unpacked bundle module paths. Each rule can match against module code or current path.',
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'New module path to assign when the rule matches',
              },
              pattern: {
                type: 'string',
                description: 'Text or regex used to match module code/path',
              },
              matchType: {
                type: 'string',
                enum: ['includes', 'regex', 'exact'],
                description: 'How to interpret pattern',
                default: 'includes',
              },
              target: {
                type: 'string',
                enum: ['code', 'path'],
                description:
                  'Whether to match against module source code or the current module path',
                default: 'code',
              },
            },
            required: ['path', 'pattern'],
          },
        },
      },
      required: ['code'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'webcrack_unpack',
    description:
      'Run webcrack bundle unpacking directly and return extracted module graph details.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'Bundled or obfuscated JavaScript source',
        },
        unpack: {
          type: 'boolean',
          description: 'Extract modules from the bundle when supported',
          default: true,
        },
        unminify: {
          type: 'boolean',
          description: 'Unminify the code before extracting bundle modules',
          default: true,
        },
        jsx: {
          type: 'boolean',
          description: 'Decompile React.createElement trees back to JSX when supported',
          default: true,
        },
        mangle: {
          type: 'boolean',
          description: 'Rename obfuscated identifiers during the webcrack pass',
          default: false,
        },
        outputDir: {
          type: 'string',
          description: 'Optional directory where webcrack should save the extracted bundle files',
        },
        forceOutput: {
          type: 'boolean',
          description: 'Remove outputDir before saving webcrack artifacts',
          default: false,
        },
        includeModuleCode: {
          type: 'boolean',
          description: 'Include unpacked module source in bundle output',
          default: false,
        },
        maxBundleModules: {
          type: 'number',
          description: 'Maximum number of bundle modules to return in the response',
          default: 100,
        },
        mappings: {
          type: 'array',
          description:
            'Optional remapping rules applied to unpacked bundle module paths. Each rule can match against module code or current path.',
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'New module path to assign when the rule matches',
              },
              pattern: {
                type: 'string',
                description: 'Text or regex used to match module code/path',
              },
              matchType: {
                type: 'string',
                enum: ['includes', 'regex', 'exact'],
                description: 'How to interpret pattern',
                default: 'includes',
              },
              target: {
                type: 'string',
                enum: ['code', 'path'],
                description:
                  'Whether to match against module source code or the current module path',
                default: 'code',
              },
            },
            required: ['path', 'pattern'],
          },
        },
      },
      required: ['code'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'clear_collected_data',
    description: 'Clear collected script data, caches, and in-memory indexes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'get_collection_stats',
    description: 'Get collection, cache, and compression statistics.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  // Reclassified analysis helpers
  {
    name: 'webpack_enumerate',
    description:
      'Enumerate all webpack modules in the current page and optionally search for keywords. Useful for finding hidden APIs, flags, or internal logic in bundled applications.',
    inputSchema: {
      type: 'object',
      properties: {
        searchKeyword: {
          type: 'string',
          description:
            'Keyword to search across all module exports (case-insensitive). Leave empty to just list all module IDs.',
        },
        forceRequireAll: {
          type: 'boolean',
          description:
            'Force-require every module (slower, but finds lazily-loaded modules). Default: true when searchKeyword provided.',
          default: false,
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of matching modules to return',
          default: 20,
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'source_map_extract',
    description:
      'Find and parse JavaScript source maps to recover original source code. Useful for analyzing minified or bundled applications.',
    inputSchema: {
      type: 'object',
      properties: {
        includeContent: {
          type: 'boolean',
          description:
            'Include full source file content (can be large). Default: false (only lists recovered file names).',
          default: false,
        },
        filterPath: {
          type: 'string',
          description:
            'Only return source files whose path contains this string (e.g., "src/", ".tsx")',
        },
        maxFiles: {
          type: 'number',
          description: 'Maximum number of source files to return',
          default: 50,
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];
