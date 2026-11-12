# Autoresearch Dashboard: per-tool-quality-debt

**Runs:** 45 / 200 | **Kept:** 38 | **Discarded:** 1 | **Crashed:** 6 | **Checks-failed:** 0
**Best:** debt=404 (run #45, 5708926) | **Baseline:** debt=616 (run #1) — debtΔ -212
**Noise floor:** 0 (harness deterministic)
**Note:** debt2 == extractor debt (constant +51 low_mrr offset); comparisons delta-based.

| # | commit | debt | Δ vs best | status | op | description |
|---|--------|------|-----------|--------|----|-------------|
| 1 | 0956cc0 | 616 | 212 | keep |  | baseline: 565 unmeasured + 51 low_mrr + 0 vector_fail |
| 2 | 0956cc0 | 616 | 212 | crash | draft | protocol-analysis coverage batch: +9 cases, 4 fail (2 handler bugs: au |
| 3 | 4635b63 | 607 | 203 | keep | draft | protocol-analysis coverage batch: +9 cases all pass (fix: no-arg handl |
| 4 | 4635b63 | 607 | 203 | crash | draft | mojo-ipc suite v1: *Tool wrappers return content-wrapped ToolResponses |
| 5 | b793cb8 | 603 | 199 | keep | debug | mojo-ipc suite v2 (raw internal handlers, flattened caps keys, seeded/ |
| 6 | 3ba21fb | 599 | 195 | keep | draft | platform coverage batch: +4 cases (asar_deobfuscate, miniapp_pkg_analy |
| 7 | b0e683f | 591 | 187 | keep | draft | trace coverage batch: +8 cases (seek_to_timestamp, export_trace, trace |
| 8 | 9b3c34c | 586 | 182 | keep | draft | core-analysis coverage batch: +5 cases (detect_crypto, analysis_decode |
| 9 | 9ebb485 | 583 | 179 | keep | draft | transform coverage batch: +3 cases (ast_transform_preview, ast_transfo |
| 10 | 9ebb485 | 583 | 179 | crash | draft | cross-domain suite v1: addNode returns EvidenceNode (not string id) +  |
| 11 | 46ddb76 | 579 | 175 | keep | debug | cross-domain completion batch: +4 cases (suggest_workflow, evidence_st |
| 12 | f7cb2bb | 577 | 173 | keep | draft | coordination coverage batch: +2 cases (complete_task_handoff, list_pag |
| 13 | c7a5190 | 567 | 163 | keep | draft | exploit-dev coverage batch: +10 cases (cache_* x4, find_gadgets, find_ |
| 14 | c7a5190 | 567 | 163 | crash | draft | sourcemap_parse_v4 data: URI test exposed real handler bug: fetchSourc |
| 15 | 6e0ee37 | 566 | 162 | keep | debug | fix(sourcemap): decode data: URIs in fetchSourceMapText + sourcemap_pa |
| 16 | 801e2e9 | 561 | 157 | keep | draft | dart-inspector coverage batch: +5 cases (strings_extract, packages_det |
| 17 | abc0354 | 560 | 156 | keep | draft | wasm coverage batch: wasm_string_extract (+1 case); debt 561->560 |
| 18 | 70d1150 | 553 | 149 | keep | draft | maintenance coverage batch: +7 cases (clear_all_caches, smart_cache_cl |
| 19 | 4b1ff28 | 549 | 145 | keep | draft | v8-inspector heap coverage batch: +4 cases (heap_find_leaks, function_ |
| 20 | 445993d | 534 | 130 | keep | draft | new native-emulator suite: +15 cases (session/ELF/add_two=42/memory/JN |
| 21 | 2f2fda3 | 516 | 112 | keep | draft | fix(native-emulator): handleRegsRestore empty-filter bug + Wave 2 (+18 |
| 22 | e0d8bd7 | 498 | 94 | keep | draft | native-emulator Wave 3 (+18 cases): imports/GOT, JNI/Java, TLS, host s |
| 23 | dedd847 | 495 | 91 | keep | draft | native-emulator Wave 4 (+3 cases): nemu_load_library_chain, nemu_extra |
| 24 | 4a6ee51 | 482 | 78 | keep | draft | binary-instrument offline batch (+13 cases): APK/DEX triage, manifest, |
| 25 | aa59b04 | 474 | 70 | keep | draft | core-analysis Wave 2 (+8 cases): understand_code, pipeline, symbolic,  |
| 26 | aa59b04 | 474 | 70 | crash | draft | workflow batch v1: list_macros/run_macro live on MacroToolHandlers, no |
| 27 | 3a5faf5 | 470 | 66 | keep | debug | workflow batch (+4 cases): list_macros, run_macro, page_script_registe |
| 28 | 40e57c6 | 463 | 59 | keep | draft | network offline batch (+7 cases): status, stats, requests, extract_aut |
| 29 | 052b1b2 | 462 | 58 | keep | draft | tls-inspector: +1 case (tls_parse_handshake ClientHello SNI); debt 463 |
| 30 | e678393 | 455 | 51 | keep | draft | memory-pure-ts offline batch (+7 cases): parse_dump, assemble, bookmar |
| 31 | feb28d8 | 450 | 46 | keep | draft | process-static batch (+5 cases): process_get, process_list, process_wi |
| 32 | feb28d8 | 450 | 46 | crash | draft | proxy loopback batch v1 exposed REAL BUG: mockttp 4.4.2 MockedEndpoint |
| 33 | b32b839 | 445 | 41 | keep | debug | fix(proxy): real mockttp rule removal via setRequestRules + 5 loopback |
| 34 | 36ecd26 | 440 | 36 | keep | draft | offline-tools browser batch (+5 cases): jsdom_execute, get_detailed_da |
| 35 | 36ecd26 | 440 | 36 | discard | draft | misc-residual convert jsdom_serialize/cookies skips to live: shortfall |
| 36 | 6e530e2 | 434 | 30 | keep | draft | network Wave 2 (+6 cases): get_response_body, intercept(list), enable, |
| 37 | 618cb15 | 431 | 27 | keep | draft | maintenance batch (+3 cases): execute_sandbox_script, list_extensions, |
| 38 | f2c7830 | 425 | 21 | keep | draft | platform Wave 2 (+6 cases): patch_fuses, verify_integrity, verify_sign |
| 39 | 0fd1c89 | 420 | 16 | keep | draft | tls-inspector-full (+5 cases): keylog_enable, tcp_open, tcp_write, tcp |
| 40 | a44a63b | 417 | 13 | keep | draft | new debugger-blackbox suite (+3 cases): blackbox_add, blackbox_add_com |
| 41 | e39eda1 | 412 | 8 | keep | draft | tls-inspector-full Wave 2 (+5 loopback TLS cases): tls_probe_endpoint, |
| 42 | 8200e69 | 408 | 4 | keep | draft | tls-inspector WebSocket batch (+4 cases): websocket_open/send_frame/re |
| 43 | 2fc39b1 | 406 | 2 | keep | draft | exploit-dev jop_chain + v8-inspector turbofan_graph traceDir (+2 cases |
| 44 | 1946d7b | 405 | 1 | keep | draft | extension-registry webhook batch (+3 cases): create, list+delete, sign |
| 45 | 5708926 | 404 | — | keep | draft | exploit_encode_shellcode XOR (+1 case) + session.suite.ts 1ms clock fl |
