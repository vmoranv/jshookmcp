import { CpuEngine } from '../../src/modules/native-emulator/CpuEngine.ts';

const iterations = 1_000_000;

console.log('Benchmarking FP operations with exception handling...\n');
console.log(`Iterations: ${iterations.toLocaleString()}\n`);

// Baseline: 纯 JS 操作
console.log('=== Baseline (Pure JS) ===');
let baselineStart = performance.now();
for (let i = 0; i < iterations; i++) {
  const _ = 1.5 + 2.5;
}
const baselineAddTime = performance.now() - baselineStart;

baselineStart = performance.now();
for (let i = 0; i < iterations; i++) {
  const _ = 3.5 * 2.0;
}
const baselineMulTime = performance.now() - baselineStart;

baselineStart = performance.now();
for (let i = 0; i < iterations; i++) {
  const _ = 7.0 / 2.0;
}
const baselineDivTime = performance.now() - baselineStart;

console.log(`ADD: ${baselineAddTime.toFixed(2)} ms`);
console.log(`MUL: ${baselineMulTime.toFixed(2)} ms`);
console.log(`DIV: ${baselineDivTime.toFixed(2)} ms\n`);

// Fast path (FPCR=0, default config)
console.log('=== Fast Path (FPCR=0) ===');
const engineFast = new CpuEngine();
engineFast.setFPCR(0);

let fastStart = performance.now();
for (let i = 0; i < iterations; i++) {
  engineFast.fadd(1.5, 2.5);
}
const fastAddTime = performance.now() - fastStart;

fastStart = performance.now();
for (let i = 0; i < iterations; i++) {
  engineFast.fmul(3.5, 2.0);
}
const fastMulTime = performance.now() - fastStart;

fastStart = performance.now();
for (let i = 0; i < iterations; i++) {
  engineFast.fdiv(7.0, 2.0);
}
const fastDivTime = performance.now() - fastStart;

console.log(`ADD: ${fastAddTime.toFixed(2)} ms`);
console.log(`MUL: ${fastMulTime.toFixed(2)} ms`);
console.log(`DIV: ${fastDivTime.toFixed(2)} ms\n`);

// Slow path (FPCR with trap enabled, forces slow path)
console.log('=== Slow Path (FPCR with IOE trap enabled) ===');
const engineSlow = new CpuEngine();
engineSlow.setFPCR(0x100); // Enable IOE trap at bit 8

let slowStart = performance.now();
for (let i = 0; i < iterations; i++) {
  engineSlow.fadd(1.5, 2.5);
}
const slowAddTime = performance.now() - slowStart;

slowStart = performance.now();
for (let i = 0; i < iterations; i++) {
  engineSlow.fmul(3.5, 2.0);
}
const slowMulTime = performance.now() - slowStart;

slowStart = performance.now();
for (let i = 0; i < iterations; i++) {
  engineSlow.fdiv(7.0, 2.0);
}
const slowDivTime = performance.now() - slowStart;

console.log(`ADD: ${slowAddTime.toFixed(2)} ms`);
console.log(`MUL: ${slowMulTime.toFixed(2)} ms`);
console.log(`DIV: ${slowDivTime.toFixed(2)} ms\n`);

// Calculate overhead
console.log('=== Fast Path Overhead (vs Pure JS) ===');
const addOverheadFast = (((fastAddTime - baselineAddTime) / baselineAddTime) * 100).toFixed(2);
const mulOverheadFast = (((fastMulTime - baselineMulTime) / baselineMulTime) * 100).toFixed(2);
const divOverheadFast = (((fastDivTime - baselineDivTime) / baselineDivTime) * 100).toFixed(2);

console.log(`ADD: ${addOverheadFast}%`);
console.log(`MUL: ${mulOverheadFast}%`);
console.log(`DIV: ${divOverheadFast}%\n`);

console.log('=== Slow Path Overhead (vs Pure JS) ===');
const addOverheadSlow = (((slowAddTime - baselineAddTime) / baselineAddTime) * 100).toFixed(2);
const mulOverheadSlow = (((slowMulTime - baselineMulTime) / baselineMulTime) * 100).toFixed(2);
const divOverheadSlow = (((slowDivTime - baselineDivTime) / baselineDivTime) * 100).toFixed(2);

console.log(`ADD: ${addOverheadSlow}%`);
console.log(`MUL: ${mulOverheadSlow}%`);
console.log(`DIV: ${divOverheadSlow}%\n`);

// Per-operation cost
console.log('=== Per-Operation Cost (Fast Path) ===');
const addCostNs = (((fastAddTime - baselineAddTime) / iterations) * 1_000_000).toFixed(2);
const mulCostNs = (((fastMulTime - baselineMulTime) / iterations) * 1_000_000).toFixed(2);
const divCostNs = (((fastDivTime - baselineDivTime) / iterations) * 1_000_000).toFixed(2);

console.log(`ADD: ${addCostNs} ns`);
console.log(`MUL: ${mulCostNs} ns`);
console.log(`DIV: ${divCostNs} ns\n`);

// Overall assessment
const avgOverheadFast =
  (parseFloat(addOverheadFast) + parseFloat(mulOverheadFast) + parseFloat(divOverheadFast)) / 3;
console.log('=== Assessment ===');
console.log(`Fast path average overhead: ${avgOverheadFast.toFixed(2)}%`);
console.log(
  `Slow path average overhead: ${((parseFloat(addOverheadSlow) + parseFloat(mulOverheadSlow) + parseFloat(divOverheadSlow)) / 3).toFixed(2)}%`,
);

if (avgOverheadFast < 100) {
  console.log('✅ PASS: Fast path overhead < 100% (target met!)');
  process.exit(0);
} else if (avgOverheadFast < 200) {
  console.log('⚠️  WARNING: Fast path overhead 100-200% (good but not optimal)');
  process.exit(0);
} else {
  console.log('❌ FAIL: Fast path overhead exceeds 200%');
  process.exit(1);
}
