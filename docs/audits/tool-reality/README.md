# Tool Reality Audit

- Audit date: `2026-04-25`.
- Default platform assumption: current `win32` runtime unless a manifest explicitly filters by platform.
- Legend: `real` = real implementation path exists; `conditional` = real path but gated by runtime/page/device/tooling/privileges; `fallback` = stub/manual/simulated/degraded path exists; `unregistered` = defined but not mounted.
- Scope note: this matrix separates mounted/runtime paths from degraded or compatibility-only paths. It does not prove every tool succeeds in every environment; `pnpm run audit:tools` only proves registration/bind integrity plus metadata freshness.
- Verification commands: targeted Vitest suites for audited domains, `pnpm exec tsc -p tsconfig.json --noEmit`, `pnpm build`, and `pnpm run audit:runtime -- --json`.
- Focused runtime probes on this machine confirmed real payloads for Frida attach/module/script execution, network response bodies, WebSocket frames, SSE events, trace body/chunk capture, and V8 heap snapshot capture/analyze plus non-zero `v8_heap_stats`. With `browser_launch(enableV8NativesSyntax=true)`, `v8_version_detect.features.nativesSyntax` flipped to `true` and `v8_jit_inspect` returned explicit `inspectionMode: native-status`; `v8_bytecode_extract` still remained source-derived pseudo-bytecode rather than raw Ignition output. Mojo monitoring still degraded to simulation mode with a seeded default interface catalog.

High-risk mismatches:
- `native-bridge` is intentionally externalized from the built-in manifest/ToolCatalog set.
- `trace` is real SQLite-backed timeline capture with optional chunk/body persistence, but it is still policy-bound rather than an unbounded full response mirror.
- `mojo-ipc`, `v8_bytecode_extract`, `wasm`, CAPTCHA solving, and some platform helpers still have explicit fallback/simulation or partial-output paths even when capability probes succeed. `v8_jit_inspect` can now return native optimization status, but only when the launched browser enables V8 natives syntax.
- Compatibility-only suspects still exist: `src/server/domains/v8-inspector/handlers.impl.ts` and `src/server/domains/streaming/handlers.impl.streaming-*` are retained for legacy direct imports/tests while current runtime goes through newer handler chains.

Parts:
- [part-1-a-m.md](./part-1-a-m.md)
- [part-2-n-w.md](./part-2-n-w.md)
