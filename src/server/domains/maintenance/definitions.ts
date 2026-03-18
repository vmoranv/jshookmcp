import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tokenBudgetTools: Tool[] = [
  {
    name: 'get_token_budget_stats',
    description:
      'Get current token budget usage statistics.\n\n' +
      'Returns current consumption, tool call counts, top consumers, warnings, and optimization suggestions. ' +
      'Use manual_token_cleanup when usage exceeds 20-30%.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'manual_token_cleanup',
    description:
      'Trigger token budget cleanup to free context space. ' +
      'Clears stale entries older than 5 minutes and resets counters. ' +
      'Frees 10-30% of token budget while preserving recent data.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'reset_token_budget',
    description:
      'Hard-reset all token budget counters to zero. Destructive: clears all tracking history. ' +
      'Only use when MCP session state is corrupted. Prefer manual_token_cleanup for routine cleanup.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export const extensionTools: Tool[] = [
  {
    name: 'list_extensions',
    description:
      'List all locally loaded plugins, workflows, and extension tools with their details.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'reload_extensions',
    description:
      'Reload all plugins and workflows from configured directories. ' +
      'Dynamically registers extension tools and refreshes tool list.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'browse_extension_registry',
    description:
      'Browse the remote jshookmcp extension registry to discover available plugins and workflows.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['plugin', 'workflow', 'all'],
          description: 'Filter by extension kind (default: "all")',
        },
      },
    },
  },

  {
    name: 'install_extension',
    description:
      'Install an extension from the remote registry. Clones the repo, checks out the pinned commit, ' +
      'and runs reload_extensions to activate. Requires git in PATH.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Extension slug from the registry (e.g. "ida-bridge")',
        },
        targetDir: {
          type: 'string',
          description:
            'Target directory override (optional, defaults to jshook install plugins/workflows root + slug)',
        },
      },
      required: ['slug'],
    },
  },
];

export const cacheTools: Tool[] = [
  {
    name: 'get_cache_stats',
    description:
      'Get cache statistics for all internal caches. ' +
      'Returns total entries, sizes, per-cache hit rates, TTL config, and cleanup recommendations.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'smart_cache_cleanup',
    description:
      'Intelligently clean caches to free memory while preserving hot data. ' +
      'Evicts LRU entries, removes low-hit entries, and clears entries older than 2 hours.',
    inputSchema: {
      type: 'object',
      properties: {
        targetSize: {
          type: 'number',
          description: 'Target size in bytes (optional, defaults to 70% of maximum).',
        },
      },
    },
  },

  {
    name: 'clear_all_caches',
    description:
      'Clear all internal caches completely. Destructive: all cached data will be lost. ' +
      'Prefer smart_cache_cleanup for routine maintenance.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export const artifactTools: Tool[] = [
  {
    name: 'cleanup_artifacts',
    description:
      'Clean generated artifacts, screenshots, and debugger sessions using retention rules. ' +
      'Supports age-based removal, size-based trimming, and dry-run preview.',
    inputSchema: {
      type: 'object',
      properties: {
        retentionDays: {
          type: 'number',
          description: 'Override retention window in days for this cleanup run.',
        },
        maxTotalBytes: {
          type: 'number',
          description: 'Override maximum retained bytes across managed artifact directories.',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview removals without deleting files.',
        },
      },
    },
  },
  {
    name: 'doctor_environment',
    description:
      'Run an environment doctor for optional dependencies, bridge endpoints, and platform limitations. ' +
      'Use before debugging dependency issues or after installing external integrations.',
    inputSchema: {
      type: 'object',
      properties: {
        includeBridgeHealth: {
          type: 'boolean',
          description:
            'When true, probe local native-bridge / Burp endpoints as part of the report.',
        },
      },
    },
  },
];
