# Autoresearch: per-tool quality debt (jshookmcp benchmark + retrieval)

> The metric is the sole arbiter. "This looks better" never drives a keep/discard —
> only a measured improvement that clears the noise floor does.

## Objective

Close the measurable per-tool quality gaps of the 736-tool MCP server, as scored by
the project's own eval suite (`pnpm bench:tools` + retrieval-metrics test). Baseline
audit (2026-11-10, artifacts/benchmarks/per-tool-scorecard.json):

- **565/736 tools have zero vector cases** (correctness never measured offline).
  Biggest holes: browser 79/85 · memory 72/75 · native-emulator 54/57 ·
  binary-instrument 41/46 · network 30/38 · process 26/29 · debugger 21/21 (live) ·
  core 19/25 · adb-bridge 21/26 (parsers are offline-pure!) · streaming 12/17 ·
  graphql 7/7 · mojo-ipc 7/8 · trace 8/10 · protocol-analysis 9/20.
  The README sanctions the lever: "To raise coverage, add an offline-pure
  `suites/<domain>.suite.ts`".
- **51/114 tools with retrieval evidence score MRR < 0.6; 5 score 0.0**
  (browser_attach, get_call_stack, detect_obfuscation, syscall_get_stats,
  dart_object_pool_dump). Lever: enrich tool descriptions/keywords in
  `src/server/domains/*/definitions.ts` with TRUE synonyms — never query-specific
  keyword stuffing. Engine params are OFF LIMITS (they are tuned by search:tune on
  the same fixture family — tuning here would be eval overfitting).
- **vector_fail = 0** (all 243 evaluated gate cases pass). Two per-tool partials
  (session_progress_record 2/3, tls_keylog_seal 1/2) exist only in the per-tool
  re-execution view — suspected re-execution state pollution, tracked in
  `per_tool_shortfall` (12), NOT in the primary metric.

Mechanism notes learned while studying the harness:
- `measureVectorBenches()` re-executes ALL suites inside per-tool-scorecard and
  counts a skipped case as a non-passed vector → env-gated misc-residual cases
  (9) inflate `per_tool_shortfall` on this Windows box. Honest: skip ≠ measurement.
- Gate (`tools-benchmark.test.ts`) runs suites once; per-tool view runs them
  AGAIN in the same process → non-idempotent cases (state-writing handlers) can
  pass the gate yet fail the per-tool view.
- bench:tools does NOT refresh retrieval artifacts — autoresearch.sh runs the
  retrieval test first, then bench:tools.

## Metrics

- **Primary**: `debt` = `unmeasured + low_mrr + vector_fail` (count, lower is better)
- **Secondary**: `vectors_total`, `low_mrr`, `vector_fail`, `per_tool_shortfall`,
  `slowest_ms`, `p1_pct`, `mrr10_pct`, `rejection_pct`
  — once tracked, include in every subsequent result.
- **Noise floor**: measured over 3 identical baseline runs (see config header).
  All three primary components are deterministic (pure handlers + BM25 over fixed
  fixtures), so the floor should be 0; any nonzero value means harness
  nondeterminism and must be investigated before trusting keeps.
- Guardrails inside `debt`: `rejection_pct` must stay 100 (it lives in the
  rejection fixture, refreshed each run; a description edit that lets
  out-of-domain queries match would also show up as retrieval churn — treat
  rejection_pct regression as checks_failed-level, discard even if debt falls).

## Budget

- maxRuns: 200 | maxSeconds: none | targetMetric: none
- Per-experiment wall-clock cap: 5 min (autoresearch.sh wraps each stage in
  `timeout 300`; typical run ≈ 15s).

## How to Run

`./autoresearch.sh [SEED]` — prints `METRIC name=number` lines. Exit non-zero =
crash (gate floor breach counts as crash). `./checks.sh` must then pass (exit 0).

## Files in Scope

- `tests/benchmarks/suites/*.suite.ts` + `suites/index.ts` — new offline-pure
  vector suites / cases (raises `vectors_total`, may surface real handler bugs).
- `tests/server/benchmarks/tools-benchmark.test.ts` — ONLY to append a
  `SUITE_THRESHOLDS` entry for a newly added suite (floor ≥ 85, matching sibling
  suites). Never lower an existing floor.
- `tests/benchmarks/CATALOG.md` — bookkeeping row for a new/extended suite
  (honest docs, required by the maintenance policy in that file).
- `src/server/domains/*/definitions.ts` (+ `handlers.impl.ts` / `src/modules/**`
  when a new vector exposes a REAL handler bug) — retrieval description work and
  bug fixes. Description edits MUST be followed by `pnpm metadata:sync` +
  `pnpm openapi:generate` (checks.sh enforces no drift).
- `artifacts/**` is gitignored regenerated output — never hand-edit.

## Off Limits

- `autoresearch.sh`, `autoresearch-metric.mjs`, `checks.sh` — **the eval harness
  is locked.** Never edit to change what/how the metric is measured.
- `tests/benchmarks/harness.ts`, `tests/benchmarks/per-tool-scorecard.suite.ts`,
  `tests/server/benchmarks/retrieval-metrics.test.ts` — measurement machinery.
- `tests/server/search/fixtures/**` (search-quality + search-rejection fixtures),
  `scripts/search-tune/**`, `src/server/search/**` engine constants — the eval
  data and the engine's tuned parameters. Improving retrieval happens ONLY on
  the tool-description side.
- Existing `SUITE_THRESHOLDS` values (may only ADD an entry for a new suite).
- No new runtime dependencies; no live browser/device/network in new cases.

## Constraints

- Every new vector case must be **offline-pure** and deterministic (see
  `DOMAIN_ENVIRONMENT` gate in per-tool-scorecard.suite.ts for each domain's
  offline capability; follow the encoding.suite.ts case shape: `run` calls the
  bound handler, `validate` asserts on `body()` output, cite external spec in
  `reference` when applicable).
- Zero built-in feature library (repo rule): vectors assert algorithm/spec
  behavior of code under test, never "known-bad payload" tables.
- `pnpm metadata:check`, `openapi:check`, `lint` must stay green (checks.sh).
- Description edits add only TRUE synonyms/capabilities that a real user query
  could legitimately use — no per-query keyword stuffing.
- Git: work happens on branch `autoresearch/per-tool-quality-20261110`; NEVER
  commit master; push/merge only after user confirmation (repo ⛔ rule).

## What's Been Tried

- **Segment 0**: Run 1 baseline: `debt=616` (`565 unmeasured + 51 low_mrr + 0 vector_fail`, noise floor=0). Discovery: retrieval eval runs on a synthetic decoupled fixture (`tests/server/search/fixtures/search-quality.fixture.ts`), so real `definitions.ts` edits cannot move `low_mrr` (51) while the harness/fixture are locked.
- **Segment 1** (delta-based over `unmeasured + vector_fail`, `+51` constant offset):
  - **Run 2 (crash) -> Run 3 (keep, debt=607, -9)**: `protocol-analysis` +9 cases (`pcap_read`, `pcapng_read/write`, `proto_*`). Learned: `new ProtocolAnalysisHandlers()` must take no args (passing `{} as never` binds `{}` to `engine`); `spec` fields use `int`, not `uint16/uint32`.
  - **Run 4 (crash) -> Run 5 (keep, debt=603, -4)**: new `mojo-ipc.suite.ts` +4 offline codec cases (`mojo_encode_message`, `mojo_decode_message`, `mojo_list_interfaces`, `mojo_ipc_capabilities`). Learned: call raw internal handlers when returning nested objects, since `body()` only unwraps top-level ToolResponse.
  - **Run 6 (keep, debt=599, -4)**: `platform.suite.ts` +4 cases (`asar_deobfuscate`, `miniapp_pkg_analyze`, `electron_scan_userdata`, `electron_debug_status`). Learned: `_0x[0-9a-fA-F]{4,8}` needs 4 hex digits; unwrap ToolResponse via `body(v)`.
  - **Run 7 (keep, debt=591, -8)**: `trace.suite.ts` +8 cases (10/10 trace tools measured!). Learned: `TraceDB.upsertNetworkResource` requires `receivedEncodedDataLength`; `diff_heap_snapshots` returns `diff.totalSizeDelta`.
  - **Run 8 (keep, debt=586, -5)**: `core.suite.ts` +5 cases (`detect_crypto`, `analysis_decode_string_array`, `analysis_deflat_control_flow`, `get_collection_stats`, `clear_collected_data`).
  - **Run 9 (keep, debt=583, -3)**: `transform.suite.ts` +3 offline AST cases (`ast_transform_preview`, `ast_transform_chain`, `ast_transform_apply`). All 7 offline transform tools covered (only `crypto_extract_standalone` needs live page).
  - **Run 10 (crash) -> Run 11 (keep, debt=579, -4)**: `cross-domain.suite.ts` +4 cases (`cross_domain_suggest_workflow`, `cross_domain_evidence_stats`, `cross_domain_evidence_query`, `cross_domain_correlate_all`). 8/8 cross-domain tools measured!
  - **Run 12 (keep, debt=577, -2)**: `coordination.suite.ts` +2 offline cases (`complete_task_handoff`, `list_page_snapshots`).
  - **Run 13 (keep, debt=567, -10)**: `exploit-dev.suite.ts` +10 cases (`exploit_cache_*` x4, `exploit_find_gadgets`, `exploit_find_jmp_esp`, `exploit_build_rop_chain`, `exploit_build_stack_pivot`, `exploit_analyze_mitigations`, `exploit_verify_rop_chain`).
  - **Run 14 (crash, real bug exposed!) -> Run 15 (keep, debt=566, -1)**: `sourcemap.suite.ts` +1 case (`sourcemap_parse_v4`), exposed & fixed real bug where `fetchSourceMapText` rejected `data:` URIs with `Blocked: unsupported protocol "data:"` despite schema supporting Data URIs (fixes both `sourcemap_parse_v4` and `sourcemap_reconstruct_tree` `emitScopes`). All 6 offline sourcemap tools covered!
  - **Run 16 (keep, debt=561, -5)**: `dart-inspector.suite.ts` +5 pure-TS cases (`dart_strings_extract`, `flutter_packages_detect`, `dart_symbolize`, `dart_version_fingerprint`, `dart_object_pool_dump`) using real committed `tiny-libapp.so` / `packages-libapp.so` and inline Smi/hash fixtures.
  - **Run 17 (keep, debt=560, -1)**: `wasm.suite.ts` +1 pure-TS case (`wasm_string_extract`).
  - **Run 18 (keep, debt=553, -7)**: `maintenance.suite.ts` +7 offline cases (`clear_all_caches`, `smart_cache_cleanup`, `cleanup_artifacts`, `doctor_environment`, `snapshot_create`, `snapshot_list`, `snapshot_restore`). 13/17 maintenance tools measured!
  - **Run 19 (keep, debt=549, -4)**: `v8-inspector.suite.ts` +4 offline heap cases (`v8_heap_find_leaks`, `v8_function_retained`, `v8_heap_snapshot_export`, `v8_heap_snapshot_delete`). Unmeasured broke below 500 → **498**!
  - **Run 20 (keep, debt=534, -15)**: new `native-emulator.suite.ts` +15 ARM64 in-process CPU emulation cases (`nemu_create_session`, `nemu_destroy_session`, `nemu_list_sessions`, `nemu_session_info`, `nemu_load_library`, `nemu_list_symbols`, `nemu_call_symbol` (`add_two(40,2)=42`), `nemu_alloc_memory`, `nemu_write_memory`, `nemu_read_memory`, `nemu_new_byte_array`, `nemu_read_byte_array`, `nemu_setup_java_mock`, `nemu_create_jni_handle`, `nemu_jni_handles`). All 15/15 passed first try!
  - **Run 21 (keep, debt=516, -18, real bug fixed!)**: `native-emulator.suite.ts` Wave 2 +18 offline cases (`nemu_call_address`, `nemu_mem_map`, `nemu_scan_memory`, `nemu_xor_region`, `nemu_patch_apply`, `nemu_data_dump`, `nemu_dump_frame`, `nemu_pointer_chain`, `nemu_mem_inspect`, `nemu_bytecode_scan`, `nemu_set_registers`, `nemu_regs_save`, `nemu_regs_restore`, `nemu_create_vtable`, `nemu_set_vtable_slot`, `nemu_vm_state_dump`, `nemu_vm_state_compare`, `nemu_set_pac_key`). Exposed & fixed a real bug in `handleRegsRestore`: `argStringArray(args, 'regs')` returns `[]` (truthy!), so omitting `regs` checked `if (regFilter && !regFilter.includes(reg))` and restored 0 registers instead of all saved registers (`regFilter.length > 0`). Milestone: **-100 debt from baseline (616 → 516)**, `vectors_total` **271**!

**Meta-review (Runs 1–21)**:
- **Winning pattern**: Graduating offline-capable domains (`mojo-ipc`, `native-emulator`) from 📋 to ✅ and writing spec/contract vectors with omitted optional defaults has dropped `debt` from **616 → 516 (-100 tools covered, `vectors_total` 171 → 271)** AND caught 2 latent real production bugs (`sourcemap_parse_v4` `data:` URI rejection, `nemu_regs_restore` empty-filter bug), with `vector_fail=0` and `rejection_pct=100%`.
- **Remaining highest-yield offline domains**: `native-emulator` remaining ~21 tools (`nemu_trace`, `nemu_write_regions`, `nemu_prepare_tls`, `nemu_mem_shadow`, `nemu_setup_java_field`, `nemu_setup_java_mocks`, `nemu_jni_diag`, `nemu_get_jni_stub`, `nemu_dlsym_diag`, `nemu_inspect_imports`, `nemu_dump_got`, `nemu_bind_host_fn`, `nemu_bind_all_imports`, `nemu_vm_state_load`, `nemu_session_load`, `nemu_relay`, `nemu_gdbserver`), `binary-instrument` static APK/DEX parsers, `adb-bridge` parsers, `streaming`/`network` offline parsers.
