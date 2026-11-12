# Autoresearch Dashboard: per-tool-quality-debt

**Runs:** 77 / 200 | **Kept:** 70 | **Discarded:** 1 | **Crashed:** 6 | **Checks-failed:** 0
**Best:** debt=51 (run #77, f450f08) | **Baseline:** debt=616 (run #1) — debtΔ -565
**Noise floor:** 0 (harness deterministic)
**Note:** debt2 == extractor debt (constant +51 low_mrr offset); comparisons delta-based.

| # | commit | debt | Δ vs best | status | op | description |
|---|--------|------|-----------|--------|----|-------------|
| 1 | 0956cc0 | 616 | 227 | keep |  | baseline: 565 unmeasured + 51 low_mrr + 0 vector_fail |
| 2 | 0956cc0 | 616 | 227 | crash | draft | protocol-analysis coverage batch: +9 cases, 4 fail (2 handler bugs: au |
| 3 | 4635b63 | 607 | 218 | keep | draft | protocol-analysis coverage batch: +9 cases all pass (fix: no-arg handl |
| 4 | 4635b63 | 607 | 218 | crash | draft | mojo-ipc suite v1: *Tool wrappers return content-wrapped ToolResponses |
| 5 | b793cb8 | 603 | 214 | keep | debug | mojo-ipc suite v2 (raw internal handlers, flattened caps keys, seeded/ |
| 6 | 3ba21fb | 599 | 210 | keep | draft | platform coverage batch: +4 cases (asar_deobfuscate, miniapp_pkg_analy |
| 7 | b0e683f | 591 | 202 | keep | draft | trace coverage batch: +8 cases (seek_to_timestamp, export_trace, trace |
| 8 | 9b3c34c | 586 | 197 | keep | draft | core-analysis coverage batch: +5 cases (detect_crypto, analysis_decode |
| 9 | 9ebb485 | 583 | 194 | keep | draft | transform coverage batch: +3 cases (ast_transform_preview, ast_transfo |
| 10 | 9ebb485 | 583 | 194 | crash | draft | cross-domain suite v1: addNode returns EvidenceNode (not string id) +  |
| 11 | 46ddb76 | 579 | 190 | keep | debug | cross-domain completion batch: +4 cases (suggest_workflow, evidence_st |
| 12 | f7cb2bb | 577 | 188 | keep | draft | coordination coverage batch: +2 cases (complete_task_handoff, list_pag |
| 13 | c7a5190 | 567 | 178 | keep | draft | exploit-dev coverage batch: +10 cases (cache_* x4, find_gadgets, find_ |
| 14 | c7a5190 | 567 | 178 | crash | draft | sourcemap_parse_v4 data: URI test exposed real handler bug: fetchSourc |
| 15 | 6e0ee37 | 566 | 177 | keep | debug | fix(sourcemap): decode data: URIs in fetchSourceMapText + sourcemap_pa |
| 16 | 801e2e9 | 561 | 172 | keep | draft | dart-inspector coverage batch: +5 cases (strings_extract, packages_det |
| 17 | abc0354 | 560 | 171 | keep | draft | wasm coverage batch: wasm_string_extract (+1 case); debt 561->560 |
| 18 | 70d1150 | 553 | 164 | keep | draft | maintenance coverage batch: +7 cases (clear_all_caches, smart_cache_cl |
| 19 | 4b1ff28 | 549 | 160 | keep | draft | v8-inspector heap coverage batch: +4 cases (heap_find_leaks, function_ |
| 20 | 445993d | 534 | 145 | keep | draft | new native-emulator suite: +15 cases (session/ELF/add_two=42/memory/JN |
| 21 | 2f2fda3 | 516 | 127 | keep | draft | fix(native-emulator): handleRegsRestore empty-filter bug + Wave 2 (+18 |
| 22 | e0d8bd7 | 498 | 109 | keep | draft | native-emulator Wave 3 (+18 cases): imports/GOT, JNI/Java, TLS, host s |
| 23 | dedd847 | 495 | 106 | keep | draft | native-emulator Wave 4 (+3 cases): nemu_load_library_chain, nemu_extra |
| 24 | 4a6ee51 | 482 | 93 | keep | draft | binary-instrument offline batch (+13 cases): APK/DEX triage, manifest, |
| 25 | aa59b04 | 474 | 85 | keep | draft | core-analysis Wave 2 (+8 cases): understand_code, pipeline, symbolic,  |
| 26 | aa59b04 | 474 | 85 | crash | draft | workflow batch v1: list_macros/run_macro live on MacroToolHandlers, no |
| 27 | 3a5faf5 | 470 | 81 | keep | debug | workflow batch (+4 cases): list_macros, run_macro, page_script_registe |
| 28 | 40e57c6 | 463 | 74 | keep | draft | network offline batch (+7 cases): status, stats, requests, extract_aut |
| 29 | 052b1b2 | 462 | 73 | keep | draft | tls-inspector: +1 case (tls_parse_handshake ClientHello SNI); debt 463 |
| 30 | e678393 | 455 | 66 | keep | draft | memory-pure-ts offline batch (+7 cases): parse_dump, assemble, bookmar |
| 31 | feb28d8 | 450 | 61 | keep | draft | process-static batch (+5 cases): process_get, process_list, process_wi |
| 32 | feb28d8 | 450 | 61 | crash | draft | proxy loopback batch v1 exposed REAL BUG: mockttp 4.4.2 MockedEndpoint |
| 33 | b32b839 | 445 | 56 | keep | debug | fix(proxy): real mockttp rule removal via setRequestRules + 5 loopback |
| 34 | 36ecd26 | 440 | 51 | keep | draft | offline-tools browser batch (+5 cases): jsdom_execute, get_detailed_da |
| 35 | 36ecd26 | 440 | 51 | discard | draft | misc-residual convert jsdom_serialize/cookies skips to live: shortfall |
| 36 | 6e530e2 | 434 | 45 | keep | draft | network Wave 2 (+6 cases): get_response_body, intercept(list), enable, |
| 37 | 618cb15 | 431 | 42 | keep | draft | maintenance batch (+3 cases): execute_sandbox_script, list_extensions, |
| 38 | f2c7830 | 425 | 36 | keep | draft | platform Wave 2 (+6 cases): patch_fuses, verify_integrity, verify_sign |
| 39 | 0fd1c89 | 420 | 31 | keep | draft | tls-inspector-full (+5 cases): keylog_enable, tcp_open, tcp_write, tcp |
| 40 | a44a63b | 417 | 28 | keep | draft | new debugger-blackbox suite (+3 cases): blackbox_add, blackbox_add_com |
| 41 | e39eda1 | 412 | 23 | keep | draft | tls-inspector-full Wave 2 (+5 loopback TLS cases): tls_probe_endpoint, |
| 42 | 8200e69 | 408 | 19 | keep | draft | tls-inspector WebSocket batch (+4 cases): websocket_open/send_frame/re |
| 43 | 2fc39b1 | 406 | 17 | keep | draft | exploit-dev jop_chain + v8-inspector turbofan_graph traceDir (+2 cases |
| 44 | 1946d7b | 405 | 16 | keep | draft | extension-registry webhook batch (+3 cases): create, list+delete, sign |
| 45 | 5708926 | 404 | 15 | keep | draft | exploit_encode_shellcode XOR (+1 case) + session.suite.ts 1ms clock fl |
| 46 | fa7c852 | 402 | 13 | keep | draft | REAL BUG #4: captcha_config stale-snapshot read-back fixed via live ge |
| 47 | fa7c852 | 401 | 12 | keep | draft | network dns_resolve (+1 case): RFC 1035 A query against minimal loopba |
| 48 | 15f076e | 398 | 9 | keep | draft | network DNS stack (+3 cases): dns_probe NOERROR/NODATA, dns_cname_chai |
| 49 | ebe42fe | 395 | 6 | keep | draft | syscall-hook (+4 pure handlers): filter invalid-names + idle honesty,  |
| 50 | a984241 | 392 | 3 | keep | draft | network loopback probes (+3 cases): http_plain_request 200 roundtrip,  |
| 51 | 3ed780e | 389 | 2 | keep | draft | v8-inspector honest-unavailable batch (+3 cases): wasm_inspect no-page |
| 52 | 207578e | 387 | 8 | keep | draft | browser storage handlers (+4 cases): local_storage roundtrip + empty-key reject, session_storage get, storage_info estimate |
| 53 | 940dfaf | 379 | 10 | keep | draft | webgpu honest-unavailable batch (+8 cases): no-page explicit failure + arg-schema validation — webgpu 10/10 |
| 54 | e521cde | 369 | 11 | keep | draft | canvas host-side batch (+10 cases): scripted page substrate — canvas 11/11 (incl. skia) |
| 55 | 50a7e96 | 358 | 12 | keep | draft | browser host-side batch (+11 cases): status/tabs/workers/console/scripts/codegen/page_back — browser 27/85 |
| 56 | c87972f | 346 | 26 | keep | draft | wasm wave 2 (+12 cases): hook-state stub + runs-or-names-missing-binary contracts — wasm 17/17 |
| 57 | 793b55b | 320 | 12 | keep | draft | binary-instrument toolchain contracts (+21 cases): arg-rejection, unknown-session refusal, honest toolchain errors — 44/46 |
| 58 | 50e7ddf | 308 | 0 | keep | draft | streaming monitor contracts (+13 cases): enable/disable reporting + not-enabled refusals + API-missing honesty — streaming 17/17 |
| 59 | bc700f9 | 308 | 18 | keep | debug | REAL BUGS #5-#7: Win32 suspend/resume quoting, resumeProcess silent swallow, killProcess false success (+tests) |
| 60 | 1a27849 | 290 | 60 | keep | draft | process contract batch (+20 cases) + REAL BUG #8 (spawn ENOENT crashed the server) — process 26/29 |
| 61 | 797bebf | 230 | 18 | keep | draft | memory contract batch (+53 cases via real manifest bindings) — memory 72/75 |
| 62 | eb72573 | 212 | 21 | keep | draft | debugger contract batch (+21 cases): stub-manager admissions/dispatch + antidebug detect/bypass — debugger 21/21 |
| 63 | 8be082c | 191 | 10 | keep | draft | adb-bridge contract batch (+26 cases): arg-rejection table + unreachable-device honesty — adb-bridge 26/26 |
| 64 | 562ae96 | 181 | 9 | keep | draft | network contract batch (+14 cases): dispatch/admission + loopback echo/traceroute honesty — network 38/38 |
| 65 | 0d87d13 | 172 | 8 | keep | draft | dart-inspector session contracts (+9 cases): admission table — dart-inspector 16/16 |
| 66 | e07f2ee | 164 | 7 | keep | draft | syscall-hook backend contracts (+8 cases): backend validation + idle honesty + SSN/stub — syscall-hook 15/15 |
| 67 | 2358ca3 | 157 | 7 | keep | draft | NEW graphql suite (+13 cases): page prerequisites + SSRF gate + arg rejections — graphql 7/7 (last zero-coverage domain) |
| 68 | 14c7b94 | 150 | 6 | keep | draft | v8-inspector honest-unavailable batch (+7 cases): PageController refusals + forbidden-payload checks — v8 21/21 |
| 69 | 84b7cc2 | 144 | 8 | keep | draft | core-analysis argument contracts (+6 cases): url/ScriptManager/scriptId/action/vulnerability refusals — core 25/25 |
| 70 | f433bcb | 136 | 4 | keep | draft | small-domain batch (+9): mojo stub honesty, native-bridge action/enum/availability, platform electron — 3 domains to 100% |
| 71 | 7a09e0d | 132 | 7 | keep | draft | instrumentation hook contracts (+4): ai_hook/preset/sessionId — instrumentation 13/13 |
| 72 | f490b3c | 125 | 2 | keep | draft | workflow + maintenance contracts (+7): arg/gating + real catalog — workflow 13/13, maintenance 17/17 |
| 73 | b227dcb | 123 | 8 | keep | draft | coordination snapshot contracts (+3): page-controller refusal + not-found echo — coordination 12/12 |
| 74 | a07b742 | 115 | 59 | keep | draft | tail contracts (+8): process/proxy/sourcemap/transform/binary-instrument — only 59 browser + 5 memory gates left |
| 75 | 8b0cf28 | 56 | — | keep | draft | NEW browser suite (+59): Proxy PrerequisiteError substrate + arg validation — 731/736 (99.3%) measured |
| 76 | fb22546 | 56 | 5 | keep | debug | campaign closeout: CATALOG + ideas file (5 Win32 gates need a decision, koffi defect recorded) |
| 77 | f450f08 | 51 | — | keep | draft | Route A: real Win32 engines wired + 9 contracts — **736/736 measured (100%)**; debt now purely low_mrr |
