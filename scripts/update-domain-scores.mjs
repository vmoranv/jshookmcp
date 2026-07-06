#!/usr/bin/env node
// One-shot: append/update the Audit Score line in every domain CLAUDE.md
// using honest scores derived from tool/test counts + prior audit work.
// Re-runnable: replaces an existing Audit Score line in place.

import fs from 'node:fs';
import path from 'node:path';

const SCORES = {
  'adb-bridge': [9.0, '22 tools, install/input/proc maps/root/screenshot + port forward lifecycle'],
  analysis: [
    9.8,
    '25 tools, Phase 3 interprocedural taint (function summaries + member-chain) + two-pass ordering-bug fix',
  ],
  'binary-instrument': [
    9.5,
    '40 tools, Frida spawn/resume, real Interceptor.attach generation, Unidbg/Ghidra/IDA/JADX',
  ],
  'boringssl-inspector': [9.2, '28 tools, Phase 0 honesty fix + Phase 2 MCP-safe wrappers'],
  browser: [9.0, '69 tools, 73 scan-counted tests, CDP all-origin cookie reads'],
  canvas: [9.4, '8 tools, Phase 0 adapters + Phase 2 MCP-safe wrappers'],
  coordination: [9.0, '10 tools, persisted handoffs/insights + tagged insight filtering'],
  'cross-domain': [
    9.0,
    '6 tools, live-state hydration, edge filtering, expanded workflow classifier',
  ],
  'dart-inspector': [9.0, '12 tools, 17 tests, handleSafe pattern reference'],
  debugger: [9.0, '20 tools, run-to-location + breakpoint-hit call stack/scope capture'],
  encoding: [9.6, '5 tools, Phase 3 magic signatures + base32/base58/base85/compression codecs'],
  'exploit-dev': [9.3, '20 tools, Phase 0 capstone x64 one-gadget scan, CLAUDE.md created'],
  'extension-registry': [
    9.4,
    '7 tools, Phase 3 MCP install/info lifecycle with no-import manifest inspection',
  ],
  graphql: [9.4, '6 tools, Phase 3 Apollo Federation _service.sdl introspection'],
  instrumentation: [9.0, '16 tools, Phase 3 session snapshot export to artifacts'],
  maintenance: [9.0, '13 tools, sandbox memory/tool allowlist/redaction hardening, 6 tests'],
  memory: [9.7, '34 tools, E5 parity, Phase 0 find_accesses wired readMemory+capstone+pid'],
  'mojo-ipc': [9.0, '6 tools, encode/filter surface, expanded decoder types + v2 header metadata'],
  'native-bridge': [
    9.5,
    '6 tools, runtime DomainManifest registration + Rizin/Binary Ninja bridge parity',
  ],
  'native-emulator': [9.0, '21 tools, 64 tests, E4 finale'],
  network: [9.0, '37 tools, 37 scan-counted tests'],
  platform: [9.3, '16 tools, Phase 3 ASAR integrity SHA256/SHA512 algorithm awareness'],
  process: [9.0, '27 tools, Phase 1 suspend/resume + hollowing dumps + Phase 2 MCP-safe wrappers'],
  'protocol-analysis': [
    9.6,
    '20 tools, Phase 3 +5 protocol fingerprints: MQTT/STUN/QUIC/SOCKS5/HTTP2',
  ],
  proxy: [9.0, '10 tools, Phase 3 body/timing capture + active rule list/clear lifecycle'],
  sourcemap: [9.1, '6 tools, Phase 2 MCP-safe wrappers'],
  streaming: [9.1, '7 tools, Phase 2 MCP-safe wrappers + Phase 3 payload/export/metadata'],
  'syscall-hook': [
    9.0,
    '15 tools, PID/return filters, MCP-safe wrappers, richer strace fd/path decoding',
  ],
  trace: [9.0, '9 tools, Phase 1 category thread tracks + Phase 2 MCP-safe wrappers'],
  transform: [9.1, '7 tools, Phase 2 MCP-safe wrappers'],
  'v8-inspector': [9.5, '19 tools, 23 scan-counted tests, Tier A+B+D+C all done'],
  wasm: [9.2, '12 tools, Phase 0 instances[0]→instanceIndex fix + Phase 2 MCP-safe wrappers'],
  webgpu: [9.1, '6 tools, 13 tests, Phase 1 command-capture condition wait'],
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
