# V8 Inspector

Domain: `v8-inspector`

V8 inspector domain providing heap snapshot analysis, CPU profiling, and memory inspection.

## Profiles

- full

## Typical scenarios

- Heap snapshot analysis
- CPU profiling
- Memory leak detection

## Common combinations

- v8-inspector + browser
- v8-inspector + debugger

## Representative tools

- `v8_heap_snapshot_capture` — Capture a V8 heap snapshot from the active browser target
- `v8_heap_snapshot_analyze` — Analyze a previously captured V8 heap snapshot
- `v8_heap_diff` — Diff two captured V8 heap snapshots
- `v8_object_inspect` — Inspect a V8 heap object by address
- `v8_heap_stats` — Return V8 heap snapshot statistics
- `v8_bytecode_extract` — Extract V8 Ignition bytecode for a function
- `v8_version_detect` — Detect V8 engine version and feature support
- `v8_jit_inspect` — Inspect JIT-compiled code for a function

## Full tool list (8)

| Tool | Description |
| --- | --- |
| `v8_heap_snapshot_capture` | Capture a V8 heap snapshot from the active browser target |
| `v8_heap_snapshot_analyze` | Analyze a previously captured V8 heap snapshot |
| `v8_heap_diff` | Diff two captured V8 heap snapshots |
| `v8_object_inspect` | Inspect a V8 heap object by address |
| `v8_heap_stats` | Return V8 heap snapshot statistics |
| `v8_bytecode_extract` | Extract V8 Ignition bytecode for a function |
| `v8_version_detect` | Detect V8 engine version and feature support |
| `v8_jit_inspect` | Inspect JIT-compiled code for a function |
