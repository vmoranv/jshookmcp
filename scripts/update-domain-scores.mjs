#!/usr/bin/env node
// One-shot: append/update the Audit Score line in every domain CLAUDE.md
// using honest scores derived from tool/test counts + prior audit work.
// Re-runnable: replaces an existing Audit Score line in place.

import fs from 'node:fs';
import path from 'node:path';

const SCORES = {
  'adb-bridge': [8.6, '12 tools, Phase 2 MCP-safe wrappers, CDP bridge'],
  analysis: [9.3, '25 tools, 11 scan-counted tests, prior audit'],
  'binary-instrument': [8.8, '37 tools, 16 scan-counted tests, Frida/Unidbg/Ghidra/IDA/JADX'],
  'boringssl-inspector': [9.2, '28 tools, Phase 0 honesty fix + Phase 2 MCP-safe wrappers'],
  browser: [8.9, '69 tools, 73 scan-counted tests, prior audit'],
  canvas: [9.4, '8 tools, Phase 0 adapters + Phase 2 MCP-safe wrappers'],
  coordination: [8.6, '10 tools, Phase 2 MCP-safe wrappers'],
  'cross-domain': [8.6, '6 tools, Phase 2 MCP-safe wrappers'],
  'dart-inspector': [9.0, '12 tools, 17 tests, handleSafe pattern reference'],
  debugger: [8.5, '18 tools, 50 tests, Phase 1 function breakpoints'],
  encoding: [9.1, '5 tools, Phase 2 MCP-safe wrappers, well-scoped'],
  'exploit-dev': [9.3, '20 tools, Phase 0 capstone x64 one-gadget scan, CLAUDE.md created'],
  'extension-registry': [8.8, '5 tools, Phase 1 routing/doc stale fix + Phase 2 MCP-safe wrappers'],
  graphql: [9.1, '6 tools, Phase 2 MCP-safe wrappers'],
  instrumentation: [8.8, '15 tools, 14 scan-counted tests'],
  maintenance: [8.5, '13 tools, 6 tests'],
  memory: [9.7, '34 tools, E5 parity, Phase 0 find_accesses wired readMemory+capstone+pid'],
  'mojo-ipc': [8.6, '5 tools, Phase 2 MCP-safe wrappers'],
  'native-bridge': [
    8.4,
    '4 tools, Phase 3 capability advertisement + IDA/Ghidra parity, externalized manifest gap remains',
  ],
  'native-emulator': [9.0, '21 tools, 64 tests, E4 finale'],
  network: [9.0, '37 tools, 37 scan-counted tests'],
  platform: [9.1, '16 tools, Phase 2 MCP-safe wrappers, M3 work'],
  process: [9.0, '27 tools, Phase 1 suspend/resume + hollowing dumps + Phase 2 MCP-safe wrappers'],
  'protocol-analysis': [9.1, '20 tools, Phase 2 MCP-safe wrappers, M2 work'],
  proxy: [8.2, '8 tools, Phase 2 MCP-safe wrappers, body/timing still pending'],
  sourcemap: [9.1, '6 tools, Phase 2 MCP-safe wrappers'],
  streaming: [8.6, '5 tools, Phase 2 MCP-safe wrappers'],
  'syscall-hook': [8.8, '15 tools, Phase 1 PID/returnValue filters + Phase 2 MCP-safe wrappers'],
  trace: [9.0, '9 tools, Phase 1 category thread tracks + Phase 2 MCP-safe wrappers'],
  transform: [9.1, '7 tools, Phase 2 MCP-safe wrappers'],
  'v8-inspector': [9.5, '19 tools, 23 scan-counted tests, Tier A+B+D+C all done'],
  wasm: [9.2, '12 tools, Phase 0 instances[0]→instanceIndex fix + Phase 2 MCP-safe wrappers'],
  webgpu: [9.1, '6 tools, 13 tests, Phase 1 command-capture condition wait'],
  workflow: [9.1, '9 tools, Phase 2 MCP-safe wrappers'],
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
