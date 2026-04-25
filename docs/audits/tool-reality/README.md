# Tool Reality Audit

- Audit date: `2026-04-25`.
- Default platform assumption: current `win32` runtime unless a manifest explicitly filters by platform.
- Legend: `real` = real implementation path exists; `conditional` = real path but gated by runtime/page/device/tooling/privileges; `fallback` = stub/manual/simulated/degraded path exists; `unregistered` = defined but not mounted.
- Targeted verification: `pnpm exec vitest run ...` over 29 files, `352` tests passed.

High-risk mismatches:
- `native-bridge` is dead code in the current manifest system.
- `trace` is suitable for phase/timing analysis, not full response-body/chunk capture.
- `mojo-ipc`, parts of `binary-instrument`, `v8-inspector`, `wasm`, CAPTCHA solving, and some platform helpers have explicit fallback/simulation paths.

Parts:
- [part-1-a-m.md](./part-1-a-m.md)
- [part-2-n-w.md](./part-2-n-w.md)
