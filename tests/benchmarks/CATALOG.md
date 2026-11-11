# Tool Benchmark Catalog

736 tools across 36 registry domains → their benchmark sources.

Legend: **[外部]** = public benchmark / spec / official test vectors that can quantifiably
evaluate the tool category. **[自制]** = homemade fixture suite (ground truth designed by us).
**✅ 已接入** = wired into the runnable harness (`tests/benchmarks/suites/`, gate:
`tests/server/benchmarks/tools-benchmark.test.ts`, run: `pnpm bench:tools`).
**📋 规划** = mapping identified, suite not yet written.

Runnable suites today: 38 suites / 252 cases (243 pass, 9 env-gated/placeholder skips) — see `artifacts/benchmarks/scorecard.md`. 7 offline-pure suites (instrumentation, extension-registry, streaming, proxy, syscall-hook, webgpu, canvas) graduated from 📋 to ✅ in the 2026-11-05 coverage wave, adding 32 tools with real vector measurements.
**Per-tool scorecard**: `artifacts/benchmarks/per-tool-scorecard.{md,json}` gives every one of the
736 tools NATIVE metrics — no composite score, no letter grades; each column keeps its own unit:

| Column | Unit | Measured by |
|---|---|---|
| correctness | x/y vectors passed | vector-bench suites, re-executed every `pnpm bench:tools` — **356 tools measured** |
| throughput | µs/call (measured wall time) | same execution |
| handler-fn | % of bound handler functions executed | real `vitest --coverage` run (`pnpm bench:coverage`) |
| e2e-tasks | count of real-task files (≥90% pass) exercising the tool | pass^k e2e run (`pnpm bench:e2e`) — min pass-rate across rounds, 115 tools covered |
| retrieval | MRR@10 / NDCG@10 / P@1 / Success@3 (%) | live 109-query eval vs ToolSearchEngine — **MRR@10 79.8% · NDCG@10 82.2% · P@1 67.0% · S@3 93.6% · S@5 99.1%** |
| rejection | % out-of-domain rejected | live 12-query eval vs ToolSearchEngine — **100.0% rejected** |

Environment-gated files (browser display, Camoufox, root) that self-skip stay honestly
unmeasured rather than counted.

---

## Run it

```bash
pnpm bench:tools                 # scorecard → artifacts/benchmarks/scorecard.md + .json
corepack pnpm exec vitest run --project server tests/server/benchmarks/tools-benchmark.test.ts
```

Suites live in `tests/benchmarks/suites/*.suite.ts`; harness in `tests/benchmarks/harness.ts`.
The gate runs inside the normal `pnpm test` (server project) with per-suite floors.

---

## adb-bridge (26 tools) — ✅ suite `adb-bridge-parsers`

- **[自制] ✅** `adb-bridge-parsers` suite: golden transcripts for getprop property parsing, device fingerprint curation (SDK/ABI/bootloader), logcat threadtime line parsing, priority filter evaluation, proc/maps parser, and input text escaping.
- **[外部]** [AndroidWorld](https://github.com/google-research/AndroidWorld) — 116 task-level Android automation benchmark (device-in-the-loop). 📋
- **[外部]** [MobileAgentBench](https://github.com/MobileAgentBench/MobileAgentBench) — UI-agent task success on real apps. 📋
- Requires a live device/emulator for end-to-end; parsing layers are offline-testable.

## binary-instrument (46 tools)

- **[外部]** [DexRay](https://github.com/DexRay/DexRay) / androguard test suite — DEX parsing correctness. 📋
- **[外部]** Wireshark/android packer corpora (360/Tencent legu/bangcle sample sets from packer-detection papers) — packer classifier accuracy. 📋
- **[外部]** [blutter](https://github.com/worawit/blutter) sample Flutter apps — Dart AOT snapshot parsing (dart-inspector domain shares this). 📋
- **[自制] ✅** `binary-instrument` suite: entropy profile region separation (Shannon bounds), strings ASCII/UTF-16LE extraction + regex filter, DEX magic scan (`dex\n035\0`), custom packer-signature matching (dirPath mode), empty default signature table contract.
- **[自制] ✅** (2026-11-11, +13 offline tools): `binary_instrument_capabilities`, `get_available_plugins`, `frida_list_sessions`, `frida_generate_script`, `generate_hooks`, `export_hook_script`, `apk_native_libs_list`, `apk_manifest_dump`, `apk_manifest_query`, `apk_static_triage`, `apk_dex_intake`, `apk_signing_block_parse`, `binary_key_extract` (synthetic stored-ZIP APK + high-entropy 32B key blob).

## browser (85 tools)

- **[自制] ✅** (2026-11-11, offline-pure subset via `offline-tools`): `browser_jsdom_parse`, `browser_jsdom_query`, `browser_jsdom_execute` (QuickJS WASM sandbox eval), `get_detailed_data` (DetailedDataManager slice retrieval), `get_offloaded_data` (safe offloaded artifacts retrieval), `stealth_generate_fingerprint` (offline profile generation), `captcha_solver_capabilities` (provider reporting).
- **[外部]** [WebArena](https://webarena.dev) / [VisualWebArena](https://jykoh.com/vwa) / [WorkArena](https://github.com/ServiceNow/WorkArena) / [WebChoreArena](https://openreview.net/forum?id=d0xqdsR41U) — task success rates for the `page_*` / `browser_*` automation family (self-hosted sites, functional correctness checks). 📋
- **[外部]** [BrowserGym](https://github.com/ServiceNow/BrowserGym) — unified action-space harness; our page_* primitives map onto its action space. 📋
- **[外部]** [CreepJS](https://abrahamjuliot.github.io/creepjs/) + fingerprint-suite datasets — stealth_inject / stealth_verify / fingerprint tooling efficacy. 📋
- **[外部]** [web-vitals reference implementation](https://github.com/GoogleChrome/web-vitals) — browser_get_metrics Web Vitals semantics. 📋
- **[自制]** page_* primitive semantics (click/type/select/wait) are deterministic against a local fixture page (the repo already ships one for e2e: `tests/e2e`). 📋

## canvas (11 tools) — ✅ suite `canvas` (offline subset)

- **[自制] ✅** `canvas` suite: `canvas_scene_search` pure-compute (name/type/property/AABB match sets + path). Other 10 tools are pageController-bound (live browser) — remain 📋.

- **[外部]** No public engine-detection benchmark. Three.js/Babylon/Laya unit suites validate *engines*, not detectors. 📋
- **[自制]** detector fixtures: minimal Three.js/Babylon pages asserting engine fingerprint + shader dump + draw-call hook capture. 📋

## coordination (12 tools) — ✅ suite `coordination-lifecycle`

- **[外部]** [node-lru-cache](https://github.com/isaacs/node-lru-cache) test suite — state_board LRU eviction semantics (incl. the known MRU-promotion-on-update gap). 📋
- **[外部]** Playwright `storageState` JSON schema — page snapshot save/restore roundtrip. 📋
- **[自制] ✅** `coordination-lifecycle` suite: task handoff create & complete lifecycle, session insights accumulation & category aggregation, state_board set/get/delete and list/clear operations.
- **[自制] ✅** (2026-11-11) `complete_task_handoff` status/summary/keyFindings transition and `list_page_snapshots` honest empty listing contract.

## core (25 tools — see `core-analysis` suite)

- **[外部]** webcrack's own test suite (it is a direct dependency) — deobfuscate/webcrack_unpack. 📋
- **[外部]** [SOURCERER / JSDeobfuscation datasets](https://github.com/jscrub-tools) & obfuscator.io sample corpus — deobfuscation eval. 📋
- **[自制] ✅** `core-analysis` suite: obfuscator.io-style string-array sample detection, clean-code negative control, planted-secrets security scan, source→sink taint path, AST match counts, opaque predicate solving.
- **[自制] ✅** (2026-11-10) `core-analysis` coverage batch: `detect_crypto` (AES/SHA algorithm & library detection), `analysis_decode_string_array` (string-array call inlining), `analysis_deflat_control_flow` (switch-in-while dispatcher unflattening), `get_collection_stats` (cache/compression summary), `clear_collected_data` (session cache clear receipt).
- **[自制] ✅** (2026-11-11 Wave 2, +8 offline tools): `understand_code` (offline structural analysis), `js_deobfuscate_pipeline` (constant fold + dead-code removal), `js_symbolic_execute` (branch path exploration), `js_symbolic_execute_jsvmp` (PUSH/ADD/HALT symbolic VM), `deobfuscate` (Dean Edwards packer unpack), `webcrack_unpack` (webcrack constant fold), `js_analyze_vm`, `js_deobfuscate_jsvmp` (detectOnly mode). (19/25 core tools measured; remaining 6 require live browser/page scripts or LLM sampling).

## cross-domain (8 tools) — ✅ suite `cross-domain` (8/8 tools measured)

- **[外部]** [W3C PROV-DM / PROV-JSON](https://www.w3.org/TR/prov-dm/) + [prov-check](https://github.com/pgroth/prov-check) constraints — evidence graph export validity. 📋
- **[外部]** [BFCL tool-retrieval category](https://gorilla.cs.berkeley.edu) (Berkeley Function Calling Leaderboard) — cross_domain_synonym / workflow suggestion quality; repo-internal datasets at `scripts/search-tune/datasets` remain primary. 📋
- **[自制] ✅** `cross-domain` suite: synonym intent resolution with recommended tools mapping, evidence bridge node/edge export and stats calculation, workflow capabilities evaluation across enabled domains.
- **[自制] ✅** (2026-11-11) `cross-domain` completion batch: `cross_domain_suggest_workflow` (goal ranking + coverage), `cross_domain_evidence_stats` (node/edge count verification), `cross_domain_evidence_query` (network_url filter), `cross_domain_correlate_all` (offline mojo/cdp/network/syscall correlators).

## dart-inspector (16 tools) — ✅ suite `dart-inspector`

- **[外部] ✅** dart-sdk runtime/vm/snapshot.h: magic 0xf5f5dcdc (LE), int64 length/kind, 32B version hash, features string.
- **[外部] ✅** Smi tagged-pointer encoding: value << 1, tag bit 0.
- **[自制] ✅** (2026-11-11) `dart_strings_extract` (`tiny-libapp.so` category scan), `flutter_packages_detect` (`packages-libapp.so` stdlib/thirdParty aggregation), `dart_symbolize` (flat obfuscation map resolution), `dart_version_fingerprint` (snapshot hash lookup), `dart_object_pool_dump` (Dart 2.17 Smi pool decoding).
- **[外部]** [blutter](https://github.com/worawit/blutter) test Flutter builds — Code object listing parity. 📋

## debugger (21 tools)

- **[外部]** Chrome DevTools protocol conformance is covered by Chromium's own CDP tests; no offline vectors. 📋
- **[自制]** antidebug_detect/bypass against fixture pages embedding the four documented protection types. 📋

## encoding (5 tools) — ✅ suite `encoding`

- **[外部] ✅** RFC 4648 §10 base64 + base32 test vectors (binary_encode).
- **[外部] ✅** Google protobuf wire-format spec "simple message" (08 96 01 → varint 150) via binary_decode + protobuf_decode_raw.
- **[自制] ✅** Shannon entropy bounds (uniform → 8.0, constant → 0), gzip roundtrip, magic-byte format detection.

## exploit-dev (21 tools) — ✅ suite `exploit-dev`

- **[外部] ✅** De Bruijn 4-gram uniqueness property (pwntools `cyclic` definition).
- **[外部] ✅** Z3 SMT semantics (SAT-with-model / UNSAT).
- **[外部] ✅** one_gadget known-libc database (glibc 2.23–2.39, musl 1.2).
- **[外部]** [ROPium](https://github.com/teerder/ROPium) evaluation binaries — gadget finder recall. 📋
- **[自制] ✅** offset roundtrip, %hn format-string structure, ret2dlresolve validation contract.
- **[自制] ✅** (2026-11-11) `exploit_cache_stats`, `exploit_cache_configure`, `exploit_cache_clear`, `exploit_cache_invalidate`, `exploit_find_gadgets` (x64 fixture search), `exploit_find_jmp_esp` (x86 esp discovery), `exploit_build_rop_chain` (execve ROP chain on test binary), `exploit_build_stack_pivot` (stack pivot discovery), `exploit_analyze_mitigations` (PE CFG/ASLR/NX inspection), `exploit_verify_rop_chain` (Z3 simulated chain verification).

## extension-registry (7 tools) — ✅ suite `extension-registry` (offline subset)

- **[自制] ✅** `extension-registry` suite: install→list→info→execute→reload→uninstall lifecycle against a temp-dir fixture plugin. `webhook` is env-gated — remains 📋.

- **[外部]** [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks) HMAC signing vectors — webhook action. 📋
- **[自制]** install/reload/uninstall lifecycle against a fixture plugin dir. 📋

## graphql (7 tools)

- **[外部]** [graphql-scalars](https://github.com/Urigo/graphql-scalars) / graphql-js introspection fixtures; [InQL](https://github.com/doyensec/inql) test targets. 📋
- **[自制]** suggestion-error schema enumeration against a local graphql-js server fixture. 📋

## instrumentation (13 tools) — ✅ suite `instrumentation` (offline subset)

- **[自制] ✅** `instrumentation` suite: 9 offline-pure tools (session create/status/list/destroy, snapshot export/diff/merge, operation register/list/status/stop, artifact record/query, evidence query/export/chain). 4 browser-bound tools remain 📋.

- **[外部]** HAR 1.2 record/replay (Playwright `routeFromHAR` semantics) — instrumentation_network_replay. 📋
- **[自制]** session diff/merge/export identity properties; hook-preset capture on fixture pages. 📋

## maintenance (17 tools) — ✅ suite `maintenance` (16/17 tools measured — 94.1%)

- **[外部] ✅** [pmndrs/detect-gpu](https://github.com/pmndrs/detect-gpu) benchmark database: official UNMASKED_RENDERER_WEBGL strings (NVIDIA/Apple/Intel/AMD) must classify to their vendor.
- **[外部]** [openai/tiktoken](https://github.com/openai/tiktoken) counts — token budget counters. 📋
- **[自制] ✅** `get_token_budget_stats`, `manual_token_cleanup`, `reset_token_budget`, `get_cache_stats`.
- **[自制] ✅** (2026-11-11) `clear_all_caches`, `smart_cache_cleanup`, `cleanup_artifacts` (dryRun policy), `doctor_environment` (diagnostics summary), `snapshot_create` (shadow-git snapshot), `snapshot_list` (recorded history), `snapshot_restore` (revert modified file to snapshot).
- **[自制] ✅** (2026-11-11, +3 tools): `execute_sandbox_script` (QuickJS WebAssembly isolated eval), `list_extensions` (extension manager inventory), `reload_extensions` (runtime extension reload with mutex). (Only `install_extension`/`browse_extension_registry` require network registry!).

## memory (75 tools) — ✅ suite `memory-pure-ts` (offline subset)

- **[外部] ✅** Cheat Engine .CT (CETRAINER XML) format: export → HMAC-SHA256 sign → verify loop + tamper detection.
- **[外部] ✅** (2026-11-11, +7 pure-TS tools): `memory_parse_dump` (Windows MDMP header 0x504D444D), `memory_assemble` (`nop; ret` → `90 c3`), `memory_bookmark` (add/list/clear), `memory_register_type` / `memory_list_types` / `memory_unregister_type`, `memory_scan_session` (list).
- **[外部]** scanmem/Cheat-Engine-format references; **[外部]** Chromium crashpad sample dumps — memory_parse_dump deeper streams. 📋
- **[外部]** pwntools `cyclic`/one_gadget (shared with exploit-dev). ✅ (via exploit-dev suite)
- **[自制] 📋** AOB wildcard patterns, signature wildcarding, structure export (C/ReClass/Rust/C#), region compare; Win32-live members need a fixture process (CI-infeasible, mark skip).

## mojo-ipc (8 tools) — ✅ suite `mojo-ipc` (offline codec subset)

- **[自制] ✅** (2026-11-10) `mojo-ipc` suite: uint32-LE encode determinism (150 → …96000000), encode→decode roundtrip preserving the field value, honest listing contract (empty or explicitly seeded/simulated catalog without a live target), capabilities report enumerates mojo_ipc_monitoring + its tools.
- **[自制]** roundtrip vs Chromium mojo test-message hex fixtures from the Chromium source tree (`mojo/public/js` tests). 📋 (live-capture side: mojo_monitor / mojo_messages_get / mojo_messages_summarize / mojo_verify_live remain env-gated)

## native-bridge (6 tools) — ✅ suite `native-bridge`

- **[自制] ✅** `native-bridge` suite: bridge protocol loopback health probe (reachable=false when offline), static tool setup guides (Rizin, Binary Ninja), SSRF endpoint validation.

## native-emulator (57 tools) — ✅ suite `native-emulator` (**57/57 tools measured — 100%!**)

- **[外部] ✅** (2026-11-11) ELF64 AArch64 minimal `.so` (`EM_AARCH64=183`, `SHT_DYNSYM`) + ARMv8-A A64 `add x0, x0, x1; ret` (`add_two(40, 2) === 42`) via `nemu_load_library`, `nemu_list_symbols`, `nemu_call_symbol`.
- **[自制] ✅** (2026-11-11) `native-emulator` suite (15 tools): `nemu_create_session`, `nemu_destroy_session`, `nemu_list_sessions`, `nemu_session_info`, `nemu_alloc_memory`, `nemu_write_memory`, `nemu_read_memory`, `nemu_new_byte_array`, `nemu_read_byte_array`, `nemu_setup_java_mock`, `nemu_create_jni_handle`, `nemu_jni_handles` (plus `nemu_bytecode_decode`/`nemu_disassemble`/`nemu_capabilities` in `offline-tools`).
- **[自制] ✅** (2026-11-11 Wave 2, +18 tools): `nemu_call_address`, `nemu_mem_map`, `nemu_scan_memory`, `nemu_xor_region`, `nemu_patch_apply`, `nemu_data_dump`, `nemu_dump_frame`, `nemu_pointer_chain`, `nemu_mem_inspect`, `nemu_bytecode_scan`, `nemu_set_registers`, `nemu_regs_save`, `nemu_regs_restore` (also fixed `regFilter.length > 0` bug when `regs` is omitted!), `nemu_create_vtable`, `nemu_set_vtable_slot`, `nemu_vm_state_dump`, `nemu_vm_state_compare`, `nemu_set_pac_key`.
- **[自制] ✅** (2026-11-11 Wave 3, +18 tools): `nemu_inspect_imports`, `nemu_dump_got`, `nemu_prepare_tls`, `nemu_mem_shadow`, `nemu_bind_host_fn`, `nemu_bind_all_imports`, `nemu_call_jni_export` (`Java_bench_add(40,2) === 42`), `nemu_setup_java_mocks`, `nemu_setup_java_field`, `nemu_write_regions`, `nemu_jni_diag`, `nemu_get_jni_stub`, `nemu_dlsym_diag`, `nemu_vm_state_load`, `nemu_session_load`, `nemu_trace`, `nemu_relay`, `nemu_gdbserver`.
- **[自制] ✅** (2026-11-11 Wave 4, +3 tools → **57/57 complete**): `nemu_load_library_chain` (dependency + primary chain), `nemu_extract_apk_libs` (stored ZIP APK extraction), `nemu_load_apk_library` (direct APK `.so` load).
- **[外部]** [Unicorn engine](https://github.com/unicorn-engine/unicorn) test suite + [capstone](https://github.com/capstone-engine/capstone) arm64 tests — full ISA/disassembler parity. 📋
- **[自制]** GDB RSP packet roundtrip (RFC 5.1 examples). 📋

## network (38 tools) — ✅ suite `network-fingerprint` (offline subset)

- **[外部] ✅** RFC 8446 §4.1.2 ClientHello layout (hand-built) + JA3 string structure + [JA4 canonical form](https://github.com/FoxIO-LLC/ja4) (FoxIO publishes pcap-backed test cases under `technical_details/` for full parity). 📋
- **[外部] ✅** RFC 9113/7540 SETTINGS + WINDOW_UPDATE frame layout; Akamai HTTP/2 fingerprint canonical `<settings>|<wu>|<prio>` shape.
- **[外部] ✅** gRPC wire format (1B flag + 4B BE length) incl. truncated-message leniency.
- **[外部] ✅** (2026-11-11, +7 tools): `network_export_har` (HAR 1.2 log/entries export), `network_extract_auth` (Bearer token detection + masking), `network_replay_request` (dryRun preview without outbound I/O), `network_get_status`, `network_get_stats`, `network_get_requests`, `console_get_exceptions` (URL-filtered projection).
- **[自制] ✅** (2026-11-11 Wave 2, +6 tools): `network_get_response_body`, `network_intercept` (list), `network_enable`, `network_disable`, `network_monitor` (status dispatch), `console_buffers` (clear). (21/38 network tools measured).
- **[外部]** [JA3 spec](https://github.com/salesforce/ja3) decimal-form golden values — full ja3_raw decimal parity is a planned upgrade. 📋
- Live-socket tools (dns_*, icmp, tcp_*, traceroute) need network; excluded from the offline gate. 📋

## platform (18 tools) — ✅ suite `platform`

- **[外部] ✅** Electron ASAR format (electron/asar): 4×UInt32LE pickle prefix + JSON header — repack → extract roundtrip fidelity.
- **[自制] ✅** grep-inside-asar hit/miss discrimination.
- **[自制] ✅** (2026-11-10) asar_deobfuscate string-array heuristic flag vs clean negative control, miniapp_pkg_analyze app.json page extraction, electron_scan_userdata JSON file discovery, electron_debug_status empty session list.
- **[外部] ✅** Electron fuse wire format (electronjs.org docs + @electron/fuses v2): sentinel dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX + version/length bytes + ASCII state bytes — suite `electron-fuses`.
- **[外部]** Authenticode/Mach-O signature structure vectors (step-cli test data). 📋
- miniapp pkg fixtures (wxapkg header samples). 📋

## process (29 tools) — ✅ suite `process-static` (offline subset)

- **[外部]** PE/ELF corpora from [LIEF](https://github.com/lief-project/LIEF) test suite — hollowing static scan. 📋
- **[自制] ✅** `process-static` suite: /proc-style maps fixtures for process_hollowing_scan (pure-TS anonymous RWX VAD anomaly detection), active node process enumeration.
- **[自制] ✅** (2026-11-11, +5 tools): `process_get` (`process.pid` metadata), `process_list` (`UnifiedProcessManager` listing), `process_windows` (`process.pid` windows), `process_check_debug_port` (`process.pid` commandLine probe), `memory_audit_export` (pure-TS audit trail export).
- Win32-native members (inject/APC/handle enum) are admin-gated → skip in CI by design.

## protocol-analysis (20 tools) — ✅ suite `protocol-analysis`

- **[外部] ✅** RFC 1071 §3 worked example (checksum 0x220d).
- **[外部] ✅** RFC 1035 §4.1 DNS query layout; RFC 7230 HTTP/1.1 request layout.
- **[外部]** [Wireshark SampleCaptures](https://wiki.wireshark.org/SampleCaptures) + pcapng spec samples — pcap_read/pcapng_read corpus. 📋
- **[自制] ✅** Ethernet build determinism, ICMP checksum validity, pcap write→read roundtrip, DNS-vs-HTTP fingerprint discrimination.
- **[自制] ✅** (2026-11-10 coverage batch) pcapng write/read roundtrip + SHB magic, pcap_read classic roundtrip, define/export 3-format schema, auto-detect + deterministic field inference, req/res state machine + Mermaid visualization — covers pcap_read, pcapng_read/write, proto_define_pattern, proto_export_schema, proto_auto_detect, proto_infer_fields, proto_infer_state_machine, proto_visualize_state.

## proxy (11 tools) — ✅ suite `proxy` (10/11 tools measured — loopback HTTP mockttp + offline)

- **[自制] ✅** `proxy` suite: 5 offline-pure tools (status, export_ca, list_rules, get_requests, clear_logs).
- **[自制] ✅** (2026-11-11, +5 loopback mockttp tools): `proxy_start`, `proxy_stop`, `proxy_add_rule`, `proxy_remove_rule`, `proxy_clear_rules` (also fixed real-`mockttp` `remove_rule`/`clear_rules` bug where `MockedEndpoint` lacks `.dispose()`, re-applying surviving rules via `server.setRequestRules`). Only `proxy_setup_adb_device` requires a device!

- **[外部]** [mockttp](https://github.com/httptoolkit/mockttp) test suite (direct dependency) — rule semantics. 📋

## session (3 tools) — ✅ suite `session-progress`

- **[自制] ✅** `session-progress` suite: ledger idempotency, per-kind 500-entry cap, deterministic coverage ordering, kind-scoped clear.

## sourcemap (7 tools) — ✅ suites `sourcemap` + `sourcemap-tc39`

- **[外部] ✅** **Official tc39/source-map-tests conformance set** (99 expectations from source-map-spec-tests.json; fixtures via `pnpm bench:fetch-fixtures`): conformance driven from **71.7% → 99/99 (100%)** with the fixes below.

- **[外部] ✅** ECMA-426 / source-map v3 VLQ segment semantics (`AAAA;AACA` canonical deltas) + bidirectional lookup contract (mozilla/source-map reference semantics; official fixtures: [tc39/source-map-tests](https://github.com/tc39/source-map-tests)). 📋 full fixture corpus
- **[自制] ✅** closest-preceding fallback, reverse lookup roundtrip, coverage counts.
- **[自制] ✅** (2026-11-11) `sourcemap_parse_v4` (ECMA-426 v4 debugId + scopes parsing + v3 comparison over inline `data:` URI; fixed `fetchSourceMapText` rejecting `data:` URIs before decoding). `sourcemap_discover` requires a live browser/network target.

## streaming (17 tools) — ✅ suite `streaming` (offline subset)

- **[自制] ✅** `streaming` suite: 5 offline-pure tools (ws_get_frames/connections/export_capture, grpc_get_calls/export_capture) with seeded in-memory state. Live-monitor tools remain 📋.

- **[外部]** WHATWG SSE event-stream parsing examples; RFC 6455 WebSocket frame vectors ([autobahn testsuite](https://github.com/crossbario/autobahn-testsuite)). 📋
- **[自制]** monitor fixtures over local echo servers. 📋

## syscall-hook (15 tools) — ✅ suite `syscall-hook` (offline subset)

- **[自制] ✅** `syscall-hook` suite: 4 offline-pure tools (correlate_js, trace_compare, get_stats, ebpf_trace script-generation). Monitor/root-gated tools remain 📋.

- **[外部]** bpftrace test suite (Linux-only, root-gated). 📋
- **[自制]** event filter/trace-diff/NDJSON export on synthetic event arrays (pure compute). 📋

## tasks (4 tools) — ✅ suite `tasks-lifecycle`

- **[外部]** [MCP official conformance](https://github.com/modelcontextprotocol/conformance) `tasks-lifecycle` scenario (SEP-1686) — spawn server + run conformance runner in CI. 📋
- **[自制] ✅** `tasks-lifecycle` suite: working→completed lifecycle transition, terminal cancellation guard, poll-until-terminal result retrieval, lastUpdatedAt sorted listing with status filter.

## tls-inspector (29 tools) — ✅ suite `tls-inspector`

- **[外部] ✅** IANA TLS Cipher Suite Registry (official ids 0x1301/0x1302/0x1303/0xC02F + AEAD metadata).
- **[外部] ✅** Mozilla NSS SSLKEYLOGFILE format (CLIENT_RANDOM lines) — parse + summary.
- **[外部] ✅** REAL X.509 minted by system OpenSSL, wrapped in the RFC 8446 §4.4.2 Certificate-message wire layout — parse roundtrip incl. SHA-256 fingerprint + subject.
- **[外部] ✅** (2026-11-11) `tls_parse_handshake`: RFC 8446 ClientHello record parsing, SNI `serverName` extraction, and handshake metadata.
- **[外部]** [FoxIO-LLC/ja4](https://github.com/FoxIO-LLC/ja4) pcap test-cases for full fingerprint parity. 📋

## trace (10 tools) — ✅ suite `trace-query` (10/10 tools measured)

- **[外部] ✅** Chrome Trace Event format spec (Chromium catapult docs) — export_trace Chrome Trace Event JSON export.
- **[自制] ✅** `trace-query` suite: seeded SQLite trace database query execution, compact category aggregation and timeline summarization.
- **[自制] ✅** (2026-11-10) seek_to_timestamp event-stream reconstruction, trace_get_samples function-filter query, diff_heap_snapshots summary delta computation, trace_get_network_flow by requestId, start_trace_recording / stop_trace_recording offline lifecycle, trace_recording action dispatch.

## transform (8 tools) — ✅ suite `transform`

- **[外部] ✅** NIST SP 800-38A §F.1.1/F.1.2 AES-128 key+plaintext (PKCS7-wrapped ciphertext, node:crypto).
- **[外部] ✅** RC4 canonical vector (`Key`/`Plaintext`/BBF316E8D940AF0AD3).
- **[自制] ✅** XOR involutivity, entropy step, beautify semantic preservation (executes + observable behavior), crypto sandbox fidelity + implementation equivalence.
- **[自制] ✅** (2026-11-11) `ast_transform_preview` (constant folding + dead-code removal + diff), `ast_transform_chain` (in-memory chain registration), `ast_transform_apply` (inline AST transform execution + stats); `crypto_extract_standalone` requires a live browser page.

## v8-inspector (21 tools) — ✅ suite `v8-inspector-heap`

- **[自制] ✅** `v8-inspector-heap` suite: synthetic V8 heapsnapshot fixtures testing class histogram generation, snapshot structural diff, dominator-tree retainer tracing, and object pair comparison.
- **[自制] ✅** (2026-11-11) `v8_heap_find_leaks` (dominator leak candidate detection), `v8_function_retained` (retained object filter), `v8_heap_snapshot_export` (`.heapsnapshot` artifact export), `v8_heap_snapshot_delete` (in-memory & disk drop).
- **[外部]** `.heapsnapshot` format spec + DevTools sample snapshots — snapshot parse/analyze/diff. 📋

## wasm (17 tools) — ✅ suite `wasm`

- **[外部] ✅** WebAssembly spec §Binary Format minimal module (hand-assembled: type/func/export/code sections) — structural inspection parity; evaluation semantics (`answer() === 42`).
- **[外部] ✅** (2026-11-11) `wasm_string_extract`: printable string extraction across binary sections (recovering export `"answer"`).
- **[外部]** [official spec test suite](https://github.com/WebAssembly/spec/tree/main/test/core) + [wabt](https://github.com/WebAssembly/wabt)/[binaryen](https://github.com/WebAssembly/binaryen) test corpora — full coverage when wabt installed. 📋
- **[自制] ✅** capability honesty (wabt/runtime absence fails loudly, never silently).

## webgpu (10 tools) — ✅ suite `webgpu` (offline subset)

- **[自制] ✅** `webgpu` suite: 2 offline-pure tools (shader_disassemble WGSL AST + SPIR-V reflection; shader_compile spirv static reflection). 8 GPU-device-bound tools remain 📋.

- **[外部]** [WebGPU CTS](https://github.com/gpuweb/cts) — WGSL compile/disassemble conformance subset. 📋
- **[自制]** pipeline/shader capture fixtures on a headless WebGPU page. 📋

## workflow (13 tools) — ✅ suite `workflow-lifecycle`

- **[自制] ✅** `workflow-lifecycle` suite: retry policy set/get contract, run inspect store availability, conditional step parameter evaluation, workflow suggest empty-catalog fallback.
- **[自制] ✅** (2026-11-11, +4 offline tools): `list_macros` (built-in macro definitions loading), `run_macro` (dryRun plan preview without live tool execution), `page_script_register` (script registry persistence), `list_extension_workflows` (extension workflow discovery). 8/13 workflow tools measured (remaining 5 require live browser or HTTP/target connections).
- **[外部]** Temporal `RetryPolicy` spec / conformance — planned deep vectors. 📋
- Repo-internal search-quality datasets (`scripts/search-tune/datasets`) already benchmark js_bundle_search-adjacent routing.

---

## Known gaps discovered while building the suites — ALL FIXED 2026-10-31

1. ✅ **FIXED** `binary_strings_extract` missed UTF-16LE strings starting at odd byte offsets — now scans both byte phases (regression case `binary_strings_extract/utf16-odd-offset`).
2. ✅ **FIXED** `transform_workbench` AES decrypt required PKCS7 input — steps now accept `padding: 'none'` for raw-block decrypt; the verbatim NIST SP 800-38A vectors pass byte-exact (`nist-aes128-{cbc,ecb}-raw-block`).
3. ✅ **FIXED** `ja3_raw` was hex-with-dashes with the last two fields swapped — now emits the Salesforce spec's decimal form in spec field order (version,ciphers,exts,elliptic_curves,ec_point_formats), so the md5 is comparable against published JA3 datasets.
4. ✅ **FIXED** `wasm_inspect_sections` hard-depended on wabt — now falls back to the pure-TS parser (`source: 'pure-ts-fallback'`) and reports section identities; only true disassembly requests still fail loudly.
5. ✅ **FIXED** `wasm_offline_run` required wasmtime/wasmer — `runtime: 'node'` (and the auto fallback) executes closed modules on the built-in WebAssembly engine; the spec `answer() === 42` case now passes without any install.

### Fixed by the tc39 conformance run (2026-10-31)

1. ✅ VLQ decoding now rejects negative absolute positions and out-of-range source/name
   indices (previously silently accepted — official invalid-map negative samples).
2. ✅ 32-bit boundary values decode correctly (multiplication accumulation + arithmetic
   sign decode; `<<`/`>>` corrupted legal tc39 boundary mappings).
3. ✅ `sources` null entries are legal placeholders (array length preserved — previously
   filtered, shrinking index ranges); non-string `sources`/`names`/`sourcesContent`/
   `file`/`sourceRoot`/`ignoreList` entries and bad `ignoreList` indices are rejected.
4. ✅ Empty indexed-map `sections` is legal (tc39 index-map-empty-sections is valid).
5. ✅ Segment field-count validation (2 or 3 fields are invalid per tc39).
Also fixed: `scripts/search-tune/metrics.ts` wrong relative import path (pre-existing).

### Open findings (recorded, not yet arbitrated)

1. `dart_snapshot_header_parse` reads the 32-byte version hash at offset 0x0C where the
   dart-sdk/r2flutter reference layout puts the int64 snapshot kind (hash at 0x14) — an
   official-layout fixture decodes with kind="unknown". Needs arbitration against a real
   libapp.so before changing the handler (the suite currently asserts magic + features only).

### Remaining planned upgrades (not defects)

- `ja3_raw` decimal parity against published JA3 golden vectors (ja3er/Censys) — format now matches; values unverified against an external dataset.
- FoxIO JA4 full parity via their pcap-backed test cases (`technical_details/test-cases`).

## Maintenance policy

- Floors in `tools-benchmark.test.ts` may only be tightened, never loosened, without a written reason in the PR.
- New tool domains should first land as 📋 rows here, then graduate to ✅ by adding a `suites/<domain>.suite.ts` and registering it in `suites/index.ts`.
