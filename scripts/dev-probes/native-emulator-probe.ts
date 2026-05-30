/**
 * native-emulator real-`.so` probe — gated coverage report (Phase 5).
 *
 * Loads every `lib/arm64-v8a/*.so` it can find under a sample-artifacts root and
 * reports, per library: whether the ELF mapped + relocated, how many symbols
 * resolved, and — when a symbol is invoked — the histogram of opcodes that still
 * throw "Unsupported ARM64 opcode". This is the empirical gap tracker: as the
 * ISA fills in, the histogram shrinks. It is NOT a CI test (no real `.so` is
 * committed); it runs only against whatever binaries exist locally.
 *
 *   npx tsx scripts/dev-probes/native-emulator-probe.ts [rootDir]
 *
 * Default root: .tmp_mcp_artifacts/jadx-apk-test/resources/lib/arm64-v8a
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { CpuEngine } from '../../src/modules/native-emulator/CpuEngine';
import { createBionicLibrary } from '../../src/modules/native-emulator/bionic';

const DEFAULT_ROOT = '.tmp_mcp_artifacts/jadx-apk-test/resources/lib/arm64-v8a';
const root = process.argv[2] ?? DEFAULT_ROOT;

if (!existsSync(root)) {
  console.log(`[probe] root not found, skipping: ${root}`);
  process.exit(0);
}

const sos = readdirSync(root).filter((f) => f.endsWith('.so'));
if (sos.length === 0) {
  console.log(`[probe] no .so under ${root}, skipping`);
  process.exit(0);
}

/** Extract the "0x........" opcode from an unsupported-opcode error message. */
function opcodeOf(message: string): string | null {
  const m = /Unsupported ARM64 opcode (0x[0-9a-f]+)/.exec(message);
  return m ? m[1]! : null;
}

const opcodeHistogram = new Map<string, number>();
let loadedCount = 0;

for (const name of sos) {
  const bytes = new Uint8Array(readFileSync(join(root, name)));
  const engine = new CpuEngine();
  let entry = 0;
  let symbols: string[] = [];
  try {
    ({ entry } = engine.loadElf(bytes, createBionicLibrary(engine)));
    symbols = engine.exportedSymbolNames();
    loadedCount++;
  } catch (e) {
    console.log(`✗ ${name}: load failed — ${String(e).slice(0, 120)}`);
    continue;
  }

  // Try executing a handful of exported symbols to surface unimplemented opcodes.
  let ran = 0;
  let unsupported = 0;
  const tryable = symbols.filter((s) => s.startsWith('Java_') || /^[a-z]/.test(s)).slice(0, 25);
  for (const sym of tryable) {
    const probe = new CpuEngine();
    try {
      probe.loadElf(bytes, createBionicLibrary(probe));
      probe.callSymbol(sym, [0, 0, 0, 0]);
      ran++;
    } catch (e) {
      const op = opcodeOf(String(e));
      if (op) {
        unsupported++;
        opcodeHistogram.set(op, (opcodeHistogram.get(op) ?? 0) + 1);
      }
    }
  }
  console.log(
    `✓ ${name}: entry=0x${entry.toString(16)}, symbols=${symbols.length}, ` +
      `probed=${tryable.length} (ran-to-return=${ran}, hit-unsupported=${unsupported})`,
  );
}

console.log(`\n[probe] ${loadedCount}/${sos.length} libraries mapped + relocated`);
if (opcodeHistogram.size > 0) {
  const sorted = [...opcodeHistogram.entries()].toSorted((a, b) => b[1] - a[1]);
  console.log(`[probe] top unimplemented opcodes (opcode → times hit across probed symbols):`);
  for (const [op, n] of sorted.slice(0, 25)) console.log(`  ${op}  ×${n}`);
} else {
  console.log(`[probe] no unsupported-opcode throws across probed symbols`);
}
