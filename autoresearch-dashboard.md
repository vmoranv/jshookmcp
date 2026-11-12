# Autoresearch Dashboard: per-tool-quality-debt

**Runs:** 41 / 200 | **Kept:** 34 | **Discarded:** 1 | **Crashed:** 6 | **Checks-failed:** 0
**Best:** debt=412 (run #41, e39eda1) | **Baseline:** debt=616 (run #1) — debtΔ -204
**Noise floor:** 0 (harness deterministic)
**Note:** debt2 == extractor debt (constant +51 low_mrr offset); comparisons delta-based.

| # | commit | debt | Δ vs best | status | op | description |
|---|--------|------|-----------|--------|----|-------------|
| 1 | 0956cc0 | 616 | 204 | keep |  | baseline: 565 unmeasured + 51 low_mrr + 0 vector_fail |
| 2 | 0956cc0 | 616 | 204 | crash | draft | protocol-analysis coverage batch: +9 cases, 4 fail (2 handler bugs: au |
| 3 | 4635b63 | 607 | 195 | keep | draft | protocol-analysis coverage batch: +9 cases all pass (fix: no-arg handl |
| 4 | 4635b63 | 607 | 195 | crash | draft | mojo-ipc suite v1: *Tool wrappers return content-wrapped ToolResponses |
| 5 | b793cb8 | 603 | 191 | keep | debug | mojo-ipc suite v2 (raw internal handlers, flattened caps keys, seeded/ |
| 6 | 3ba21fb | 599 | 187 | keep | draft | platform coverage batch: +4 cases (asar_deobfuscate, miniapp_pkg_analy |
| 7 | b0e683f | 591 | 179 | keep | draft | trace coverage batch: +8 cases (seek_to_timestamp, export_trace, trace |
| 8 | 9b3c34c | 586 | 174 | keep | draft | core-analysis coverage batch: +5 cases (detect_crypto, analysis_decode |
| 9 | 9ebb485 | 583 | 171 | keep | draft | transform coverage batch: +3 cases (ast_transform_preview, ast_transfo |
| 10 | 9ebb485 | 583 | 171 | crash | draft | cross-domain suite v1: addNode returns EvidenceNode (not string id) +  |
| 11 | 46ddb76 | 579 | 167 | keep | debug | cross-domain completion batch: +4 cases (suggest_workflow, evidence_st |
| 12 | f7cb2bb | 577 | 165 | keep | draft | coordination coverage batch: +2 cases (complete_task_handoff, list_pag |
| 13 | c7a5190 | 567 | 155 | keep | draft | exploit-dev coverage batch: +10 cases (cache_* x4, find_gadgets, find_ |
| 14 | c7a5190 | 567 | 155 | crash | draft | sourcemap_parse_v4 data: URI test exposed real handler bug: fetchSourc |
| 15 | 6e0ee37 | 566 | 154 | keep | debug | fix(sourcemap): decode data: URIs in fetchSourceMapText + sourcemap_pa |
| 16 | 801e2e9 | 561 | 149 | keep | draft | dart-inspector coverage batch: +5 cases (strings_extract, packages_det |
| 17 | abc0354 | 560 | 148 | keep | draft | wasm coverage batch: wasm_string_extract (+1 case); debt 561->560 |
| 18 | 70d1150 | 553 | 141 | keep | draft | maintenance coverage batch: +7 cases (clear_all_caches, smart_cache_cl |
| 19 | 4b1ff28 | 549 | 137 | keep | draft | v8-inspector heap coverage batch: +4 cases (heap_find_leaks, function_ |
| 20 | 445993d | 534 | 122 | keep | draft | new native-emulator suite: +15 cases (session/ELF/add_two=42/memory/JN |
| 21 | 2f2fda3 | 516 | 104 | keep | draft | fix(native-emulator): handleRegsRestore empty-filter bug + Wave 2 (+18 |
| 22 | e0d8bd7 | 498 | 86 | keep | draft | native-emulator Wave 3 (+18 cases): imports/GOT, JNI/Java, TLS, host s |
| 23 | dedd847 | 495 | 83 | keep | draft | native-emulator Wave 4 (+3 cases): nemu_load_library_chain, nemu_extra |
| 24 | 4a6ee51 | 482 | 70 | keep | draft | binary-instrument offline batch (+13 cases): APK/DEX triage, manifest, |
| 25 | aa59b04 | 474 | 62 | keep | draft | core-analysis Wave 2 (+8 cases): understand_code, pipeline, symbolic,  |
| 26 | aa59b04 | 474 | 62 | crash | draft | workflow batch v1: list_macros/run_macro live on MacroToolHandlers, no |
| 27 | 3a5faf5 | 470 | 58 | keep | debug | workflow batch (+4 cases): list_macros, run_macro, page_script_registe |
| 28 | 40e57c6 | 463 | 51 | keep | draft | network offline batch (+7 cases): status, stats, requests, extract_aut |
| 29 | 052b1b2 | 462 | 50 | keep | draft | tls-inspector: +1 case (tls_parse_handshake ClientHello SNI); debt 463 |
| 30 | e678393 | 455 | 43 | keep | draft | memory-pure-ts offline batch (+7 cases): parse_dump, assemble, bookmar |
| 31 | feb28d8 | 450 | 38 | keep | draft | process-static batch (+5 cases): process_get, process_list, process_wi |
| 32 | feb28d8 | 450 | 38 | crash | draft | proxy loopback batch v1 exposed REAL BUG: mockttp 4.4.2 MockedEndpoint |
| 33 | b32b839 | 445 | 33 | keep | debug | fix(proxy): real mockttp rule removal via setRequestRules + 5 loopback |
| 34 | 36ecd26 | 440 | 28 | keep | draft | offline-tools browser batch (+5 cases): jsdom_execute, get_detailed_da |
| 35 | 36ecd26 | 440 | 28 | discard | draft | misc-residual convert jsdom_serialize/cookies skips to live: shortfall |
| 36 | 6e530e2 | 434 | 22 | keep | draft | network Wave 2 (+6 cases): get_response_body, intercept(list), enable, |
| 37 | 618cb15 | 431 | 19 | keep | draft | maintenance batch (+3 cases): execute_sandbox_script, list_extensions, |
| 38 | f2c7830 | 425 | 13 | keep | draft | platform Wave 2 (+6 cases): patch_fuses, verify_integrity, verify_sign |
| 39 | 0fd1c89 | 420 | 8 | keep | draft | tls-inspector-full (+5 cases): keylog_enable, tcp_open, tcp_write, tcp |
| 40 | a44a63b | 417 | 5 | keep | draft | new debugger-blackbox suite (+3 cases): blackbox_add, blackbox_add_com |
| 41 | e39eda1 | 412 | — | keep | draft | tls-inspector-full Wave 2 (+5 loopback TLS cases): tls_probe_endpoint, |
