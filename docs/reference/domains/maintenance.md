# Maintenance

域名：`maintenance`

运维与维护域，覆盖缓存、token 预算、环境诊断、产物清理与扩展管理。

## Profile

- search
- minimal
- workflow
- full

## 典型场景

- 依赖诊断
- 产物清理
- 扩展热加载

## 常见组合

- maintenance + workflow
- maintenance + extensions

## 代表工具

- `get_token_budget_stats` — Get current token budget usage statistics.
- `manual_token_cleanup` — Manually trigger token budget cleanup to free context space.
- `reset_token_budget` — Reset all token budget counters to zero (hard reset).
- `get_cache_stats` — Get cache statistics for all internal caches.
- `smart_cache_cleanup` — Intelligently clean caches to free memory while preserving hot data.
- `clear_all_caches` — Clear all internal caches completely.
- `cleanup_artifacts` — Clean generated artifacts, screenshots, and debugger sessions using retention rules.
- `doctor_environment` — Run an environment doctor for optional dependencies, bridge endpoints, and platform limitations.
- `list_extensions` — List all locally loaded plugins, workflows, and extension tools.
- `reload_extensions` — Reload all plugins and workflows from configured directories.

## 工具清单（12）

| 工具                        | 说明                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `get_token_budget_stats`    | Get current token budget usage statistics.                                                        |
| `manual_token_cleanup`      | Manually trigger token budget cleanup to free context space.                                      |
| `reset_token_budget`        | Reset all token budget counters to zero (hard reset).                                             |
| `get_cache_stats`           | Get cache statistics for all internal caches.                                                     |
| `smart_cache_cleanup`       | Intelligently clean caches to free memory while preserving hot data.                              |
| `clear_all_caches`          | Clear all internal caches completely.                                                             |
| `cleanup_artifacts`         | Clean generated artifacts, screenshots, and debugger sessions using retention rules.              |
| `doctor_environment`        | Run an environment doctor for optional dependencies, bridge endpoints, and platform limitations.  |
| `list_extensions`           | List all locally loaded plugins, workflows, and extension tools.                                  |
| `reload_extensions`         | Reload all plugins and workflows from configured directories.                                     |
| `browse_extension_registry` | Browse the remote jshookmcp extension registry to discover available plugins and workflows.       |
| `install_extension`         | Install an extension from the remote registry into the jshook installation extension directories. |
