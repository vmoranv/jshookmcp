# V8 Inspector

Domain: `v8-inspector`

V8 inspector domain providing heap snapshot analysis, CPU profiling, and memory inspection.

## Profiles

- workflow
- full

## Typical scenarios

- Heap snapshot analysis
- CPU profiling
- Memory leak detection

## Common combinations

- v8-inspector + browser
- v8-inspector + debugger

## Full tool list (8)

| Tool | Description |
| --- | --- |
| `v8_heap_snapshot_capture` | Capture a V8 heap snapshot for offline analysis. |
| `v8_heap_snapshot_analyze` | Analyze a heap snapshot: retained size, constructor distribution, dominators. |
| `v8_heap_diff` | Compare two heap snapshots to find allocation changes. |
| `v8_object_inspect` | Inspect a live JS object by objectId with property enumeration. |
| `v8_heap_stats` | Report V8 heap statistics: used, total, external. |
| `v8_bytecode_extract` | Extract V8 bytecode for a script by scriptId, with source fallback. |
| `v8_version_detect` | Detect V8 engine version, flags, and runtime capabilities. |
| `v8_jit_inspect` | Report JIT compilation status and optimization tier for a script. |
