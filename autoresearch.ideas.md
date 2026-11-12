# Ideas backlog — per-tool quality debt

## ⚠️ Found 2026-11-12 (run 59) — blocked, needs a dedicated FFI session

`src/native/Win32Debug.ts` declares koffi prototypes with C array types:
- L680/681 `Thread32First/Next(void *, _Out_ uint8_t[28])` → **throws at call time**:
  `Array types decay to pointers in prototypes (C standard), use pointers`
  (verified: `EnumerateProcessThreads(process.pid)` throws on Windows 11)
- L542 `GetThreadContext(void *, _Inout_ uint8_t[${CONTEXT_SIZE}])` — same class
- L556 `SetThreadContext(void *, uint8_t[${CONTEXT_SIZE}])` — same class
- `src/native/syscall/AntiAnalysis.ts` L203 `GetLastInputInfo(_Out_ uint8_t[8])` — same class

Consequence: `process_enum_threads` (win32 fast path), thread-context get/set and the
idle-time anti-analysis probe are **dead on arrival** — they throw before any native call.

Substitute prototypes tried (probe only, NOT verified correct):
- `void *` → call succeeds but `th32OwnerProcessID` reads 0 for every row and the loop
  never terminates (5000-iteration cap).
- `_Out_ void *`, `_Out_ uint8_t *`, `_Inout_ void *`, struct-typed `_Inout_ S *` →
  identical garbage.

**Do not ship a fix without a verified idiom.** Needs a focused FFI session: establish
koffi 3.x buffer-out semantics against a known-good API (`GetSystemDirectoryA(char *)`
does write correctly), then re-derive the Toolhelp32 loop. Repo rule: no unverifiable
native code.

## Remaining coverage targets (offline-capable, by expected yield)

- `memory` 65 — Win32 FFI-gated; most tools need a real target process. Only the
  argument-validation/honest-failure surface is testable (same pattern as `process`).
- `debugger` 18 — CDP-session bound; honest-unavailable contracts + `debugger_disassemble`
  (capstone, pure) are the testable slice.
- `core` 6, `graphql` 7, `dart-inspector` 9, `syscall-hook` 8, `adb-bridge` 21,
  `native-bridge` 3, `instrumentation` 4, `workflow` 5, `coordination` 2, `platform` 2,
  `maintenance` 2, `transform` 1, `proxy` 1, `sourcemap` 1, `mojo-ipc` 3, `v8-inspector` 7.
- `browser` 58 remaining — almost all CDP/page-bound (`page_click`, `page_screenshot`,
  `browser_attach`…). Argument-validation + honest-unavailable contracts are the only
  portable slice.

## Patterns with a proven track record (reuse them)

1. **Scripted page substrate** — `evaluate` replays fixed page results; measures the
   host half of a browser-bound tool (runs 52/54/55/58).
2. **Honest-unavailable contract** — explicit `success=false` + named reason + zero
   fabricated payload (runs 51/53/54/58).
3. **Runs-or-names-missing-binary** — external-toolchain tools either produce a real
   payload or fail naming the binary; portable across machines (runs 56/57).
4. **Argument-rejection-by-name** — required args rejected before any side effect.
5. **Unknown-session refusal** — `available:false` + fix hint + empty result array.
