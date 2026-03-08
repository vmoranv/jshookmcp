import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tokenBudgetTools: Tool[] = [
  {
    name: 'get_token_budget_stats',
    description: `Get current token budget usage statistics.

Returns:
- Current token consumption estimate
- Tool call counts and top token consumers
- Active warnings and optimization suggestions

When to use:
- After sessions with many large scripts (>10K tokens each)
- When responses feel slow or context seems full
- Before running AI analysis tools
- When approaching MCP context limits

Tip: Use manual_token_cleanup when usage exceeds 20-30%.

Response fields:
- currentUsage: estimated token count (approximate)
- maxTokens: context limit (200K)
- usagePercentage: utilization ratio
- toolCallCount: number of tool invocations
- topTools: highest token-consuming tools
- warnings: active threshold alerts
- recentCalls: recent tool activity
- suggestions: recommended actions

Example:
\`\`\`
get_token_budget_stats()
-> Returns current token budget report
\`\`\``,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'manual_token_cleanup',
    description: `Manually trigger token budget cleanup to free context space.

Actions performed:
- Clears DetailedDataManager stale entries
- Removes entries older than 5 minutes
- Resets internal token counters

When to use:
- Token usage exceeds 90%
- Context feels sluggish or slow
- Before a long analysis session

Effect:
- Frees 10-30% of token budget
- Preserves recent data
- Does not affect page state

Response fields:
- before: usage before cleanup
- after: usage after cleanup
- freed: tokens freed

Example:
\`\`\`
manual_token_cleanup()
-> Triggers cleanup, frees token budget
\`\`\``,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'reset_token_budget',
    description: `Reset all token budget counters to zero (hard reset).

Actions performed:
- Resets token counter to 0
- Clears all tool call history
- Resets all warning thresholds

Warning:
- This is a destructive operation
- All token tracking history will be lost
- Running analysis tasks will be interrupted

When to use:
- Starting a completely new analysis session
- After a token budget anomaly
- Periodic maintenance reset

Prefer manual_token_cleanup for routine cleanup. Only use reset_token_budget when MCP session state is corrupted.

Example:
\`\`\`
reset_token_budget()
-> Resets all token budget counters
\`\`\``,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export const extensionTools: Tool[] = [
  {
    name: 'list_extensions',
    description: `List all locally loaded plugins, workflows, and extension tools.

Returns:
- Plugin roots and workflow roots being scanned
- Loaded plugin count, workflow count, tool count
- Per-plugin details (id, name, source, contributed domains/tools)
- Per-workflow details (id, display name, source)

When to use:
- Check which extensions are currently active
- Verify a plugin loaded successfully after reload
- Inspect which tools an extension contributed

Example:
\`\`\`
list_extensions()
-> Returns loaded plugins, workflows, and their tools
\`\`\``,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'reload_extensions',
    description: `Reload all plugins and workflows from configured directories.

Actions performed:
- Unloads all currently loaded extension tools
- Re-scans plugin roots (MCP_PLUGIN_ROOTS or <jshook-install>/plugins)
- Re-scans workflow roots (MCP_WORKFLOW_ROOTS or <jshook-install>/workflows)
- Validates, loads, and activates discovered plugins
- Registers contributed tools and workflows

Returns:
- Added/removed tool counts
- Loaded plugins and workflows list
- Any warnings or errors encountered

When to use:
- After installing a new extension
- After modifying a plugin's manifest
- To hot-reload plugins without restarting the server

Example:
\`\`\`
reload_extensions()
-> Reloads all extensions, returns summary
\`\`\``,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'browse_extension_registry',
    description: `Browse the remote jshookmcp extension registry to discover available plugins and workflows.

Fetches the latest plugin and workflow indices from the official registry (github.com/vmoranv/jshookmcpextension).

Parameters:
- kind: Filter by "plugin", "workflow", or "all" (default: "all")

Returns:
- Available plugins with id, name, description, author, repo URL
- Available workflows with id, name, description, author, repo URL
- Source commit hash for reproducible installs

When to use:
- Discover what extensions are available
- Find a plugin for a specific integration (Burp, Frida, IDA, etc.)
- Check if a newer version of an extension exists

Example:
\`\`\`
browse_extension_registry({ kind: "plugin" })
-> Returns all available plugins from the registry
\`\`\``,
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
    description: `Install an extension from the remote registry into the jshook installation extension directories.

Clones the extension repository and checks out the pinned commit from the registry.

Parameters:
- slug: Extension slug from the registry (e.g. "ida-bridge", "frida-bridge")
- targetDir: Target directory override (optional). By default:
  - plugin -> <jshook-install>/plugins/<slug>
  - workflow -> <jshook-install>/workflows/<slug>

Actions performed:
1. Fetches the registry index to resolve the extension
2. Clones the extension repo to the target directory
3. Checks out the pinned commit for reproducibility
4. Runs reload_extensions to activate the new plugin

Requires: git available in PATH.

When to use:
- Install a new plugin from the registry
- Set up a bridge integration (Burp, Frida, IDA, Ghidra, Jadx, ZAP)

Example:
\`\`\`
install_extension({ slug: "ida-bridge" })
-> Clones and installs the IDA bridge plugin
\`\`\``,
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Extension slug from the registry (e.g. "ida-bridge")',
        },
        targetDir: {
          type: 'string',
          description: 'Target directory override (optional, defaults to jshook install plugins/workflows root + slug)',
        },
      },
      required: ['slug'],
    },
  },
];

export const cacheTools: Tool[] = [
  {
    name: 'get_cache_stats',
    description: `Get cache statistics for all internal caches.

Returns information about:
- Total entries and size across all caches
- Per-cache hit rates and TTL configuration
- Actionable cleanup recommendations

Response fields:
- totalEntries: total cached items
- totalSize: total size in bytes
- totalSizeMB: total size in MB
- hitRate: overall cache hit ratio
- caches: per-cache breakdown
  - name: cache name
  - entries: item count
  - size: size in bytes
  - sizeMB: size in MB
  - hitRate: hit ratio
  - ttl: time-to-live in ms
- recommendations: suggested actions

Example:
\`\`\`typescript
get_cache_stats()
{
  "totalEntries": 150,
  "totalSize": 52428800,
  "totalSizeMB": "50.00",
  "hitRate": 0.75,
  "caches": [
    {
      "name": "DetailedDataManager",
      "entries": 50,
      "size": 2621440,
      "sizeMB": "2.50",
      "hitRate": 0.8,
      "ttl": 600000
    },
    {
      "name": "CodeCache",
      "entries": 80,
      "size": 41943040,
      "sizeMB": "40.00",
      "hitRate": 0.7
    },
    {
      "name": "CodeCompressor",
      "entries": 20,
      "size": 7864320,
      "sizeMB": "7.50",
      "hitRate": 0.75
    }
  ],
  "recommendations": [
    "Cache health is good. No action needed."
  ]
}
\`\`\``,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'smart_cache_cleanup',
    description: `Intelligently clean caches to free memory while preserving hot data.

Cleanup strategy:
1. Evicts least-recently-used entries first
2. Removes entries below hit threshold (< average * 30%)
3. Clears entries older than 2 hours

Parameter:
- targetSize: target size in bytes (optional)
  - Default: 70% of maximum (350MB)
  - Automatic: triggered when usage > 70%

Response fields:
- before: size before cleanup (bytes)
- after: size after cleanup (bytes)
- freed: bytes freed
- freedPercentage: percentage reduction

When to use:
- Cache usage > 70%
- Token usage > 80%
- Before a memory-intensive analysis

Example:
\`\`\`typescript
smart_cache_cleanup()
{
  "before": 419430400,
  "after": 314572800,
  "freed": 104857600,
  "freedPercentage": 21
}
\`\`\``,
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
    description: `Clear all internal caches completely.

Actions performed:
- Clears all cached code scripts
- Resets all hit rate counters
- Frees all allocated cache memory

Warning: This is a destructive operation. All cached data will be lost:
- DetailedDataManager (hook capture data)
- CodeCache (collected scripts)
- CodeCompressor (compressed code)

When to use:
- Starting a completely fresh session
- After cache corruption
- When memory usage is critically high
- Periodic maintenance

Prefer smart_cache_cleanup for routine maintenance to preserve hot data.

Example:
\`\`\`typescript
clear_all_caches()
{
  "success": true,
  "message": "All caches cleared"
}
\`\`\``,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export const artifactTools: Tool[] = [
  {
    name: 'cleanup_artifacts',
    description: `Clean generated artifacts, screenshots, and debugger sessions using retention rules.

Supports:
- Age-based removal via retentionDays
- Size-based trimming via maxTotalBytes
- Dry-run mode for safe preview

Default directories:
- artifacts/
- screenshots/
- debugger-sessions/

Environment defaults:
- MCP_ARTIFACT_RETENTION_DAYS
- MCP_ARTIFACT_MAX_TOTAL_MB
- MCP_ARTIFACT_CLEANUP_ON_START
- MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES

Example:
\`\`\`typescript
cleanup_artifacts({ retentionDays: 7, dryRun: true })
\`\`\``,
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
          default: false,
        },
      },
    },
  },
  {
    name: 'doctor_environment',
    description: `Run an environment doctor for optional dependencies, bridge endpoints, and platform limitations.

Checks:
- Installed optional packages (camoufox-js, playwright-core)
- External toolchain availability (wabt, binaryen, jadx, etc.)
- Native bridge health (Ghidra / IDA / Burp)
- Active security and artifact-retention configuration
- Platform limitations for Windows-only memory tooling

Use this before debugging dependency issues or after installing external integrations.

Example:
\`\`\`typescript
doctor_environment({ includeBridgeHealth: true })
\`\`\``,
    inputSchema: {
      type: 'object',
      properties: {
        includeBridgeHealth: {
          type: 'boolean',
          description: 'When true, probe local native-bridge / Burp endpoints as part of the report.',
          default: true,
        },
      },
    },
  },
];
