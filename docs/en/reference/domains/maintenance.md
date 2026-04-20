# Maintenance

Domain: `maintenance`

Operations and maintenance domain covering cache hygiene, token budget, environment diagnostics, artifact cleanup, and extension management.

## Profiles

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

- `get_token_budget_stats` — Get token budget usage stats, warnings, and optimization suggestions
- `manual_token_cleanup` — Clear stale entries and reset counters to free 10-30% of token budget
- `reset_token_budget` — Hard-reset all token budget counters. Destructive — prefer manual_token_cleanup
- `get_cache_stats` — Get cache statistics: entries, sizes, hit rates, and cleanup recommendations
- `smart_cache_cleanup` — Evict LRU and stale entries while preserving hot data
- `clear_all_caches` — Clear all internal caches. Destructive — prefer smart_cache_cleanup
- `cleanup_artifacts` — Clean generated artifacts using age and size retention rules
- `doctor_environment` — Run environment doctor for dependencies, bridge endpoints, and platform limitations
- `list_extensions` — List all loaded plugins, workflows, and extension tools
- `reload_extensions` — Reload plugins and workflows from configured directories

## Full tool list (12)

| Tool | Description |
| --- | --- |
| `get_token_budget_stats` | Get token budget usage stats, warnings, and optimization suggestions |
| `manual_token_cleanup` | Clear stale entries and reset counters to free 10-30% of token budget |
| `reset_token_budget` | Hard-reset all token budget counters. Destructive — prefer manual_token_cleanup |
| `get_cache_stats` | Get cache statistics: entries, sizes, hit rates, and cleanup recommendations |
| `smart_cache_cleanup` | Evict LRU and stale entries while preserving hot data |
| `clear_all_caches` | Clear all internal caches. Destructive — prefer smart_cache_cleanup |
| `cleanup_artifacts` | Clean generated artifacts using age and size retention rules |
| `doctor_environment` | Run environment doctor for dependencies, bridge endpoints, and platform limitations |
| `list_extensions` | List all loaded plugins, workflows, and extension tools |
| `reload_extensions` | Reload plugins and workflows from configured directories |
| `browse_extension_registry` | Browse the remote jshookmcp extension registry |
| `install_extension` | Install an extension from the remote registry via git |
