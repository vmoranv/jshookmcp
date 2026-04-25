# Tool Reality Audit

- Audit date: `2026-04-25`.
- Default platform assumption: current `win32` runtime unless a manifest explicitly filters by platform.
- Legend: `real` = real implementation path exists; `conditional` = real path but gated by runtime/page/device/tooling/privileges; `fallback` = stub/manual/simulated/degraded path exists; `unregistered` = defined but not mounted.
- Scope note: this matrix separates mounted/runtime paths from degraded or compatibility-only paths. It does not prove every tool succeeds in every environment; `pnpm run audit:tools` only proves registration/bind integrity plus metadata freshness.
- Targeted verification: `pnpm exec vitest run ...` over 29 files, `352` tests passed.
- Focused runtime probes on this machine confirmed real payloads for Frida attach/module/script execution, network response bodies, WebSocket frames, SSE events, and trace body/chunk capture; Mojo message capture and V8 heap capture still showed degraded or simulated output.

High-risk mismatches:
- `native-bridge` is dead code in the current manifest system.
- `trace` is real SQLite-backed timeline capture with optional chunk/body persistence, but it is still policy-bound rather than an unbounded full response mirror.
- `mojo-ipc`, parts of `v8-inspector`, `wasm`, CAPTCHA solving, and some platform helpers still have explicit fallback/simulation paths even when capability probes succeed.
- Compatibility-only suspects still exist: `src/server/domains/v8-inspector/handlers.impl.ts` and `src/server/domains/streaming/handlers.impl.streaming-*` are retained for legacy direct imports/tests while current runtime goes through newer handler chains.

Parts:
- [part-1-a-m.md](./part-1-a-m.md)
- [part-2-n-w.md](./part-2-n-w.md)
