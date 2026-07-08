#!/usr/bin/env node
// One-shot: append/update the Audit Score line in every domain CLAUDE.md
// using honest scores derived from tool/test counts + prior audit work.
// Re-runnable: replaces an existing Audit Score line in place.

import fs from 'node:fs';
import path from 'node:path';

const SCORES = {
  'adb-bridge': [
    9.2,
    '23 tools, install/input/proc maps/root/screenshot/screenrecord + port forward lifecycle and strict mapping validation',
  ],
  analysis: [
    9.8,
    '25 tools, Phase 3 interprocedural taint (function summaries + member-chain) + two-pass ordering-bug fix',
  ],
  'binary-instrument': [
    9.5,
    '40 tools, Frida spawn/resume, real Interceptor.attach generation, Unidbg/Ghidra/IDA/JADX',
  ],
  'boringssl-inspector': [9.2, '28 tools, Phase 0 honesty fix + Phase 2 MCP-safe wrappers'],
  browser: [
    9.5,
    '72 tools, worker inspection (browser_list_workers + browser_worker_scripts) + browser_font_fingerprint (queryLocalFonts-first, probe fallback) + CDP all-origin cookies + launch enum validation',
  ],
  canvas: [9.4, '8 tools, Phase 0 adapters + Phase 2 MCP-safe wrappers'],
  coordination: [
    9.2,
    '11 tools, persisted handoffs/insights, tagged insight filtering, handoff status updates, strict severity enum validation',
  ],
  'cross-domain': [
    9.2,
    '7 tools, live-state hydration, edge filtering, expanded workflow classifier, evidence queries, strict chain direction/schema limits',
  ],
  'dart-inspector': [
    9.2,
    '12 tools, 18 tests, Dart-aware classifiers and strict Smi width validation',
  ],
  debugger: [
    9.2,
    '20 tools, run-to-location, breakpoint-hit call stack/scope capture, condition and lifecycle action validation',
  ],
  encoding: [9.6, '5 tools, Phase 3 magic signatures + base32/base58/base85/compression codecs'],
  'exploit-dev': [9.3, '20 tools, Phase 0 capstone x64 one-gadget scan, CLAUDE.md created'],
  'extension-registry': [
    9.4,
    '7 tools, Phase 3 MCP install/info lifecycle with no-import manifest inspection',
  ],
  graphql: [9.4, '6 tools, Phase 3 Apollo Federation _service.sdl introspection'],
  instrumentation: [
    9.2,
    '16 tools, session snapshot export to artifacts, operation status/stop lifecycle, strict type and artifact limit validation',
  ],
  maintenance: [
    9.3,
    '13 tools, sandbox hardening plus category-aware artifact retention cleanup with manifest category routing',
  ],
  memory: [9.7, '34 tools, E5 parity, Phase 0 find_accesses wired readMemory+capstone+pid'],
  'mojo-ipc': [
    9.2,
    '6 tools, encode/filter surface, expanded decoder types, v2 header metadata, field-name decode context',
  ],
  'native-bridge': [
    9.5,
    '6 tools, runtime DomainManifest registration + Rizin/Binary Ninja bridge parity',
  ],
  'native-emulator': [
    9.2,
    '22 tools, 64 tests, E4 finale + session diagnostics + strict Java mock value exclusivity',
  ],
  network: [
    9.2,
    '37 tools, 37 scan-counted tests, DNS resolver-server override + response-body retry schema/runtime alignment',
  ],
  platform: [9.3, '16 tools, Phase 3 ASAR integrity SHA256/SHA512 algorithm awareness'],
  process: [
    9.2,
    '27 tools, Phase 1 suspend/resume + hollowing dumps + MCP-safe wrappers + thread diagnostics + strict memory pattern type validation',
  ],
  'protocol-analysis': [
    9.6,
    '20 tools, Phase 3 +5 protocol fingerprints: MQTT/STUN/QUIC/SOCKS5/HTTP2',
  ],
  proxy: [
    9.3,
    '10 tools, body/timing capture, active rule lifecycle, exact HTTP method matching, strict rule input validation',
  ],
  sourcemap: [9.2, '6 tools, Phase 2 MCP-safe wrappers + shared SSRF private-host policy'],
  streaming: [9.2, '7 tools, MCP-safe wrappers + capture cap schema/runtime alignment'],
  'syscall-hook': [
    9.2,
    '15 tools, PID/return filters, MCP-safe wrappers, richer strace fd/path decoding, bounded capture summaries, strict capture filter validation',
  ],
  trace: [
    9.2,
    '9 tools, category thread tracks, MCP-safe wrappers, structured Runtime console/exception seek context',
  ],
  transform: [9.2, '7 tools, Phase 2 MCP-safe wrappers + transform-chain metadata echo'],
  'v8-inspector': [9.5, '19 tools, 23 scan-counted tests, Tier A+B+D+C all done'],
  wasm: [9.2, '12 tools, Phase 0 instances[0]→instanceIndex fix + Phase 2 MCP-safe wrappers'],
  webgpu: [9.2, '6 tools, 15 tests, command-capture condition wait + format-aware shader caches'],
  workflow: [9.5, '9 tools, Phase 3 macro DSL parallel/branch/fallback/retry orchestration'],
};

const DOMAIN_DIR = 'src/server/domains';
const today = '2026-07-05';

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
