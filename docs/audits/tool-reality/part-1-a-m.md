# Tool Reality Matrix Part 1 (A-M)

## adb-bridge
Evidence: src/server/domains/adb-bridge/handlers.impl.ts; src/modules/adb/ADBConnector.ts

| tool | status | note |
| --- | --- | --- |
| adb_apk_analyze | conditional | Needs adb/adbkit plus reachable Android target. |
| adb_webview_list | conditional | Needs adb/adbkit plus reachable Android target. |
| adb_webview_attach | conditional | Needs adb/adbkit plus reachable Android target. |

## analysis
Evidence: src/server/domains/analysis/manifest.ts:158-180; src/modules/deobfuscator/webcrack.ts:249-250

| tool | status | note |
| --- | --- | --- |
| collect_code | conditional | Needs collected scripts/page state or caller-supplied code. |
| search_in_scripts | conditional | Needs collected scripts/page state or caller-supplied code. |
| extract_function_tree | conditional | Needs collected scripts/page state or caller-supplied code. |
| deobfuscate | conditional | Needs collected scripts/page state or caller-supplied code. |
| understand_code | conditional | Needs collected scripts/page state or caller-supplied code. |
| detect_crypto | conditional | Needs collected scripts/page state or caller-supplied code. |
| manage_hooks | conditional | Needs collected scripts/page state or caller-supplied code. |
| detect_obfuscation | conditional | Needs collected scripts/page state or caller-supplied code. |
| webcrack_unpack | fallback | Degrades when isolated-vm/webcrack runtime is unavailable. |
| clear_collected_data | real | Local collector/cache reset. |
| get_collection_stats | real | Local collector stats. |
| webpack_enumerate | conditional | Needs collected scripts/page state or caller-supplied code. |
| llm_suggest_names | fallback | Only works when the MCP client exposes sampling support. |

## antidebug
Evidence: src/server/domains/antidebug/handlers.ts

| tool | status | note |
| --- | --- | --- |
| antidebug_bypass | conditional | Needs an active browser page. |
| antidebug_detect_protections | conditional | Needs an active browser page. |

## binary-instrument
Evidence: src/server/domains/binary-instrument/manifest.ts; src/server/domains/binary-instrument/handlers/capability-handlers.ts; src/server/domains/binary-instrument/handlers/frida-handlers.ts; src/server/domains/binary-instrument/handlers/analysis-handlers.ts

| tool | status | note |
| --- | --- | --- |
| binary_instrument_capabilities | real | Explicit capability probe for Frida CLI, legacy bridge plugins, Ghidra headless, and Unidbg. |
| frida_attach | fallback | Returns degraded/mock-unavailable payloads when Frida CLI is missing. |
| frida_enumerate_modules | fallback | Degrades without live Frida session/CLI. |
| ghidra_analyze | fallback | Has explicit analyze fallback when Ghidra tooling is unavailable. |
| generate_hooks | real | Local hook-script generation. |
| unidbg_emulate | fallback | Depends on live Unidbg session; otherwise stubs. |
| frida_run_script | fallback | Degrades without live Frida session/CLI. |
| frida_detach | conditional | Uses live Frida session when present, otherwise depends on the legacy Frida bridge plugin. |
| frida_list_sessions | conditional | Uses live Frida session when available; otherwise depends on the legacy Frida bridge plugin. |
| frida_generate_script | real | Local script generation. |
| get_available_plugins | real | Local plugin capability listing. |
| ghidra_decompile | conditional | Routed through the legacy Ghidra bridge plugin; check binary_instrument_capabilities first. |
| ida_decompile | conditional | Routed through the legacy IDA bridge plugin; check binary_instrument_capabilities first. |
| jadx_decompile | conditional | Routed through the legacy JADX bridge plugin; check binary_instrument_capabilities first. |
| unidbg_launch | fallback | Registers stub/mock session when Unidbg launch fails. |
| unidbg_call | fallback | Depends on live Unidbg session; otherwise stubs. |
| unidbg_trace | fallback | Depends on live Unidbg session; otherwise stubs. |
| export_hook_script | real | Local file/script export. |
| frida_enumerate_functions | fallback | Degrades without live Frida session/CLI. |
| frida_find_symbols | fallback | Degrades without live Frida session/CLI. |

## boringssl-inspector
Evidence: src/server/domains/boringssl-inspector/manifest.ts:110-242; src/server/domains/boringssl-inspector/handlers/handler-class.ts:856-2462

| tool | status | note |
| --- | --- | --- |
| tls_keylog_enable | real | Local TLS/keylog/parsing logic. |
| tls_keylog_parse | real | Local TLS/keylog/parsing logic. |
| tls_keylog_disable | real | Local TLS/keylog/parsing logic. |
| tls_decrypt_payload | real | Local TLS/keylog/parsing logic. |
| tls_keylog_summarize | real | Local TLS/keylog/parsing logic. |
| tls_keylog_lookup_secret | real | Local TLS/keylog/parsing logic. |
| tls_cert_pin_bypass | fallback | Only returns strategy/instructions; it does not perform the bypass. |
| tls_parse_handshake | real | Local TLS/keylog/parsing logic. |
| tls_cipher_suites | real | Local TLS/keylog/parsing logic. |
| tls_parse_certificate | real | Local TLS/keylog/parsing logic. |
| tls_probe_endpoint | conditional | Needs authorized reachable TLS endpoint and passes SSRF checks. |
| tcp_open | conditional | Needs reachable target and passes SSRF checks. |
| tcp_write | conditional | Needs live tcp_open session. |
| tcp_read_until | conditional | Needs live tcp_open session. |
| tcp_close | conditional | Needs live tcp_open session. |
| tls_open | conditional | Needs reachable TLS target and passes SSRF checks. |
| tls_write | conditional | Needs live tls_open session. |
| tls_read_until | conditional | Needs live tls_open session. |
| tls_close | conditional | Needs live tls_open session. |
| websocket_open | conditional | Needs reachable ws/wss endpoint and optional TLS trust inputs. |
| websocket_send_frame | conditional | Needs live websocket_open session. |
| websocket_read_frame | conditional | Needs live websocket_open session. |
| websocket_close | conditional | Needs live websocket_open session. |
| tls_cert_pin_bypass_frida | fallback | Only becomes real when extension/frida injection is wired; otherwise manual only. |
| net_raw_tcp_send | conditional | Needs reachable host/port and passes SSRF checks. |
| net_raw_tcp_listen | conditional | Needs free local port and incoming connection. |
| net_raw_udp_send | conditional | Needs reachable host/port and passes SSRF checks. |
| net_raw_udp_listen | conditional | Needs free local port and incoming datagram. |

## browser
Evidence: src/server/domains/browser/handlers/camoufox-browser.ts:53-98; src/server/domains/browser/handlers/captcha-solver.ts:272-442

| tool | status | note |
| --- | --- | --- |
| js_heap_search | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| tab_workflow | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| human_mouse | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| human_scroll | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| human_typing | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| captcha_vision_solve | fallback | Solver support is partial; several provider paths are not fully implemented. |
| widget_challenge_solve | fallback | Solver support is partial; several provider paths are not fully implemented. |
| browser_jsdom_parse | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| browser_jsdom_query | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| browser_jsdom_execute | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| browser_jsdom_serialize | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| browser_jsdom_cookies | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_navigate | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_reload | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_back | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_forward | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_click | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_type | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_select | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_hover | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_scroll | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_wait_for_selector | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_evaluate | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_screenshot | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| get_all_scripts | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| get_script_source | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| console_monitor | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| console_get_logs | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| console_execute | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_inject_script | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_cookies | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_set_viewport | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_emulate_device | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_local_storage | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| page_press_key | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| get_detailed_data | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| browser_launch | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| camoufox_server | conditional | Requires optional camoufox-js server support. |
| browser_attach | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| browser_list_cdp_targets | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| browser_attach_cdp_target | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| browser_detach_cdp_target | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| browser_evaluate_cdp_target | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| browser_close | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| browser_status | real | Local browser-manager state query. |
| captcha_detect | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| captcha_wait | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| captcha_config | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| stealth_inject | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| stealth_set_user_agent | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| stealth_configure_jitter | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| stealth_generate_fingerprint | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| stealth_verify | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| browser_list_tabs | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| browser_select_tab | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| framework_state_extract | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| indexeddb_dump | conditional | Usually needs browser/page/CDP state or optional browser binaries. |
| camoufox_geolocation | conditional | Usually needs browser/page/CDP state or optional browser binaries. |

## canvas
Evidence: src/server/domains/canvas/manifest.ts; src/server/domains/canvas/handlers.impl.ts

| tool | status | note |
| --- | --- | --- |
| canvas_engine_fingerprint | conditional | Needs active browser/page; click tracing also needs debugger state. |
| canvas_scene_dump | conditional | Needs active browser/page; click tracing also needs debugger state. |
| canvas_pick_object_at_point | conditional | Needs active browser/page; click tracing also needs debugger state. |
| canvas_trace_click_handler | conditional | Needs active browser/page; click tracing also needs debugger state. |

## coordination
Evidence: src/server/domains/coordination/index.ts:5-304

| tool | status | note |
| --- | --- | --- |
| create_task_handoff | real | Real but purely in-memory/ephemeral. |
| complete_task_handoff | real | Real but purely in-memory/ephemeral. |
| get_task_context | real | Real but purely in-memory/ephemeral. |
| append_session_insight | real | Real but purely in-memory/ephemeral. |
| save_page_snapshot | real | Real but purely in-memory/ephemeral. |
| restore_page_snapshot | real | Real but purely in-memory/ephemeral. |
| list_page_snapshots | real | Real but purely in-memory/ephemeral. |

## cross-domain
Evidence: src/server/domains/cross-domain/manifest.ts:17-152; src/server/domains/cross-domain/handlers.impl.ts:176-424

| tool | status | note |
| --- | --- | --- |
| cross_domain_capabilities | real | Real in-memory orchestrator/evidence-graph logic. |
| cross_domain_suggest_workflow | real | Real in-memory orchestrator/evidence-graph logic. |
| cross_domain_health | real | Real in-memory orchestrator/evidence-graph logic. |
| cross_domain_correlate_all | conditional | Real correlation, but only as good as the upstream artifacts you feed it. |
| cross_domain_evidence_export | real | Real in-memory orchestrator/evidence-graph logic. |
| cross_domain_evidence_stats | real | Real in-memory orchestrator/evidence-graph logic. |

## debugger
Evidence: src/server/domains/debugger/manifest.ts

| tool | status | note |
| --- | --- | --- |
| watch | conditional | Needs active browser + debugger/CDP state. |
| blackbox_add | conditional | Needs active browser + debugger/CDP state. |
| blackbox_add_common | conditional | Needs active browser + debugger/CDP state. |
| blackbox_list | conditional | Needs active browser + debugger/CDP state. |
| debugger_lifecycle | conditional | Needs active browser + debugger/CDP state. |
| debugger_pause | conditional | Needs active browser + debugger/CDP state. |
| debugger_resume | conditional | Needs active browser + debugger/CDP state. |
| debugger_step | conditional | Needs active browser + debugger/CDP state. |
| breakpoint | conditional | Needs active browser + debugger/CDP state. |
| get_call_stack | conditional | Needs active browser + debugger/CDP state. |
| debugger_evaluate | conditional | Needs active browser + debugger/CDP state. |
| debugger_wait_for_paused | conditional | Needs active browser + debugger/CDP state. |
| debugger_get_paused_state | conditional | Needs active browser + debugger/CDP state. |
| get_object_properties | conditional | Needs active browser + debugger/CDP state. |
| get_scope_variables_enhanced | conditional | Needs active browser + debugger/CDP state. |
| debugger_session | conditional | Needs active browser + debugger/CDP state. |

## encoding
Evidence: src/server/domains/encoding/handlers.impl.core.runtime.ts

| tool | status | note |
| --- | --- | --- |
| binary_detect_format | real | Deterministic local codecs/parsers. |
| binary_decode | real | Deterministic local codecs/parsers. |
| binary_encode | real | Deterministic local codecs/parsers. |
| binary_entropy_analysis | real | Deterministic local codecs/parsers. |
| protobuf_decode_raw | real | Deterministic local codecs/parsers. |

## evidence
Evidence: src/server/domains/evidence/handlers.ts:19-73

| tool | status | note |
| --- | --- | --- |
| evidence_query | real | Real graph query/export logic. |
| evidence_export | real | Real graph query/export logic. |
| evidence_chain | real | Real graph query/export logic. |

## extension-registry
Evidence: src/server/domains/extension-registry/manifest.ts:36-79; src/server/domains/extension-registry/handlers.impl.ts:24-259

| tool | status | note |
| --- | --- | --- |
| extension_list_installed | real | Local registry listing. |
| extension_execute_in_context | conditional | Depends on plugin registry contents or free webhook port. |
| extension_reload | conditional | Depends on plugin registry contents or free webhook port. |
| extension_uninstall | real | Local registry removal. |
| webhook | conditional | Real local webhook/queue logic, but port availability still gates it. |

## graphql
Evidence: src/server/domains/graphql/manifest.ts:13-55; src/server/domains/graphql/handlers/{callgraph,introspection,extract,replay,script-replace}.ts

| tool | status | note |
| --- | --- | --- |
| call_graph_analyze | conditional | Needs active page/CDP traces or reachable GraphQL endpoints. |
| script_replace_persist | conditional | Needs active page/CDP traces or reachable GraphQL endpoints. |
| graphql_introspect | conditional | Needs active page/CDP traces or reachable GraphQL endpoints. |
| graphql_extract_queries | conditional | Needs active page/CDP traces or reachable GraphQL endpoints. |
| graphql_replay | conditional | Needs active page/CDP traces or reachable GraphQL endpoints. |

## hooks
Evidence: src/server/domains/hooks/ai-handlers.ts; src/server/domains/hooks/preset-handlers.ts

| tool | status | note |
| --- | --- | --- |
| ai_hook | conditional | Needs active page/context for hook injection or preset application. |
| hook_preset | conditional | Needs active page/context for hook injection or preset application. |

## instrumentation
Evidence: src/server/domains/instrumentation/handlers.ts:227-257

| tool | status | note |
| --- | --- | --- |
| instrumentation_session | real | Local session bookkeeping. |
| instrumentation_operation | conditional | Facade is real, but delegated ops depend on optional handler availability. |
| instrumentation_artifact | real | Local artifact/session bookkeeping. |
| instrumentation_hook_preset | fallback | Returns degraded errors when hookPresetHandlers are unavailable. |
| instrumentation_network_replay | conditional | Facade is real, but delegated ops depend on optional handler availability. |

## macro
Evidence: src/server/domains/macro/manifest.ts:22-40; src/server/domains/macro/handlers.ts:29-115

| tool | status | note |
| --- | --- | --- |
| run_macro | real | Real local macro loading/execution. |
| list_macros | real | Real local macro loading/execution. |

## maintenance
Evidence: src/server/domains/maintenance/handlers.ts:46-127

| tool | status | note |
| --- | --- | --- |
| get_token_budget_stats | real | Real local maintenance/cache/doctor ops. |
| manual_token_cleanup | real | Real local maintenance/cache/doctor ops. |
| reset_token_budget | real | Real local maintenance/cache/doctor ops. |
| list_extensions | real | Real local maintenance/cache/doctor ops. |
| reload_extensions | real | Real local maintenance/cache/doctor ops. |
| browse_extension_registry | real | Real local maintenance/cache/doctor ops. |
| install_extension | conditional | Depends on extension source/registry availability. |
| get_cache_stats | real | Real local maintenance/cache/doctor ops. |
| smart_cache_cleanup | real | Real local maintenance/cache/doctor ops. |
| clear_all_caches | real | Real local maintenance/cache/doctor ops. |
| cleanup_artifacts | real | Real local maintenance/cache/doctor ops. |
| doctor_environment | real | Real local maintenance/cache/doctor ops. |

## memory
Evidence: src/server/domains/memory/manifest.ts:15-20,50-90,119-136,299-302; src/server/domains/memory/handlers/*.ts

| tool | status | note |
| --- | --- | --- |
| memory_first_scan | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_next_scan | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_unknown_scan | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_pointer_scan | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_group_scan | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_scan_session | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_pointer_chain | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_structure_analyze | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_vtable_parse | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_structure_export_c | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_structure_compare | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_breakpoint | conditional | Win32-only registration; requires hardware breakpoint engine. |
| memory_patch_bytes | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_patch_nop | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_patch_undo | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_code_caves | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_write_value | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_freeze | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_dump | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_speedhack | conditional | Win32-only registration; requires speedhack engine. |
| memory_write_history | conditional | Needs target PID plus native helpers/privileges; non-Windows drops Win32-only subset. |
| memory_heap_enumerate | conditional | Win32-only registration; requires heap analyzer. |
| memory_heap_stats | conditional | Win32-only registration; requires heap analyzer. |
| memory_heap_anomalies | conditional | Win32-only registration; requires heap analyzer. |
| memory_pe_headers | conditional | Win32-only registration; requires PE analyzer. |
| memory_pe_imports_exports | conditional | Win32-only registration; requires PE analyzer. |
| memory_inline_hook_detect | conditional | Win32-only registration; requires PE analyzer. |
| memory_anticheat_detect | conditional | Win32-only registration; requires anti-cheat detector. |
| memory_guard_pages | conditional | Win32-only registration; requires anti-cheat detector. |
| memory_integrity_check | conditional | Win32-only registration; requires anti-cheat detector. |
