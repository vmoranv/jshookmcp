# Military-grade audit current status (2026-07-06)

> This file is the CCG-side score ledger. `scripts/update-domain-scores.mjs`
> is an auxiliary CLAUDE.md updater only; do not treat it as the primary
> handoff or planning record.

## Current gate snapshot

| Gate | Current value |
|------|---------------|
| Domains | 34 |
| Registered tools | 577 (`pnpm metadata:check`, 2026-07-08) |
| Latest full check | `pnpm check` passed after network parse_client_hello (JA3+JA4) session with 16,167 passed / 30 skipped |
| Lowest score band | 9.2 |
| Mean manual score | ~9.38 |
| 10/10 status | Not complete. Remaining work is feature closure, adversarial coverage, cross-platform parity, and doc/tool contract tightening. |

## Score ledger

| Domain | Score | Current CCG rationale |
|--------|-------|-----------------------|
| adb-bridge | 9.2 | 23 tools, install/input/proc maps/root/screenshot/screenrecord plus port-forward lifecycle and strict mapping validation. |
| analysis | 9.8 | Interprocedural taint summaries, member-chain propagation, and ordering-bug fix are done; remaining gaps are deeper flow sensitivity and scope precision. |
| binary-instrument | 9.5 | Frida spawn/resume and real `Interceptor.attach` generation are in place across the native tooling surface. |
| boringssl-inspector | 9.2 | Phase 0 decrypt honesty fix and MCP-safe wrappers are done; CDP keylog / QUIC depth remains. |
| browser | 9.5 | Worker inspection (browser_list_workers + browser_worker_scripts via CDP Debugger replay) + browser_font_fingerprint (queryLocalFonts-first, probe fallback, spoof) are done; CDP all-origin cookies + launch enum validation remain. |
| canvas | 9.4 | Three.js/Babylon adapters and MCP-safe wrappers are done; deeper texture/program exposure remains. |
| coordination | 9.2 | Persisted handoffs/insights, tagged filtering, handoff updates, and strict severity validation are done. |
| cross-domain | 9.2 | Live-state hydration, expanded workflow classifier, evidence queries, and strict chain direction validation are done. |
| dart-inspector | 9.2 | Dart-aware classifiers and strict Smi width validation are done; full obfuscation-map automation remains. |
| debugger | 9.2 | Run-to-location, breakpoint hit context, condition validation, and lifecycle action validation are done. |
| encoding | 9.6 | Common magic signatures and base32/base58/base85/compression codecs are done. |
| exploit-dev | 9.3 | Capstone x64 one-gadget scan and CLAUDE.md coverage are done; ARM64 / CFG depth remains. |
| extension-registry | 9.4 | Install/info lifecycle with no-import manifest inspection is done; webhook ACK/retry/DLQ remains. |
| graphql | 9.4 | Apollo Federation `_service.sdl` introspection is done; APQ/batch/subscription replay remains. |
| instrumentation | 9.2 | Session snapshot export, operation stop/status lifecycle, and strict type/artifact validation are done. |
| maintenance | 9.3 | Sandbox limits/redaction and category-aware artifact retention with manifest routing are done. |
| memory | 9.7 | Real readMemory + capstone find-accesses is done; cross-platform watchpoint/disassembly parity remains. |
| mojo-ipc | 9.2 | Encode/filter surface, extended decoder/header metadata, and field-name decode context are done. |
| native-bridge | 9.5 | Runtime DomainManifest registration plus Rizin/Binary Ninja parity are done. |
| native-emulator | 9.2 | Session diagnostics and strict Java mock value exclusivity are done; SIMD/crypto opcode depth remains. |
| network | 9.8 | parse_client_hello mode (real JA3 Salesforce MD5 + JA4 FoxIO from captured ClientHello wire bytes) + http2_frame_parse (build+parse symmetric) + extract_auth signing-scheme recognition (AWS SigV4 / Aliyun ACS3 / DPoP / OAuth2 client_assertion + form-urlencoded body) + bot_detect_analyze JA3/JA4 integration (user-supplied knownBad lists, zero hardcoded feature library) are done; DNS resolver override + TLS JA3/JA4 from negotiation data remain. |
| platform | 9.3 | ASAR SHA256/SHA512 integrity algorithm awareness is done; Authenticode/notarization depth remains. |
| process | 9.2 | Suspend/resume, hollowing dumps, thread diagnostics, and strict memory pattern validation are done. |
| protocol-analysis | 9.6 | MQTT/STUN/QUIC/SOCKS5/HTTP2 fingerprint expansion is done. |
| proxy | 9.3 | Body/timing capture, active rule lifecycle, arbitrary methods, and strict rule input validation are done. |
| sourcemap | 9.4 | Indexed (sectioned) source map flattening + sourcemap_lookup reverse (original -> generated) mode are done; MCP-safe wrappers + shared SSRF private-host policy remain. |
| streaming | 9.2 | Payload export and capture cap schema/runtime alignment are done; gRPC/fetch/WebRTC depth remains. |
| syscall-hook | 9.4 | dtrace entry/return probe pairing (returnValue + duration) and ETW multi-provider capture (kernel-process/network/file/image GUIDs) are done; native direct-NT live hook + Frida cross-platform live path remain. |
| trace | 9.2 | Category thread tracks and runtime console/exception seek context are done; CPU samples/flame depth remains. |
| transform | 9.2 | AST-backed transforms were attempted, and chain metadata echo is done; parser-backed coverage still needs hardening. |
| v8-inspector | 9.5 | Tier A+B+D+C are complete; persistent snapshots remain. |
| wasm | 9.2 | Multi-instance memory inspect and MCP-safe wrappers are done; binary instrumentation / diff depth remains. |
| webgpu | 9.2 | Condition-wait command capture and format-aware shader caches are done. |
| workflow | 9.5 | Macro DSL parallel/branch/fallback/retry orchestration is done. |

## Sessions after handoff Session 18

| Session | Commits | Scope |
|---------|---------|-------|
| 19 | `96ddc683`, `852459d2`, `dc0fa1c0`, `bda3c94c`, `2e474096` | Phase3-quad execution: transform AST operations, cross-domain live state, trace profiler samples, mojo encode/decoder work, scan snapshot. |
| 20 | `99c7127e`..`73b9f729` | Broad Phase 3 feature wave: binary-instrument, adb-bridge, streaming, encoding, workflow, coordination, graphql, platform, instrumentation, extension-registry, native-bridge. |
| 21 | `261c8ebf`..`e330231b` | Lifecycle and UX hardening: proxy rules, debugger source/hit context, cross-domain classifier, mojo headers/labels, adb mappings/screen record, syscall strace enrichment, browser cookies, network DNS, maintenance cleanup categories, trace diagnostics, instrumentation stop. |
| 22 | `a5df46a2`..`163ec355` | Validation and schema tightening wave: debugger conditions, coordination handoffs, cross-domain evidence, syscall summaries, native-emulator diagnostics, process threads, browser page data, adb mode, sourcemap SSRF, dart Smi, webgpu cache, transform descriptions, streaming caps. |
| 23 | `700e404f`..`efa1a88f` | Strict input contract pass: debugger lifecycle actions, coordination severity, cross-domain chain direction, instrumentation operation types, network retry schema, process memory pattern types, syscall capture filters, browser launch enums, native-emulator Java mock values, maintenance artifact routing, proxy rule inputs. |
| 24 | (browser worker + font) | browser Phase 3: `browser_list_workers` + `browser_worker_scripts` (CDP Debugger.enable scriptParsed replay, source hydration, borrowed/temp session) + `browser_font_fingerprint` (queryLocalFonts-first, document.fonts.check probe fallback, spoof override, stable hash). 573→576 tools, 16077→16099 tests. |
| 25 | (network http2-parse + auth-signatures) | network Phase 3: `http2_frame_parse` (lenient inverse of http2_frame_build, decodeError for malformed payloads) + `extract_auth` signing-scheme recognition (AWS SigV4 header + presigned query, Aliyun ACS3, DPoP, OAuth2 client_assertion; new `source: 'signature'` + `scheme` field; form-urlencoded body fallback). 576→577 tools, 16099→16129 tests. |
| 26 | (sourcemap indexed + reverse-lookup) | sourcemap Phase 3: indexed (sectioned) source map flattening (`flattenIndexedSourceMap`, sources/names dedupe + offset-remapped mappings) transparent to all parsers + `sourcemap_lookup` reverse mode (original source:line:col → generated position, debugger-breakpoint style). No new tool count (577 unchanged), 16129→16140 tests. |
| 27 | (syscall-hook dtrace-pair + ETW multi-provider) | syscall-hook Phase 3: `parseDTraceLine` entry/return probe pairing via `dtracePendingEntries` buffer (captures returnValue + duration, emits best-effort return-only on unmatched entry) + `captureWithDTrace` now emits both `:entry`/`:return` probes with monotonic `timestamp` printf + `ETW_PROVIDERS` const map (kernel-process/network/file/image GUIDs) + `buildEtwProviderArgs` + `etwProviders` option threaded through `syscall_start_monitor` (legacy NT Kernel Logger session preserved when omitted). No new tool count (577 unchanged), 16140→16145 tests. |
| 28 | (network parse_client_hello JA3+JA4) | network Phase 3: `parseClientHello` (RFC 5246 §7.4.1.2 ClientHello wire-byte parser, lenient) + `computeJa3` (Salesforce MD5) + `computeJa4FromClientHello` (FoxIO JA4) → new `network_tls_fingerprint` mode `parse_client_hello` (enum 3→4, required `clientHelloHex`). network 9.4→9.6. No new tool count (577 unchanged), 16145→16167 tests. |
| 29 | (memory cross-platform gap annotation) | memory: annotated `memory_find_accesses` cross-platform disassembly/breakpoint stubs (**annotation only — NOT implementation**). `// TODO(macOS/Linux)` + `// NOTE` added at: `handlers/find-accesses.ts` (handleFindAccesses entry + `bpEngine` null check), `manifest.ts` (`WIN32_ONLY_TOOLS` set + `null, // hardwareBreakpointEngine` else-branch), `handlers.impl.ts` (`makeDisassemblerAdapter` JSDoc). All point to `research/memory.md #3` (Linux ptrace INT3+SIGTRAP / macOS mach_vm_protect+EXC_BAD_ACCESS parity). Corrected handoff's `#1` typo → `#3` (#1 = instruction-bytes bug, already FIXED Phase 0) + corrected "capstone native binding" misconception (capstone is WASM, cross-platform; real gap = bpEngine). Score unchanged (9.7). No tools/tests/logic change. typecheck + lint + metadata(577) green. |

| 30 | (network bot-detect JA3/JA4) | network Phase 3: `detectBotSignals` extended with optional `jaFingerprint` (ja3/ja4 informational + user-supplied knownBadJa3/knownBadJa4; +0.45 on match). `network_bot_detect_analyze` schema adds ja3/ja4/knownBadJa3/knownBadJa4. **Zero hardcoded feature library** — "bad" is caller's judgement. 7 new tests (5 pure + 2 integration). network 9.6→9.8. No new tool count (577 unchanged). |

## Next 10/10 work

The remaining work is no longer a single wrapper or metadata pass. Treat every
next increment as a feature-plus-adversarial-test slice:

1. Pick one 9.2 domain and close a real missing capability from its research file. (Session 30 network bot-detect 9.6→9.8 ✅ done — research #4 closed with zero-hardcoded-library design.)
2. Add strict schema/runtime validation for every new input path.
3. Add focused success, negative, and boundary tests.
4. Run targeted tests, `pnpm metadata:check`, `node scripts/scan-domain-audit.mjs`,
   and then `$env:VITEST_MAX_WORKERS='4'; pnpm check`.
5. Update this CCG ledger, `INDEX.md`, `domain-10-plan.md`, `handoff.md`, and the
   touched `research/<domain>.md` before committing.
