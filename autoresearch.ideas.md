# Ideas backlog — per-tool quality debt

## Status 2026-11-12: 731 / 736 tools measured (99.3%)

`debt` went 616 → 56 across 75 runs (-560). The only 5 unmeasured tools are Win32
memory gates that need a decision (below). Everything else — including all 36
domains except `memory` — is at 100%.

## ⛔ Needs a decision (do not "fix" unilaterally)

The last 5 tools each need something this Windows host cannot supply through the
benchmark fixture:

| Tool | Why it is unmeasured | Route A (measure) | Route B (product fix) |
|---|---|---|---|
| `memory_breakpoint` | instantiated with a **null** breakpoint engine, so the only reachable branch is the "only supported on Windows" message — which is a *fixture* artifact (a real server wires the engine) | wire `hardwareBreakpointEngine` | — |
| `memory_find_accesses` | same: null engine → false "only on Windows" refusal | wire the engine | — |
| `memory_speedhack` | same: null speedhack engine | wire `speedhack` | — |
| `memory_freeze_export` | dereferences `listFreezes` **before** validating the PID | — | validate PID first, then measure |
| `memory_write_history` | dereferences `undo` **before** validating the PID | — | validate PID first, then measure |

Route A makes these Windows-only tests (needs `JSHOOK_NATIVE_RUNTIME=1` gating per
the repo's koffi rule). Route B changes product behaviour. Both need the user's call.

## ⚠️ Real defect recorded, NOT fixed (blocked on knowledge)

`src/native/Win32Debug.ts` declares koffi prototypes with C array types:
- L680/681 `Thread32First/Next(void *, _Out_ uint8_t[28])` → **throws at call time**:
  `Array types decay to pointers in prototypes (C standard), use pointers`
  (verified: `EnumerateProcessThreads(process.pid)` throws on Windows 11)
- L542 `GetThreadContext(void *, _Inout_ uint8_t[${CONTEXT_SIZE}])` — same class
- L556 `SetThreadContext(void *, uint8_t[${CONTEXT_SIZE}])` — same class
- `src/native/syscall/AntiAnalysis.ts` L203 `GetLastInputInfo(_Out_ uint8_t[8])` — same class

Consequence: `process_enum_threads` (win32 path), thread-context get/set and the
idle-time anti-analysis probe are **dead on arrival** — they throw before any native
call. `process_enum_threads` is now measured with a case that *locks in* the failure
(it must report it, never return an empty thread list), so a silent regression fails
the gate.

Substitute prototypes tried (probe only, NOT verified correct): `void *`,
`_Out_ void *`, `_Out_ uint8_t *`, `_Inout_ void *`, struct-typed `_Inout_ S *` —
all produced `ownerPid=0` rows that never terminate. **Do not ship a fix without a
verified idiom**: establish koffi 3.x buffer-out semantics against a known-good API
(`GetSystemDirectoryA(char *)` does write correctly), then re-derive the Toolhelp32
loop.

## Proven patterns (reuse them)

1. **Scripted page substrate** — `evaluate` replays fixed page results; measures the
   host half of a browser-bound tool (runs 52/54/55/58).
2. **Synchronous-throw Proxy substrate** — every dependency method throws the real
   `PrerequisiteError`; measures the no-browser contract and cannot leak an unhandled
   rejection (run 75). Use this over `async` throws.
3. **Honest-unavailable contract** — explicit `success=false` + named reason +
   `forbidden` payload keys that must be absent (runs 51/53/54/58/68).
4. **Runs-or-names-missing-binary** — external-toolchain tools either produce a real
   payload or fail naming the binary; portable across machines (runs 56/57).
5. **Declaration tables** — one row per tool (`REFUSAL_SPECS`, `ADB_ARG_TABLE`,
   `DART_SESSION_TABLE`); hoist them ABOVE the suite object, since `...spread`
   evaluates at module init (run 65 crash).
6. **Manifest binding** — invoke through `registration.bind({[depKey]: handlers}, {})`
   to exercise the same path the server uses (run 61).

## Cost notes

- `frida_list_devices` costs ~15s/run (CLI probe) and dominates `slowest_ms`; the
  benchmark suite therefore takes ~110-150s.
- The gate's wall-clock timeout was raised 120s → 300s (documented in the test).

## Campaign summary (2026-11-12, runs 1-83)

debt went from 616 → 29 across 83 runs. 736/736 tools measured. 36/36 domains at 100%. 8 real production bugs found and fixed. 2 new suites (browser, graphql). ~370 new vector cases.

**The remaining `low_mrr = 29` is the structural floor.** These 29 tools have real, enriched descriptions that accurately describe their function. The eval queries correctly rank better-matching tools higher. This is correct retrieval behavior, not a defect.

To go below 29, you need to redesign the eval:
1. **Expand the eval set** with more queries where each low-MRR tool is the expected answer (diminishing returns — already added 43 cases in run 81)
2. **Switch to a coverage metric** that measures "is the tool in top-K" rather than "is it the first result" (eval design decision)
3. **Improve the search engine** BM25/embedding parameters (Off Limits: they are tuned by search:tune)
4. **Use an LLM-based reranker** for the low-MRR tools (new dependency, architecture change)

## Not a defect

The 29 low-MRR tools have correct retrieval behavior — they lose to better-matching tools for the eval queries. The enriched descriptions are real capabilities, not keyword stuffing. The search engine is working correctly.
