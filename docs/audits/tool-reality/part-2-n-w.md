# Tool Reality Matrix Part 2 (N-W)

## mojo-ipc
Evidence: src/server/domains/mojo-ipc/handlers.impl.ts; src/modules/mojo-ipc/MojoMonitor.ts

| tool | status | note |
| --- | --- | --- |
| mojo_ipc_capabilities | real | Explicit capability probe; it reported available on this machine. |
| mojo_monitor | conditional | Monitor start path was verified on this machine, but it still returned `_simulation: true` here instead of live Frida-backed message capture. |
| mojo_decode_message | real | Local payload decoder does not require live monitoring; sample decode was verified. |
| mojo_list_interfaces | conditional | Interface listing now exposes whether data is `seeded-defaults`, `observed`, or `mixed`; this machine only surfaced the seeded default catalog, not live discovery. |
| mojo_messages_get | fallback | On this machine it still returned `_simulation: true` and empty messages after monitor start. |

## native-bridge
Evidence: src/server/domains/native-bridge/definitions.ts; tests/server/ToolCatalog.test.ts

| tool | status | note |
| --- | --- | --- |
| native_bridge_status | unregistered | Compatibility module is intentionally externalized from the built-in manifest registry and ToolCatalog. |
| ghidra_bridge | unregistered | Compatibility module is intentionally externalized from the built-in manifest registry and ToolCatalog. |
| ida_bridge | unregistered | Compatibility module is intentionally externalized from the built-in manifest registry and ToolCatalog. |
| native_symbol_sync | unregistered | Compatibility module is intentionally externalized from the built-in manifest registry and ToolCatalog. |

## network
Evidence: src/server/domains/network/handlers/raw-handlers.ts:734-762; src/server/domains/network/handlers/intercept-handlers.ts; src/modules/monitor/NetworkMonitor.impl.ts:303

| tool | status | note |
| --- | --- | --- |
| network_enable | conditional | Many tools need active browser/network monitor state or reachable targets. |
| network_disable | conditional | Many tools need active browser/network monitor state or reachable targets. |
| network_get_status | conditional | Many tools need active browser/network monitor state or reachable targets. |
| network_monitor | conditional | Many tools need active browser/network monitor state or reachable targets. |
| network_get_requests | conditional | Many tools need active browser/network monitor state or reachable targets. |
| network_get_response_body | conditional | Many tools need active browser/network monitor state or reachable targets. |
| network_get_stats | conditional | Many tools need active browser/network monitor state or reachable targets. |
| performance_get_metrics | conditional | Many tools need active browser/network monitor state or reachable targets. |
| performance_coverage | conditional | Many tools need active browser/network monitor state or reachable targets. |
| performance_take_heap_snapshot | conditional | Many tools need active browser/network monitor state or reachable targets. |
| performance_trace | conditional | Many tools need active browser/network monitor state or reachable targets. |
| profiler_cpu | conditional | Many tools need active browser/network monitor state or reachable targets. |
| profiler_heap_sampling | conditional | Many tools need active browser/network monitor state or reachable targets. |
| console_get_exceptions | conditional | Many tools need active browser/network monitor state or reachable targets. |
| console_inject | conditional | Many tools need active browser/network monitor state or reachable targets. |
| console_buffers | conditional | Many tools need active browser/network monitor state or reachable targets. |
| http_request_build | real | Local request-builder logic. |
| http_plain_request | conditional | Real raw HTTP client path to authorized reachable targets. |
| http2_probe | conditional | Real probe path to authorized reachable targets. |
| http2_frame_build | real | Local HTTP/2 frame builder. |
| network_rtt_measure | conditional | Real network measurement against reachable targets. |
| network_extract_auth | conditional | Many tools need active browser/network monitor state or reachable targets. |
| network_export_har | conditional | Many tools need active browser/network monitor state or reachable targets. |
| network_replay_request | conditional | Many tools need active browser/network monitor state or reachable targets. |
| network_traceroute | conditional | Platform/privilege gated. |
| network_icmp_probe | conditional | Platform/privilege gated. |
| network_intercept | conditional | Many tools need active browser/network monitor state or reachable targets. |

## platform
Evidence: src/server/domains/platform/manifest.ts; src/server/domains/platform/handlers/capabilities.ts; src/server/domains/platform/handlers/v8-bytecode-handler.ts; src/server/domains/platform/handlers/miniapp-handlers.ts; src/server/domains/platform/handlers/electron-ipc-sniffer.ts

| tool | status | note |
| --- | --- | --- |
| platform_capabilities | real | Explicit capability probe for miniapp unpacker, view8, and Electron IPC sniff runtime. |
| miniapp_pkg_scan | real | Local package/signature scan. |
| miniapp_pkg_unpack | fallback | Falls back when the preferred unpack helper is missing. |
| miniapp_pkg_analyze | conditional | Depends on local app/package files, Electron targets, or optional tooling. |
| asar_extract | real | Local ASAR extraction. |
| electron_inspect_app | conditional | Depends on local app/package files, Electron targets, or optional tooling. |
| electron_scan_userdata | real | Local Electron userdata inspection. |
| asar_search | real | Local ASAR search. |
| electron_check_fuses | real | Local Electron fuse inspection. |
| electron_patch_fuses | conditional | Depends on local app/package files, Electron targets, or optional tooling. |
| v8_bytecode_decompile | fallback | Falls back/degrades when view8 is unavailable. |
| electron_launch_debug | conditional | Depends on local app/package files, Electron targets, or optional tooling. |
| electron_debug_status | conditional | Depends on local app/package files, Electron targets, or optional tooling. |
| electron_ipc_sniff | conditional | Depends on local app/package files, Electron targets, or optional tooling. |

## process
Evidence: src/server/domains/process/manifest.ts:29,78-90; src/server/domains/process/handlers/injection-handlers.ts:13-201

| tool | status | note |
| --- | --- | --- |
| process_windows | conditional | Process/memory tooling is platform and privilege sensitive. |
| process_check_debug_port | conditional | Process/memory tooling is platform and privilege sensitive. |
| process_launch_debug | conditional | Process/memory tooling is platform and privilege sensitive. |
| memory_read | conditional | Process/memory tooling is platform and privilege sensitive. |
| memory_write | conditional | Process/memory tooling is platform and privilege sensitive. |
| memory_scan | conditional | Process/memory tooling is platform and privilege sensitive. |
| memory_check_protection | conditional | Process/memory tooling is platform and privilege sensitive. |
| memory_scan_filtered | conditional | Process/memory tooling is platform and privilege sensitive. |
| memory_batch_write | conditional | Process/memory tooling is platform and privilege sensitive. |
| memory_dump_region | conditional | Process/memory tooling is platform and privilege sensitive. |
| memory_list_regions | conditional | Process/memory tooling is platform and privilege sensitive. |
| memory_audit_export | conditional | Process/memory tooling is platform and privilege sensitive. |
| inject_dll | conditional | Additionally gated by ENABLE_INJECTION_TOOLS=true. |
| inject_shellcode | conditional | Additionally gated by ENABLE_INJECTION_TOOLS=true. |
| check_debug_port | conditional | Win32-only in the current manifest. |
| enumerate_modules | conditional | Process/memory tooling is platform and privilege sensitive. |
| electron_attach | conditional | Process/memory tooling is platform and privilege sensitive. |

## protocol-analysis
Evidence: src/server/domains/protocol-analysis/handlers.impl.core.ts

| tool | status | note |
| --- | --- | --- |
| payload_template_build | real | Deterministic local packet/build/parse/schema tooling. |
| payload_mutate | real | Deterministic local packet/build/parse/schema tooling. |
| ethernet_frame_build | real | Deterministic local packet/build/parse/schema tooling. |
| arp_build | real | Deterministic local packet/build/parse/schema tooling. |
| raw_ip_packet_build | real | Deterministic local packet/build/parse/schema tooling. |
| icmp_echo_build | real | Deterministic local packet/build/parse/schema tooling. |
| checksum_apply | real | Deterministic local packet/build/parse/schema tooling. |
| pcap_write | real | Deterministic local packet/build/parse/schema tooling. |
| pcap_read | real | Deterministic local packet/build/parse/schema tooling. |
| proto_define_pattern | real | Deterministic local packet/build/parse/schema tooling. |
| proto_auto_detect | real | Deterministic local packet/build/parse/schema tooling. |
| proto_export_schema | real | Deterministic local packet/build/parse/schema tooling. |
| proto_infer_fields | real | Deterministic local packet/build/parse/schema tooling. |
| proto_infer_state_machine | real | Deterministic local packet/build/parse/schema tooling. |
| proto_visualize_state | real | Deterministic local packet/build/parse/schema tooling. |

## proxy
Evidence: src/server/domains/proxy/manifest.ts:29-45; src/server/domains/proxy/handlers.impl.ts:30-231

| tool | status | note |
| --- | --- | --- |
| proxy_start | conditional | Depends on mockttp, free ports, and optional adb for device setup. |
| proxy_stop | conditional | Depends on mockttp, free ports, and optional adb for device setup. |
| proxy_status | conditional | Depends on mockttp, free ports, and optional adb for device setup. |
| proxy_export_ca | conditional | Depends on mockttp, free ports, and optional adb for device setup. |
| proxy_add_rule | conditional | Depends on mockttp, free ports, and optional adb for device setup. |
| proxy_get_requests | conditional | Depends on mockttp, free ports, and optional adb for device setup. |
| proxy_clear_logs | conditional | Depends on mockttp, free ports, and optional adb for device setup. |
| proxy_setup_adb_device | conditional | Depends on mockttp, free ports, and optional adb for device setup. |

## sandbox
Evidence: src/server/domains/sandbox/handlers.ts

| tool | status | note |
| --- | --- | --- |
| execute_sandbox_script | real | Real QuickJS/MCP bridge sandbox execution. |

## shared-state-board
Evidence: src/server/domains/shared-state-board/handlers.impl.core.ts

| tool | status | note |
| --- | --- | --- |
| state_board | real | Real in-memory shared-state store/watcher/io facade. |
| state_board_watch | real | Real in-memory shared-state store/watcher/io facade. |
| state_board_io | real | Real in-memory shared-state store/watcher/io facade. |

## skia-capture
Evidence: src/server/domains/skia-capture/handlers/impl.ts:26-64

| tool | status | note |
| --- | --- | --- |
| skia_detect_renderer | conditional | Needs PageController/browser context; V8 objects improve correlation. |
| skia_extract_scene | conditional | Needs PageController/browser context; V8 objects improve correlation. |
| skia_correlate_objects | conditional | Needs PageController/browser context; V8 objects improve correlation. |

## sourcemap
Evidence: src/server/domains/sourcemap/handlers.impl.sourcemap-main.ts:14-188; src/server/domains/sourcemap/handlers.impl.sourcemap-parse-base.ts:111-331

| tool | status | note |
| --- | --- | --- |
| sourcemap_discover | conditional | Discover needs active page/CDP; fetch/parse/reconstruct need reachable sourcemap inputs. |
| sourcemap_fetch_and_parse | conditional | Discover needs active page/CDP; fetch/parse/reconstruct need reachable sourcemap inputs. |
| sourcemap_reconstruct_tree | conditional | Discover needs active page/CDP; fetch/parse/reconstruct need reachable sourcemap inputs. |

## streaming
Evidence: src/server/domains/streaming/manifest.ts; src/server/domains/streaming/handlers.impl.core.ts; src/server/domains/streaming/handlers/ws-handlers.ts; src/server/domains/streaming/handlers/sse-handlers.ts

Compatibility note: `src/server/domains/streaming/handlers.impl.streaming-base.ts` and `handlers.impl.streaming-{ws,sse}.ts` are retained for legacy direct imports/tests. Current mounted runtime goes through `handlers.impl.core.ts` plus `handlers/`.
Focused runtime note: live local probes on `2026-04-25` captured real WebSocket frames plus real SSE `open` and `message` events.

| tool | status | note |
| --- | --- | --- |
| ws_monitor | conditional | Real CDP-backed WebSocket monitoring; live page-side traffic was verified on this machine. |
| ws_get_frames | conditional | Reads captured WebSocket frames from the active monitor state; live sent/received payloads were verified on this machine. |
| ws_get_connections | conditional | Reads tracked WebSocket connection state from the active monitor session; live connection state was verified on this machine. |
| sse_monitor_enable | conditional | Real page-side EventSource interception; live SSE payload capture was verified on this machine. |
| sse_get_events | conditional | Reads captured SSE events from the injected page monitor state; live `open` and `message` events were verified on this machine. |

## syscall-hook
Evidence: src/server/domains/syscall-hook/manifest.ts; src/modules/syscall-hook/SyscallMonitor.ts:274-307

| tool | status | note |
| --- | --- | --- |
| syscall_start_monitor | conditional | Needs platform-specific backends/privileges and may fall back to simulation. |
| syscall_stop_monitor | conditional | Needs platform-specific backends/privileges and may fall back to simulation. |
| syscall_capture_events | conditional | Needs platform-specific backends/privileges and may fall back to simulation. |
| syscall_correlate_js | conditional | Needs platform-specific backends/privileges and may fall back to simulation. |
| syscall_filter | conditional | Needs platform-specific backends/privileges and may fall back to simulation. |
| syscall_get_stats | conditional | Needs platform-specific backends/privileges and may fall back to simulation. |

## trace
Evidence: src/modules/trace/TraceRecorder.ts; src/modules/trace/TraceRecorder.network.ts; src/server/domains/trace/handlers.ts

Boundary note: `trace` records timeline metadata unconditionally, and can also persist `Network.dataReceived` chunks plus `Network.getResponseBody` output when browser support and tool options allow it. Focused runtime probes on this machine verified persisted `Network.dataReceived` rows, `network_resources.body_capture_state`, and `trace_get_network_flow` body/chunk output. It still does not try to mirror every response body/chunk without limits: chunk/body capture is optional, browsers may reject streaming/body APIs for some requests, and large bodies are bounded by `networkBodyMaxBytes` with inline/artifact/truncated states to avoid unbounded SQLite growth.

| tool | status | note |
| --- | --- | --- |
| trace_recording | real | Real SQLite-backed trace/timeline recording with optional chunk/body capture policy; live network and debugger event rows were verified on this machine. |
| start_trace_recording | real | Real SQLite-backed trace/timeline recording with optional chunk/body capture policy. |
| stop_trace_recording | real | Real SQLite-backed trace/timeline recording with optional chunk/body capture policy and persisted network summary counts. |
| query_trace_sql | real | Real SQL access to recorded trace tables; verified against persisted `events` and `network_resources` rows on this machine. |
| seek_to_timestamp | real | Real timeline/state reconstruction over recorded events, memory deltas, and network rows. |
| trace_get_network_flow | real | Real request-scoped trace flow reader for persisted metadata plus optional chunks/body; verified returning stored body and chunk previews on this machine. |
| diff_heap_snapshots | real | Real heap snapshot diff over trace-stored snapshot summaries. |
| export_trace | real | Real trace export to Chrome Trace Event JSON. |
| summarize_trace | real | Real trace summarization over recorded events, memory deltas, and network tables. |

## transform
Evidence: src/server/domains/transform/handlers.impl.core.ts

| tool | status | note |
| --- | --- | --- |
| ast_transform_preview | real | Real local AST/crypto transform helpers. |
| ast_transform_chain | real | Real local AST/crypto transform helpers. |
| ast_transform_apply | real | Real local AST/crypto transform helpers. |
| crypto_extract_standalone | real | Real local AST/crypto transform helpers. |
| crypto_test_harness | real | Real local AST/crypto transform helpers. |
| crypto_compare | real | Real local AST/crypto transform helpers. |

## v8-inspector
Evidence: src/server/domains/v8-inspector/handlers/impl.ts; src/server/domains/v8-inspector/handlers/heap-snapshot.ts; src/server/domains/v8-inspector/handlers/bytecode-extract.ts; src/server/domains/v8-inspector/handlers/jit-inspect.ts

Compatibility note: `src/server/domains/v8-inspector/handlers.impl.ts` is a legacy direct-import adapter. The current manifest/runtime chain goes through `manifest.ts -> handlers.ts -> handlers/impl.ts`.
Focused runtime note: on this machine the live heap capture path returned `simulated: false`, produced a multi-megabyte snapshot, and `v8_heap_snapshot_analyze` returned structured output over that real snapshot. `v8_heap_stats` also returned non-zero live usage (`jsHeapSizeUsed=895253`). `get_all_scripts` returned live script metadata, `v8_bytecode_extract` now executes against a non-internal script, but its payload is explicitly `mode: source-derived` / `format: pseudo-bytecode`, and `v8_jit_inspect` returned `inspectionMode: heuristic` because `v8_version_detect.features.nativesSyntax` was `false` on this machine.

| tool | status | note |
| --- | --- | --- |
| v8_heap_snapshot_capture | conditional | Needs active page/CDP; the real capture path was verified on this machine and returned `simulated: false`. |
| v8_heap_snapshot_analyze | conditional | Needs active page/CDP or previously captured heap data; structured analysis over a real captured snapshot was verified on this machine. |
| v8_heap_diff | conditional | Needs active page/CDP or previously captured heap data. |
| v8_object_inspect | conditional | Needs active page/CDP or previously captured heap data. |
| v8_heap_stats | conditional | Needs active page/CDP; non-zero live heap usage was verified on this machine. |
| v8_bytecode_extract | fallback | Current implementation derives pseudo-bytecode from script source; it does not expose raw Ignition bytecode. |
| v8_version_detect | conditional | Needs active page/CDP; now also reports `features.nativesSyntax` so callers can detect whether deeper JIT status is available. |
| v8_jit_inspect | conditional | Needs active page/CDP; returns native optimization status only when V8 natives syntax is available, and stayed in explicit `inspectionMode: heuristic` on this machine. |

## wasm
Evidence: src/server/domains/wasm/handlers.impl.ts:114-651

| tool | status | note |
| --- | --- | --- |
| wasm_dump | conditional | Needs browser hook/page state for live dumping. |
| wasm_disassemble | conditional | Mix of browser-backed capture and external runner/tool dependencies. |
| wasm_decompile | conditional | Mix of browser-backed capture and external runner/tool dependencies. |
| wasm_inspect_sections | real | Section parsing/inspection is local once bytes/module input exists. |
| wasm_offline_run | conditional | Mix of browser-backed capture and external runner/tool dependencies. |
| wasm_optimize | conditional | Mix of browser-backed capture and external runner/tool dependencies. |
| wasm_vmp_trace | conditional | Mix of browser-backed capture and external runner/tool dependencies. |
| wasm_memory_inspect | conditional | Mix of browser-backed capture and external runner/tool dependencies. |

## workflow
Evidence: src/server/domains/workflow/handlers/script-handlers.ts:96-156

| tool | status | note |
| --- | --- | --- |
| js_bundle_search | conditional | Depends on extension workflow runtime or page/script context. |
| page_script_register | conditional | Depends on extension workflow runtime or page/script context. |
| page_script_run | conditional | Depends on extension workflow runtime or page/script context. |
| api_probe_batch | conditional | Depends on extension workflow runtime or page/script context. |
| list_extension_workflows | real | Local workflow listing was verified on this machine and returned `count=0`. |
| run_extension_workflow | conditional | Real execution path exists, but it depends on installed workflows; runtime verification skipped execution on this machine because listing returned `count=0`. |
