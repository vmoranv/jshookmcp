/**
 * Runtime verification for the stateless Ghidra headless decompile backend
 * (kimi-cu report P2-6 / R-05). NOT a test — run once against the host's
 * real Ghidra install:
 *   npx tsx scripts/verify-ghidra-headless.ts [binaryPath]
 *
 * Reproduces the agent workflow end-to-end through the jshook layer:
 *   1. ghidra_analyze   → list function names (DumpAll postScript)
 *   2. ghidra_decompile → decompile the first listed name via the new
 *      stateless headless path (no plugin_ghidra_bridge, no HTTP server)
 *   3. a name-miss returns found:false with an actionable hint
 */
import { GhidraAnalyzer } from '../src/modules/binary-instrument/GhidraAnalyzer';

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function main(): Promise<void> {
  const binaryPath = process.argv[2] ?? 'C:/Windows/System32/winver.exe';
  const analyzer = new GhidraAnalyzer();

  const availability = await analyzer.getAvailability();
  if (!availability.available) {
    fail(`Ghidra analyzeHeadless unavailable: ${availability.reason ?? 'unknown'}`);
  }
  console.log(`✓ Ghidra analyzeHeadless available: ${availability.path} (${availability.version})`);

  // ── 1. analyze: list functions through the built-in DumpAll script ──
  console.log(`⏳ ghidra_analyze on ${binaryPath} (full analysis, this is the slow part)...`);
  const started = Date.now();
  const analysis = await analyzer.analyze(binaryPath, { timeout: 300_000, forceRefresh: true });
  const analyzeTook = Date.now() - started;
  if (analysis.functions.length === 0) {
    fail('ghidra_analyze produced no functions — cannot proceed to decompile');
  }
  console.log(
    `✓ ghidra_analyze: ${analysis.functions.length} functions in ${(analyzeTook / 1000).toFixed(1)}s`,
  );

  // ── 2. decompile the first listed function via the stateless path ──
  const target = analysis.functions[0];
  console.log(`⏳ ghidra_decompile (headless) on "${target.name}" @ ${target.address}...`);
  const decompStarted = Date.now();
  const result = await analyzer.decompileFunction(binaryPath, target.name, { timeout: 300_000 });
  const decompileTook = Date.now() - decompStarted;
  if (!result.found) {
    fail(
      `decompileFunction found=false for a name from our own analyze output: ${JSON.stringify(result)}`,
    );
  }
  const decompiled = result.functions[0]?.decompiled ?? '';
  if (decompiled.trim().length === 0) {
    fail(`decompiled body empty for ${target.name}`);
  }
  console.log(
    `✓ ghidra_decompile (stateless headless): "${target.name}" → ${decompiled.split('\n').length} lines of C in ${(decompileTook / 1000).toFixed(1)}s`,
  );
  console.log('  first lines of the decompiled body:');
  for (const line of decompiled.split('\n').slice(0, 4)) {
    console.log(`  | ${line}`);
  }

  // ── 3. name-miss returns found:false (actionable, not an opaque error) ──
  const miss = await analyzer.decompileFunction(binaryPath, '__definitely_not_a_function__', {
    timeout: 300_000,
  });
  if (miss.found !== false || miss.functions.length !== 0) {
    fail(`name miss should return found:false, got ${JSON.stringify(miss).slice(0, 200)}`);
  }
  console.log(
    '✓ name miss returns found:false with empty functions (agent gets an actionable miss)',
  );

  console.log('\nALL GHIDRA HEADLESS VERIFICATIONS PASSED');
  console.log(
    `note: stateless = fresh analyzeHeadless project per call (${(decompileTook / 1000).toFixed(1)}s per decompile) — the report-accepted tradeoff for zero bridge dependencies`,
  );
}

main().catch((error) => {
  console.error(`\nVERIFICATION FAILED: ${(error as Error).message}`);
});
