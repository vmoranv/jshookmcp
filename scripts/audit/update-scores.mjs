#!/usr/bin/env node
// One-shot: append/update the Audit Score line in every domain CLAUDE.md
// using honest scores derived from tool/test counts + prior audit work.
// Re-runnable: replaces an existing Audit Score line in place.
//
// 2026-08-20 resync: scores reconciled against git log `(→ 10.0)` commit
// markers + per-domain CLAUDE.md honest-boundary annotations. memory and
// syscall-hook remain 9.9 (B-class honest boundaries requiring Mac/Linux
// real hardware / heavy native deps — not CI-verifiable on Windows).

import fs from 'node:fs';
import path from 'node:path';

const SCORES = {
  'adb-bridge': [
    10.0,
    '26 tools, install/input/proc maps/root/screenshot/screenrecord + port forward lifecycle and strict mapping validation + Session 61 adb_getprop structured getprop + device fingerprint',
  ],
  analysis: [
    10.0,
    '25 tools, Phase 3 interprocedural taint (function summaries + member-chain) + two-pass ordering-bug fix + Session 53 security-scan risk types (proto-pollution/SSRF/redirect/path-traversal + WASM-VM obfuscation detection) `d5cdb19b`',
  ],
  'binary-instrument': [
    10.0,
    '44 tools, Frida spawn/resume, real Interceptor.attach generation, Unidbg/Ghidra/IDA/JADX + Session 58 frida memory scan/read + apktool build/sign `a4fa2d62` → 10.0 + frida spawn interceptors `99c7127e`',
  ],
  'tls-inspector': [
    10.0,
    '28 tools, Phase 0 honesty fix + Phase 2 MCP-safe wrappers + Session 41 ssl-key-log + chrome-detect + format export',
  ],
  browser: [
    10.0,
    '80 tools, worker inspection (browser_list_workers + browser_worker_scripts) + browser_font_fingerprint (queryLocalFonts-first, probe fallback) + CDP all-origin cookies + launch enum validation + Session 53 indexeddb key-range/cursor + storage depth + SW event hooks `0cb88762` → 10.0 + Session 53 page_handle_dialog + page_storage_info',
  ],
  canvas: [
    10.0,
    '9 tools, Phase 0 adapters + Phase 2 MCP-safe wrappers + Session 55 draw-hook + GPU resources + scene-search filters + trace race fix `18d98be7` → 10.0 + Session 60 Laya real-machine compat `76b49444`/`476dc721` + Session 60 FrameStats extraction `60780817`',
  ],
  coordination: [
    10.0,
    '12 tools, persisted handoffs/insights, tagged insight filtering, handoff status updates, strict severity enum validation + Session 61 IndexedDB metadata capture in save_page_snapshot + Session 58 state-bound fixes',
  ],
  'cross-domain': [
    10.0,
    '8 tools, live-state hydration, edge filtering, expanded workflow classifier, evidence queries, strict chain direction/schema limits + Session 61 correlateNetworkToV8 + graph-renderers',
  ],
  'dart-inspector': [
    10.0,
    '16 tools, 23 tests, Dart-aware classifiers and strict Smi width validation + Session 58 dart_call_graph (pool entry value match, tag-strip, self-edge exclusion) `628caddb` → 9.6→10.0',
  ],
  debugger: [
    10.0,
    '21 tools, run-to-location, breakpoint-hit call stack/scope capture, condition and lifecycle action validation + Session 40 disassemble-at-pause + session restore (#4) + Session 57 doc-sync closure → 10.0',
  ],
  encoding: [
    10.0,
    '5 tools, Phase 3 magic signatures + base32/base58/base85/compression codecs + Session 49 chi-square/serial-correlation entropy metrics + protobuf schema decode `00564a62` → 10.0 + Session 60 protobuf decode fidelity `752a2d75` + deps modernization @msgpack/msgpack `60780817`',
  ],
  'exploit-dev': [
    10.0,
    '21 tools, Phase 0 capstone x64 one-gadget scan, CLAUDE.md created + Session 61 binary mitigation detection (CFG/NX/ASLR/RELRO/canary) + one-gadget + types coverage expansion',
  ],
  'extension-registry': [
    10.0,
    '7 tools, Phase 3 MCP install/info lifecycle with no-import manifest inspection + Session 56 webhook forwarding bug fix + HMAC signature verification `34137b18` → 10.0',
  ],
  graphql: [
    10.0,
    '7 tools, Phase 3 Apollo Federation _service.sdl introspection + Session 57 ws subscriptions via graphql_subscribe (#4) `452ec461` → 10.0 + batch/APQ + structured errors',
  ],
  instrumentation: [
    10.0,
    '13 tools, session snapshot export to artifacts, operation status/stop lifecycle, strict type and artifact limit validation + Session 58 session diff/merge + type enum extension `aa74dacd` → 10.0 + session archive-on-destroy `d998b38b`',
  ],
  maintenance: [
    10.0,
    '14 tools, sandbox hardening plus category-aware artifact retention cleanup with manifest category routing + Session 61 extension integrity verification + namespace-aware cache cleanup filter (smart_cache_cleanup namespace param)',
  ],
  memory: [
    9.9,
    '74 tools, pattern-search pure-TS regex/hex/string engine, bpEngine cross-platform B-class gap honest — Session 61 real readMemory + capstone find-accesses Win32 runtime-verified `987c1ea6`; cross-platform watchpoint/disassembly parity (Linux ptrace INT3+SIGTRAP / macOS mach_vm_protect+EXC_BAD_ACCESS) remains honest B-class boundary requiring Mac/Linux real hardware',
  ],
  'mojo-ipc': [
    10.0,
    '8 tools, encode/filter surface, expanded decoder types, v2 header metadata, field-name decode context + Session 43 Frida hook architecture (live-capture spawn + stdout parse) + Session 61 direction-aware correlation + mojo_messages_summarize + encoder v2 header symmetry',
  ],
  'native-bridge': [
    10.0,
    '6 tools, runtime DomainManifest registration + Rizin/Binary Ninja bridge parity + Session 58 sqlite + incremental symbol sync (#5) `a5a0aaaa` → 10.0',
  ],
  'native-emulator': [
    10.0,
    '56 tools, E4 finale + session diagnostics + strict Java mock value exclusivity + Session 58-63 closure: SM3/SM4 `24203f14` →9.5 + SM3/SM4/SHA3/SHA512 SIMD crypto `5824db7b` → 10.0 + GDB RSP TCP server `3a3663af` + LiteVM shared bytecode decode `c25ff48f` + bit-exact LDXR/STXR `70390398`',
  ],
  network: [
    10.0,
    '38 tools, parse_client_hello mode (real JA3 Salesforce MD5 + JA4 FoxIO from captured ClientHello bytes) + http2_frame_parse (build+parse symmetric) + extract_auth signing-scheme recognition + form-urlencoded body + DNS resolver-server override + response-body retry schema/runtime alignment + Session 30 bot_detect_analyze JA3/JA4 + Session 52 h2 fingerprint → detectBotSignals four-dim bot-detection `36eb661d` → 10.0 + statusCode filter',
  ],
  platform: [
    10.0,
    '18 tools, Phase 3 ASAR integrity SHA256/SHA512 algorithm awareness + Session 58 signature + asar_repack + entropy closure `1f05334e` → 10.0',
  ],
  process: [
    10.0,
    '28 tools, Phase 1 suspend/resume + hollowing dumps + MCP-safe wrappers + thread diagnostics + strict memory pattern type validation + Session 61 /proc maps analyzer (rwx/anon-executable/deleted-backing flagging) + proc-runtime parser (environ/cmdline/status)',
  ],
  'protocol-analysis': [
    10.0,
    '20 tools, Phase 3 +5 protocol fingerprints: MQTT/STUN/QUIC/SOCKS5/HTTP2 + Session 53 pcap PCAPNG redirect + export ksy/json-schema + TLS ext dissect via proto_fingerprint `f7486506` → 10.0 + Session 60 dns-packet official package `60780817`',
  ],
  proxy: [
    10.0,
    '11 tools, body/timing capture, active rule lifecycle, exact HTTP method matching, strict rule input validation + Session 60 forwardOptions declarative transform + upstream proxy chaining (proxyConfig HTTP/HTTPS/SOCKS4/SOCKS5/PAC) + matchReplaceBody regex + api_probe_batch throttle + per-rule disposal via proxy_remove_rule → 10.0',
  ],
  sourcemap: [
    10.0,
    '7 tools, indexed (sectioned) source map flattening + sourcemap_lookup reverse (original -> generated) mode + Phase 2 MCP-safe wrappers + shared SSRF private-host policy + Session 31 reconstruct_tree inferMissing (sourcesContent-null skeleton from mapping segments) + Session 34 v4 scopes emitScopes sidecar (#5) — FIRST 10/10 DOMAIN',
  ],
  streaming: [
    10.0,
    '17 tools, MCP-safe wrappers + capture cap schema/runtime alignment + Session 51 gRPC/fetch/WebRTC export_capture + ws_send_frame replay `a665836b` → 10.0 + Session 37/38 live gRPC + fetch-stream + WebRTC monitor',
  ],
  'syscall-hook': [
    9.9,
    '15 tools, strace 5.x/6.x multi-format parser + sliding-window behavioral profiling (cosine similarity clustering), direct-NT live hook B-class gap honest — bpftime/zpoline userspace eBPF binary-rewriting path remains honest B-class boundary requiring Linux + eBPF toolchain, not viable cross-platform MCP',
  ],
  trace: [
    10.0,
    '10 tools, category thread tracks, MCP-safe wrappers, structured Runtime console/exception seek context + Session 41 trace_get_samples exposure layer + export_trace per-function Chrome Trace X events + Session 61 HAR 1.4 export + seek direction + heap diff topRetainers breakdown',
  ],
  transform: [
    10.0,
    '7 tools, Phase 2 MCP-safe wrappers + transform-chain metadata echo + Session 48 closure: CFF negated-literal loop guards `e6cf2ebd` + constant folding symmetry + dead_code + negative-crash fix `b564d938` → 10.0',
  ],
  'v8-inspector': [
    10.0,
    '21 tools, Tier A+B+D+C all done + Session 46 heap snapshot persistence (list/delete/export + retention) + Session 54 multi-target/worker capture (#2): every CDP-backed tool resolves collector attached-target session via resolveTargetSession, owned flag gates detach, WASM attachSessionAsPage `82bd9fce` → 10.0 — 9th 10/10 domain',
  ],
  wasm: [
    10.0,
    '17 tools, Phase 0 instances[0]→instanceIndex fix + Phase 2 MCP-safe wrappers + Session 50 wasm_diff + Session 59 wasm_dump autoInject + wasm_instrument_binary (WAT-level) + Session 61 wasm_inspect (pure-TS structural parser) `9aa4e5b1` → 10.0',
  ],
  webgpu: [
    10.0,
    '10 tools, command-capture condition wait + format-aware shader caches + Session 45 webgpu_shader_source_capture + Session 57 webgpu_error_capture + webgpu_pipeline_dump (doc-sync closure) → 10.0 — 12th 10/10 domain',
  ],
  workflow: [
    10.0,
    '12 tools, Phase 3 macro DSL parallel/branch/fallback/retry orchestration + Session 61 workflow_run_inspect (recent runs, stepResults/spans/metrics) + api_probe_batch throttle (concurrency/delayMs/jitterMs)',
  ],
};

const DOMAIN_DIR = 'src/server/domains';
const today = '2026-08-20';

let updated = 0;
let skipped = 0;

for (const [domain, [score, rationale]] of Object.entries(SCORES)) {
  const claudePath = path.join(DOMAIN_DIR, domain, 'CLAUDE.md');
  if (!fs.existsSync(claudePath)) {
    console.log(`SKIP ${domain} (no CLAUDE.md)`);
    skipped++;
    continue;
  }
  let content = fs.readFileSync(claudePath, 'utf8');
  const newLine = `**Audit Score**: ${score.toFixed(1)}/10 (${today}, ${rationale})`;
  const existingRe = /\*\*Audit Score\*\*:.*$/m;
  if (existingRe.test(content)) {
    content = content.replace(existingRe, newLine);
  } else {
    content = content.replace(/\s*$/, '') + '\n\n---\n\n' + newLine + '\n';
  }
  fs.writeFileSync(claudePath, content, 'utf8');
  console.log(`UPDATE ${domain} → ${score.toFixed(1)}`);
  updated++;
}

console.log(`\n${updated} updated, ${skipped} skipped`);
