/**
 * Throughput benchmark for the self-built ARM64 interpreter (L0).
 *
 * Zero external deps, so tsx runs it directly:
 *   npx tsx scripts/native-emulator-bench.ts
 *
 * Constructs a long linear run of `add x0, x0, x1` (0x8b010000) and measures
 * sustained instruction throughput. Reports best-of-N to filter JIT warmup
 * and GC noise. Verifies the final accumulator to guard against an
 * "optimization" that silently breaks semantics.
 */
import { CpuEngine } from '../src/modules/native-emulator/CpuEngine.ts';

const INSN = new Uint8Array([0x00, 0x00, 0x01, 0x8b]); // add x0, x0, x1
const COUNT = 50_000;
const BASE = 0x10000;
const ROUNDS = 8;

function buildProgram(count: number): Uint8Array {
  const buf = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) buf.set(INSN, i * 4);
  return buf;
}

function runOnce(program: Uint8Array): { ns: number; x0: number } {
  const engine = new CpuEngine();
  engine.mapMemory(BASE, program.length + 16);
  engine.writeCode(BASE, program);
  engine.writeRegister('x0', 0);
  engine.writeRegister('x1', 1);
  const t0 = process.hrtime.bigint();
  engine.start(BASE, BASE + program.length);
  const t1 = process.hrtime.bigint();
  return { ns: Number(t1 - t0), x0: engine.readRegister('x0') };
}

const program = buildProgram(COUNT);

// Warmup (let V8 tier up the hot loop).
for (let i = 0; i < 3; i++) runOnce(program);

let bestNs = Infinity;
let lastX0 = -1;
for (let i = 0; i < ROUNDS; i++) {
  const { ns, x0 } = runOnce(program);
  lastX0 = x0;
  if (ns < bestNs) bestNs = ns;
}

const correct = lastX0 === COUNT;
const insnPerSec = Math.round((COUNT / bestNs) * 1e9);
const nsPerInsn = (bestNs / COUNT).toFixed(2);

console.log(
  JSON.stringify(
    {
      count: COUNT,
      rounds: ROUNDS,
      best_ms: (bestNs / 1e6).toFixed(3),
      ns_per_insn: nsPerInsn,
      insn_per_sec: insnPerSec,
      insn_per_sec_human: `${(insnPerSec / 1e6).toFixed(2)}M`,
      final_x0: lastX0,
      correct,
    },
    null,
    2,
  ),
);

if (!correct) {
  console.error(`SEMANTIC REGRESSION: expected x0=${COUNT}, got ${lastX0}`);
  process.exit(1);
}
