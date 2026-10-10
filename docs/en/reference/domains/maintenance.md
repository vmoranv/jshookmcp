# Maintenance

Domain: `maintenance`

Operations and maintenance domain covering cache hygiene, token budget, environment diagnostics, artifact cleanup, extension management, and secure sandbox execution.

## Profiles

- workflow
- full

## Typical scenarios

- Diagnose dependencies
- Clean retained artifacts
- Reload plugins and workflows
- Execute custom scripts in a secure sandbox

## Common combinations

- maintenance + workflow
- maintenance + extensions

## Full tool list (17)

| Tool | Description |
| --- | --- |
| `get_token_budget_stats` | Get token budget usage stats, warnings, and optimization suggestions. |
| `manual_token_cleanup` | Clear stale entries and reset counters to free 10-30% of token budget. |
| `reset_token_budget` | Hard-reset all token budget counters. Destructive — prefer manual_token_cleanup. |
| `get_cache_stats` | Get cache statistics: entries, sizes, hit rates, and cleanup recommendations. |
| `smart_cache_cleanup` | Evict LRU and stale entries while preserving hot data. |
| `clear_all_caches` | Clear all internal caches. Destructive — prefer smart_cache_cleanup. |
| `cleanup_artifacts` | Clean generated artifacts by age and size. |
| `doctor_environment` | Run environment doctor: dependencies, bridges, platform limits. |
| `maintenance_detect_gpu` | Detect GPU family from WebGL/WebGPU renderer strings. Classifies into NVIDIA, AMD, Intel, Apple, Mali, Adreno, PowerVR, Vivante, Broadcom, Qualcomm, Microsoft. Pure-TS classifier — no browser needed. Provide at least one of webglRenderer, webgpuDescription, or deviceName. |
| `snapshot_create` | Create a shadow-git snapshot of a scan-artifact directory (artifacts, HAR, screenshots, debugger-sessions, ...) so it can be rolled back later. Uses an ISOLATED git object store outside the target directory — the project .git is never touched and no git commit is made. The store keeps full file contents, so snapshots can grow large; snapshot output directories, not source trees. |
| `snapshot_list` | List shadow-git snapshots recorded for a directory, newest first. |
| `snapshot_restore` | Restore a directory to a recorded shadow-git snapshot. DESTRUCTIVE: files modified after the snapshot are overwritten, files created after it are DELETED, and files deleted after it are written back (full revert semantics). The isolated store never touches the project .git. Create a fresh snapshot_create first if you may need the current state. |
| `list_extensions` | List all loaded plugins, workflows, and extension tools. |
| `reload_extensions` | Reload plugins and workflows from configured directories, and directly register extension tools visible in the current profile. The response includes capabilityFixed — tools that only became available through this reload (previously blocked on a missing plugin). |
| `browse_extension_registry` | Browse the online extension registry for installable plugins and workflows. |
| `install_extension` | Install an extension from the remote registry. |
| `execute_sandbox_script` | Execute JavaScript in an isolated sandbox. |
