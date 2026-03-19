# Maintenance

Domain: `maintenance`

Operations and maintenance domain covering cache hygiene, token budget, environment diagnostics, artifact cleanup, and extension management.

## Profiles

- search
- workflow
- full

## Typical scenarios

- Diagnose dependencies
- Clean retained artifacts
- Reload plugins and workflows

## Common combinations

- maintenance + workflow
- maintenance + extensions

## Representative tools

- `get_token_budget_stats` — Get current token budget usage statistics.
- `manual_token_cleanup` — Trigger token budget cleanup to free context space. Clears stale entries older than 5 minutes and resets counters. Frees 10-30% of token budget while preserving recent data.
- `reset_token_budget` — Hard-reset all token budget counters to zero. Destructive: clears all tracking history. Only use when MCP session state is corrupted. Prefer manual_token_cleanup for routine cleanup.
- `get_cache_stats` — Get cache statistics for all internal caches. Returns total entries, sizes, per-cache hit rates, TTL config, and cleanup recommendations.
- `smart_cache_cleanup` — Intelligently clean caches to free memory while preserving hot data. Evicts LRU entries, removes low-hit entries, and clears entries older than 2 hours.
- `clear_all_caches` — Clear all internal caches completely. Destructive: all cached data will be lost. Prefer smart_cache_cleanup for routine maintenance.
- `cleanup_artifacts` — Clean generated artifacts, screenshots, and debugger sessions using retention rules. Supports age-based removal, size-based trimming, and dry-run preview.
- `doctor_environment` — Run an environment doctor for optional dependencies, bridge endpoints, and platform limitations. Use before debugging dependency issues or after installing external integrations.
- `list_extensions` — List all locally loaded plugins, workflows, and extension tools with their details.
- `reload_extensions` — Reload all plugins and workflows from configured directories. Dynamically registers extension tools and refreshes tool list.

## Full tool list (12)

| Tool                        | Description                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_token_budget_stats`    | Get current token budget usage statistics.                                                                                                                                             |
| `manual_token_cleanup`      | Trigger token budget cleanup to free context space. Clears stale entries older than 5 minutes and resets counters. Frees 10-30% of token budget while preserving recent data.          |
| `reset_token_budget`        | Hard-reset all token budget counters to zero. Destructive: clears all tracking history. Only use when MCP session state is corrupted. Prefer manual_token_cleanup for routine cleanup. |
| `get_cache_stats`           | Get cache statistics for all internal caches. Returns total entries, sizes, per-cache hit rates, TTL config, and cleanup recommendations.                                              |
| `smart_cache_cleanup`       | Intelligently clean caches to free memory while preserving hot data. Evicts LRU entries, removes low-hit entries, and clears entries older than 2 hours.                               |
| `clear_all_caches`          | Clear all internal caches completely. Destructive: all cached data will be lost. Prefer smart_cache_cleanup for routine maintenance.                                                   |
| `cleanup_artifacts`         | Clean generated artifacts, screenshots, and debugger sessions using retention rules. Supports age-based removal, size-based trimming, and dry-run preview.                             |
| `doctor_environment`        | Run an environment doctor for optional dependencies, bridge endpoints, and platform limitations. Use before debugging dependency issues or after installing external integrations.     |
| `list_extensions`           | List all locally loaded plugins, workflows, and extension tools with their details.                                                                                                    |
| `reload_extensions`         | Reload all plugins and workflows from configured directories. Dynamically registers extension tools and refreshes tool list.                                                           |
| `browse_extension_registry` | Browse the remote jshookmcp extension registry to discover available plugins and workflows.                                                                                            |
| `install_extension`         | Install an extension from the remote registry. Clones the repo, checks out the pinned commit, and runs reload_extensions to activate. Requires git in PATH.                            |
