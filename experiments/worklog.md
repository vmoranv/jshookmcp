# Worklog — per-tool quality debt

## Session setup (2026-11-10)

- Goal: close measurable per-tool quality gaps scored by `pnpm bench:tools` +
  retrieval-metrics eval.
- Baseline audit: 565/736 tools unmeasured, 51/114 low-MRR (<0.6, 5 at 0.0),
  gate vector_fail = 0, per_tool_shortfall = 12 (9 env-gated skips + 3 partial
  re-execution failures).
- Harness: `./autoresearch.sh` = retrieval test (~2s) + bench:tools (~12s) +
  metric extraction. Primary `debt = unmeasured + low_mrr + vector_fail`.
- Branch: `autoresearch/per-tool-quality-20261110`.

> NOTE (2026-11-12): the original per-run worklog entries for runs 1–41 were lost
> when unstaged state files (`autoresearch.jsonl`, dashboard, this file) were
> restored from HEAD — they had never been committed after run 5. The full
> per-run record was rebuilt from session records into `autoresearch.jsonl`;
> the condensed log below is derived from it. Lesson applied: state files are
> now committed together with each keep.

### Runs 1–41 condensed log (full metrics in autoresearch.jsonl)

- Run 1 (keep, 616): baseline. 565 unmeasured + 51 low_mrr + 0 vector_fail.
  slowest_ms jitters (process_find cold PowerShell spawn) — throughput stays secondary.
- Run 2 (crash) → Run 3 (keep, 607): protocol-analysis +9 offline cases; fixed no-arg
  handler ctor binding `{}` to engine param and spec types (int, not uint16/uint32).
- Run 4 (crash) → Run 5 (keep, 603): new mojo-ipc suite (4 cases); invoke raw internal
  handlers, not *Tool wrappers (harness body() unwraps only the top level).
- Run 6 (keep, 599): platform +4 (asar_deobfuscate, miniapp_pkg_analyze,
  electron_scan_userdata, electron_debug_status).
- Run 7 (keep, 591): trace +8 → 10/10 domain measured (seek/export/samples/diff/flow/
  start/stop/recording facade).
- Run 8 (keep, 586): core-analysis +5 (detect_crypto, decode_string_array,
  deflat_control_flow, collection stats/clear).
- Run 9 (keep, 583): transform +3 (ast_transform_preview/chain/apply).
- Run 10 (crash) → Run 11 (keep, 579): cross-domain +4 → 8/8 domain measured
  (suggest_workflow, evidence_stats/query, correlate_all). addNode returns EvidenceNode.
- Run 12 (keep, 577): coordination +2 (complete_task_handoff, list_page_snapshots).
- Run 13 (keep, 567): exploit-dev +10 (cache×4, find_gadgets, find_jmp_esp,
  build_rop_chain, build_stack_pivot, analyze_mitigations, verify_rop_chain).
  handleBuildStackPivot returns `pivotGadgets`.
- Run 14 (crash) → Run 15 (keep, 566): REAL BUG #1 — `fetchSourceMapText` rejected
  `data:` URIs ("unsupported protocol"); fixed to decode before validateFetchUrl;
  + sourcemap_parse_v4 case (281 sourcemap unit tests still green).
- Run 16 (keep, 561): dart-inspector +5 (strings/packages/symbolize/fingerprint/pool)
  using committed tiny-libapp.so / packages-libapp.so fixtures.
- Run 17 (keep, 560): wasm +1 (wasm_string_extract, recovers export "answer").
- Run 18 (keep, 553): maintenance +7 (caches, cleanup_artifacts dryRun, doctor,
  snapshot_create/list/restore shadow-git).
- Run 19 (keep, 549): v8-inspector +4 (find_leaks, function_retained, snapshot
  export/delete; export returns absolutePath).
- Run 20 (keep, 534): NEW native-emulator suite +15 (session lifecycle, ELF load,
  call_symbol add_two(40,2)=42, guest memory, JNI byte arrays/handles, Java mock).
- Run 21 (keep, 516): REAL BUG #2 — `nemu_regs_restore` treated omitted `regs` as an
  empty allowlist and restored 0 registers; fixed `regFilter.length > 0`;
  +18 Wave-2 cases (call_address, mem_map, scan, xor, patch, data_dump, frame,
  pointer_chain, mem_inspect, bytecode_scan, registers, vtable, vm_state, pac_key).
- Run 22 (keep, 498): native-emulator Wave 3 +18 (imports/GOT, TLS, mem_shadow,
  host fn stubs, call_jni_export Java_bench_add(40,2)=42, java mocks/field,
  write_regions, diags, vm_state_load, session_load, trace, relay, gdbserver).
- Run 23 (keep, 495): native-emulator Wave 4 +3 → 57/57 domain complete (100%)
  (load_library_chain, extract_apk_libs, load_apk_library via stored-ZIP APK).
- Run 24 (keep, 482): binary-instrument +13 (capabilities, plugins, frida sessions/
  script gen, generate/export hooks, apk native libs, manifest dump/query, static
  triage, dex intake, signing block, key extract) via synthetic stored-ZIP APK +
  32B high-entropy key blob.
- Run 25 (keep, 474): core-analysis Wave 2 +8 (understand_code, deobfuscate_pipeline,
  symbolic, symbolic_jsvmp, deobfuscate packer, webcrack_unpack, analyze_vm,
  deobfuscate_jsvmp detectOnly). 19/25 core measured.
- Run 26 (crash) → Run 27 (keep, 470): workflow +4 (list_macros, run_macro dryRun,
  page_script_register, list_extension_workflows). Macros live on MacroToolHandlers.
- Run 28 (keep, 463): network +7 (status/stats/requests/extract_auth masking/
  export_har HAR1.2/replay dryRun/console_get_exceptions).
- Run 29 (keep, 462): tls-inspector +1 (tls_parse_handshake ClientHello SNI).
- Run 30 (keep, 455): memory-pure-ts +7 (parse_dump MDMP, assemble nop;ret=90c3,
  bookmark, register/list/unregister_type, scan_session list). Surfaced a 1ms
  wall-clock ordering flake in session.suite.ts (documented, not yet hardened).
- Run 31 (keep, 450): process +5 (process_get/list/windows/check_debug_port self-pid,
  memory_audit_export). unmeasured < 400 (399).
- Run 32 (crash) → Run 33 (keep, 445): REAL BUG #3 — `proxy_remove_rule` always
  failed and `proxy_clear_rules` silently left rules active on real mockttp
  (MockedEndpoint has no `.dispose()`; unit tests had mocked one). Fixed via
  `removeRulesFromMockttp` re-applying surviving rules through
  `server.setRequestRules(...)`; +5 loopback proxy cases (start/stop/add/remove/clear).
- Run 34 (keep, 440): offline-tools browser +5 (jsdom_execute QuickJS sandbox,
  get_detailed_data, get_offloaded_data, stealth_generate_fingerprint,
  captcha_solver_capabilities). `DetailedDataManager.store` is async; sandbox code
  is an expression (no top-level `return`).
- Run 35 (discard, 440): converting misc-residual jsdom skips to live improved
  per_tool_shortfall (12→10) but not debt — skips were already counted in
  withVectors. Cookie field is `key` (tough-cookie), not `name`.
- Run 36 (keep, 434): network Wave 2 +6 (response_body, intercept list, enable,
  disable, monitor status dispatch, console_buffers clear). 21/38 network measured.
- Run 37 (keep, 431): maintenance +3 (execute_sandbox_script QuickJS, list/reload
  extensions via real ExtensionManager after `initRegistry()`). 16/17 measured (94.1%).
- Run 38 (keep, 425): platform Wave 2 +6 (patch_fuses, verify_integrity SHA-256 ASAR
  full-file match, verify_signature unsigned, miniapp_pkg_scan/unpack 0xBE..0xED,
  v8_bytecode_decompile via real node:vm cachedData). 16/18 measured (88.9%).
- Run 39 (keep, 420): tls-inspector-full +5 (keylog_enable SSLKEYLOGFILE +
  browser flag, loopback tcp_open/write/read_until/close).
- Run 40 (keep, 417): NEW debugger-blackbox suite +3 (blackbox_add wildcard
  normalization, add_common 13 vendor presets, blackbox_list) → 370/736 = 50.3%
  of the repo measured. Graduates debugger from 📋 to ✅.
- Run 41 (keep, 412): tls-inspector-full Wave 2 +5 loopback TLS cases
  (tls_probe_endpoint, tls_open, tls_write, tls_read_until, tls_close) via OpenSSL
  self-signed cert. 25/29 TLS inspector measured. Cumulative debt −204 from baseline.

## Key Insights

- Raw internal handlers (not `*Tool` wrappers) must be invoked when a case composes
  nested responses — the harness `body()` only unwraps the top level.
- Testing against REAL dependencies (mockttp, node:vm cachedData, OpenSSL, loopback
  sockets) catches bugs that unit-test mocks structurally hide (3 found so far).
- Omitted-argument defaults are high-value vector targets (`nemu_regs_restore`).
- Debt-reducing work must target tools with `correctness = "—"`; converting skips
  only improves secondary metrics.
- Commit state files (`autoresearch.jsonl`, dashboard, worklog) together with each
  keep — unstaged appends were lost once on a `git checkout HEAD --`.

## Next Ideas

- Run 42: finish tls-inspector WebSocket tools (`websocket_open`, `websocket_send_frame`,
  `websocket_read_frame`, `websocket_close`) against a minimal loopback RFC 6455
  HTTP-upgrade echo server → 29/29 (100% of tls-inspector).
- `exploit-dev`: `exploit_build_jop_chain`.
- `v8-inspector`: `v8_turbofan_graph` traceDir mode.
- `extension-registry`: `webhook`.
- Harden `session.suite.ts` 1ms wall-clock ordering flake.

### Run 42: tls-inspector WebSocket batch (+4 cases) — debt 412→408 (KEEP)
- Timestamp: 2026-11-12
- What changed: added 4 loopback RFC 6455 WebSocket cases to `tls-inspector-full.suite.ts`: websocket_open (HTTP-upgrade handshake with Sec-WebSocket-Accept verification), websocket_send_frame (masked text frame), websocket_read_frame (server un-masks client frame via XOR with 4-byte masking key then echoes unmasked), websocket_close (close frame code 1000, force teardown).
- Result: debt 412→408 (-4, -208 cumulative), unmeasured 361→357, vectors_total 379 (51.5%), vector_fail 0, rejection_pct 100%, checks.sh pass. Suite 23→27 cases @ 100%. **tls-inspector is now 29/29 tools measured (100%)** — 5th domain at 100% coverage.
- Insight: First run returned masked garbage because the test echo server forgot RFC 6455 §5.3 client-to-server masking (XOR payload with the 4-byte key at bytes 2..6). Fixed in the fixture server, second run green.
- Next: `exploit-dev` (`exploit_build_jop_chain`), `v8-inspector` (`v8_turbofan_graph` traceDir), `extension-registry` (`webhook`), or `session.suite.ts` 1ms flake hardening → target `debt < 400`.
