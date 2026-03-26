import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

// ── Token Budget ──

export const tokenBudgetTools: Tool[] = [
  tool('get_token_budget_stats')
    .desc('Get token budget usage stats, warnings, and optimization suggestions')
    .readOnly()
    .idempotent()
    .build(),

  tool('manual_token_cleanup')
    .desc('Clear stale entries and reset counters to free 10-30% of token budget')
    .build(),

  tool('reset_token_budget')
    .desc('Hard-reset all token budget counters. Destructive — prefer manual_token_cleanup')
    .destructive()
    .build(),
];

// ── Extensions ──

export const extensionTools: Tool[] = [
  tool('list_extensions')
    .desc('List all loaded plugins, workflows, and extension tools')
    .readOnly()
    .idempotent()
    .build(),

  tool('reload_extensions')
    .desc('Reload plugins and workflows from configured directories')
    .openWorld()
    .build(),

  tool('browse_extension_registry')
    .desc('Browse the remote jshookmcp extension registry')
    .enum('kind', ['plugin', 'workflow', 'all'], 'Filter by extension kind', { default: 'all' })
    .readOnly()
    .idempotent()
    .build(),

  tool('install_extension')
    .desc('Install an extension from the remote registry via git')
    .string('slug', 'Extension slug from the registry')
    .string('targetDir', 'Target directory override')
    .required('slug')
    .openWorld()
    .build(),
];

// ── Cache ──

export const cacheTools: Tool[] = [
  tool('get_cache_stats')
    .desc('Get cache statistics: entries, sizes, hit rates, and cleanup recommendations')
    .readOnly()
    .idempotent()
    .build(),

  tool('smart_cache_cleanup')
    .desc('Evict LRU and stale entries while preserving hot data')
    .number('targetSize', 'Target size in bytes')
    .build(),

  tool('clear_all_caches')
    .desc('Clear all internal caches. Destructive — prefer smart_cache_cleanup')
    .destructive()
    .build(),
];

// ── Artifacts ──

export const artifactTools: Tool[] = [
  tool('cleanup_artifacts')
    .desc('Clean generated artifacts using age and size retention rules')
    .number('retentionDays', 'Override retention window in days')
    .number('maxTotalBytes', 'Override maximum retained bytes')
    .boolean('dryRun', 'Preview removals without deleting')
    .destructive()
    .build(),

  tool('doctor_environment')
    .desc('Run environment doctor for dependencies, bridge endpoints, and platform limitations')
    .boolean('includeBridgeHealth', 'Probe native-bridge / Burp endpoints')
    .readOnly()
    .build(),
];
