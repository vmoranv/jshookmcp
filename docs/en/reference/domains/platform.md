# Platform

Domain: `platform`

Platform and package analysis domain covering miniapps, ASAR archives, and Electron apps.

## Profiles

- full

## Typical scenarios

- Inspect miniapp packages
- Analyze Electron application structure

## Common combinations

- platform + process
- platform + core

## Representative tools

- `platform_capabilities` — Report platform tool backend availability.
- `miniapp_pkg_scan` — Scan local directories for miniapp package files.
- `miniapp_pkg_unpack` — Unpack a miniapp package.
- `miniapp_pkg_analyze` — Analyze an unpacked miniapp package.
- `asar_extract` — Extract files from an Electron ASAR archive.
- `electron_inspect_app` — Inspect an Electron app structure.
- `electron_scan_userdata` — Scan a directory for Electron JSON userdata files.
- `asar_search` — Search text inside an ASAR archive.
- `electron_check_fuses` — Read Electron fuse states.
- `electron_patch_fuses` — Patch Electron fuse states.

## Full tool list (14)

| Tool | Description |
| --- | --- |
| `platform_capabilities` | Report platform tool backend availability. |
| `miniapp_pkg_scan` | Scan local directories for miniapp package files. |
| `miniapp_pkg_unpack` | Unpack a miniapp package. |
| `miniapp_pkg_analyze` | Analyze an unpacked miniapp package. |
| `asar_extract` | Extract files from an Electron ASAR archive. |
| `electron_inspect_app` | Inspect an Electron app structure. |
| `electron_scan_userdata` | Scan a directory for Electron JSON userdata files. |
| `asar_search` | Search text inside an ASAR archive. |
| `electron_check_fuses` | Read Electron fuse states. |
| `electron_patch_fuses` | Patch Electron fuse states. |
| `v8_bytecode_decompile` | Decompile or extract strings from V8 bytecode files. |
| `electron_launch_debug` | Launch Electron with main and renderer CDP ports. |
| `electron_debug_status` | Check status of dual-CDP debug sessions launched by electron_launch_debug. |
| `electron_ipc_sniff` | Monitor Electron IPC via renderer-side hooks. |
