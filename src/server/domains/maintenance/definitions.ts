import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

// ── Token Budget ──

export const tokenBudgetTools: Tool[] = [
  tool('get_token_budget_stats', (t) =>
    t.desc('Get token budget usage stats, warnings, and optimization suggestions').query(),
  ),
  tool('manual_token_cleanup', (t) =>
    t.desc('Clear stale entries and reset counters to free 10-30% of token budget'),
  ),
  tool('reset_token_budget', (t) =>
    t
      .desc('Hard-reset all token budget counters. Destructive — prefer manual_token_cleanup')
      .destructive(),
  ),
];

// ── Extensions ──

export const extensionTools: Tool[] = [
  tool('list_extensions', (t) =>
    t.desc('List all loaded plugins, workflows, and extension tools').query(),
  ),
  tool('reload_extensions', (t) =>
    t.desc('Reload plugins and workflows from configured directories').openWorld(),
  ),
  tool('browse_extension_registry', (t) =>
    t
      .desc('Browse the remote jshookmcp extension registry')
      .enum('kind', ['plugin', 'workflow', 'all'], 'Filter by extension kind', { default: 'all' })
      .query(),
  ),
  tool('install_extension', (t) =>
    t
      .desc('Install an extension from the remote registry via git')
      .string('slug', 'Extension slug from the registry')
      .string('targetDir', 'Target directory override')
      .requiredOpenWorld('slug'),
  ),
];

// ── Cache ──

export const cacheTools: Tool[] = [
  tool('get_cache_stats', (t) =>
    t.desc('Get cache statistics: entries, sizes, hit rates, and cleanup recommendations').query(),
  ),
  tool('smart_cache_cleanup', (t) =>
    t
      .desc('Evict LRU and stale entries while preserving hot data')
      .number('targetSize', 'Target size in bytes'),
  ),
  tool('clear_all_caches', (t) =>
    t.desc('Clear all internal caches. Destructive — prefer smart_cache_cleanup').destructive(),
  ),
];

// ── Artifacts ──

export const artifactTools: Tool[] = [
  tool('cleanup_artifacts', (t) =>
    t
      .desc('Clean generated artifacts using age and size retention rules')
      .number('retentionDays', 'Override retention window in days')
      .number('maxTotalBytes', 'Override maximum retained bytes')
      .boolean('dryRun', 'Preview removals without deleting')
      .destructive(),
  ),
  tool('doctor_environment', (t) =>
    t
      .desc('Run environment doctor for dependencies, bridge endpoints, and platform limitations')
      .boolean('includeBridgeHealth', 'Probe native-bridge / Burp endpoints')
      .readOnly(),
  ),
];
