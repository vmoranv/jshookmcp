/**
 * Runtime verification for the kimi-cu report fixes (NOT a test — run once):
 *   npx tsx scripts/verify-kimi-fixes.ts
 *
 * Reproduces the exact pain points from the 2026-10-08 report against a real
 * frida 17.x CLI on this Windows host:
 *   P1-1: sync run_script dies before setTimeout fires → keepAlive must fix it
 *   P1-3: Module.findExportByName / Process.getCurrentPid removed in frida 17
 *         → shim must restore them
 *   P2-5: failure responses lose stderr → exitCode/stderr must survive
 */
import { spawn } from 'node:child_process';
import { FridaSession } from '../src/modules/binary-instrument/FridaSession';

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function main(): Promise<void> {
  const frida = new FridaSession();
  const availability = await frida.getAvailability();
  if (!availability.available) {
    fail(`frida CLI not available: ${availability.reason ?? 'unknown'}`);
  }
  console.log(`✓ frida CLI available: ${availability.path} (version ${availability.version})`);

  // Host process target: keep it alive for the whole verification window.
  const target = spawn('ping', ['-n', '300', '127.0.0.1'], { stdio: 'ignore' });
  try {
    const sessionId = await frida.attach(String(target.pid));
    console.log(`✓ attached to ping pid ${target.pid} (session ${sessionId})`);

    // ── Verify P1-3: frida 17 compat shim restores removed APIs ──
    const probe = await frida.executeScript(
      [
        'var out = [];',
        'out.push("shim_marker=" + (globalThis.__jshookShim === true));',
        'out.push("findExportByName_type=" + typeof Module.findExportByName);',
        'try {',
        '  var addr = Module.findExportByName("kernel32.dll", "CreateFileW");',
        '  out.push("kernel32_CreateFileW=" + (addr !== null && addr !== undefined));',
        '} catch (e) { out.push("kernel32_CreateFileW threw: " + e); }',
        'try {',
        '  var m = Process.getModuleByName("kernel32.dll");',
        '  out.push("module_instance_fallback=" + (typeof m.findExportByName === "function"));',
        '} catch (e) { out.push("module_instance_fallback threw: " + e); }',
        'out.push("getCurrentPid=" + (typeof Process.getCurrentPid === "function" ? Process.getCurrentPid() : "missing"));',
        'console.log(out.join(" | "));',
      ].join('\n'),
    );
    if (probe.error) fail(`P1-3 probe failed: ${probe.error}`);
    const checks: Array<[string, boolean]> = [
      ['shim injected', probe.output.includes('shim_marker=true')],
      [
        'Module.findExportByName restored (static)',
        probe.output.includes('findExportByName_type=function') &&
          probe.output.includes('kernel32_CreateFileW=true'),
      ],
      ['Process.getCurrentPid restored', /\bgetCurrentPid=\d+/.test(probe.output)],
    ];
    for (const [label, ok] of checks) {
      if (!ok) fail(`P1-3 ${label}: got "${probe.output}"`);
      console.log(`✓ P1-3 ${label}`);
    }

    // ── Verify P1-1: keepAlive keeps timers alive in sync mode ──
    const before = Date.now();
    const kept = await frida.executeScript(
      'console.log("immediate"); setTimeout(function () { console.log("after-4s"); }, 4000);',
      { keepAlive: true, timeoutMs: 12_000 },
    );
    const took = Date.now() - before;
    if (!kept.output.includes('immediate')) fail(`P1-1 missing immediate output: ${kept.output}`);
    if (!kept.output.includes('after-4s')) {
      fail(`P1-1 timer output lost (report P1-1 regression): output="${kept.output}"`);
    }
    if (took < 3_500) fail(`P1-1 keepAlive returned too early (${took}ms) — latch did not park`);
    console.log(`✓ P1-1 keepAlive captured delayed timer output in ${took}ms (report P1-1 fixed)`);

    // ── Verify P1-1 control (no keepAlive): latch absent, fast return ──
    const fast = await frida.executeScript(
      'console.log("ctrl_immediate"); setTimeout(function () { console.log("ctrl_after"); }, 2000);',
      { timeoutMs: 10_000 },
    );
    if (!fast.output.includes('ctrl_immediate')) fail(`control run lost immediate output`);
    if (fast.output.includes('ctrl_after')) {
      console.log(`⚠ control: timer fired without keepAlive (frida may have waited) — acceptable`);
    } else {
      console.log(`✓ control: without keepAlive the CLI tears down before the timer (baseline)`);
    }

    // ── Verify P2-5: non-zero exit preserves output + stack + exitCode ──
    // Note: the frida CLI (-q -e, piped) prints script errors to STDOUT, not
    // stderr — verified experimentally; the stack arrives via execution.output.
    const boom = await frida.executeScript(
      'console.log("pre-crash output"); nullPointed.crash();',
      { timeoutMs: 10_000 },
    );
    const preCrashKept = boom.output.includes('pre-crash output');
    const stackKept =
      boom.output.includes('ReferenceError') ||
      (boom.stderr ?? '').includes('ReferenceError') ||
      (boom.error ?? '').includes('ReferenceError');
    if (!preCrashKept) fail(`P2-5 stdout lost on non-zero exit: output="${boom.output}"`);
    if (!stackKept) {
      fail(
        `P2-5 script stack lost: error="${boom.error}" stderr="${boom.stderr}" output="${boom.output}"`,
      );
    }
    if (boom.exitCode === undefined) fail(`P2-5 exitCode missing (got undefined)`);
    console.log(
      `✓ P2-5 non-zero exit keeps stdout + ReferenceError stack (exitCode=${boom.exitCode})`,
    );

    await frida.detach();
    console.log('\nALL RUNTIME VERIFICATIONS PASSED');
  } finally {
    target.kill();
  }
}

main().catch((error) => {
  console.error(`\nVERIFICATION FAILED: ${(error as Error).message}`);
});
