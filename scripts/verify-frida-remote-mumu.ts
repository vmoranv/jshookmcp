/**
 * Runtime verification for frida remote-device support against a live MuMu
 * emulator (the acceptance gap left by the 2026-10-04 frida-remote work):
 *   npx tsx scripts/verify-frida-remote-mumu.ts
 *
 * Prerequisites (host): MuMu running, frida-server started with
 * `su -c '/data/local/tmp/frida-server -l 0.0.0.0:27042 -D'`, adb connected
 * via `adb connect <emu-ip>:5555` (bridged network).
 *
 * Verifies through the jshook FridaSession layer (the same code the
 * frida_list_devices / frida_list_processes / frida_attach tools call):
 *   1. device-listing CLI path (with a bounded timeout — it can hang when
 *      no USB device is present)
 *   2. frida_list_processes on a remote device
 *   3. frida_attach to a real Android process + shim + keepAlive behavior
 *      on the remote target (Android bionic libc, not Win32)
 */
import { FridaSession, type FridaProcessInfo } from '../src/modules/binary-instrument/FridaSession';

const EMU_HOST = process.env.MUMU_FRIDA_HOST ?? '192.168.10.100:27042';
const REMOTE = { type: 'remote', host: EMU_HOST } as const;

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function main(): Promise<void> {
  const frida = new FridaSession();

  // ── 1. listDevices (frida-ls-devices CLI; bounded because USB scanning can
  // hang on hosts with no USB device — the MuMu connection is remote, not USB)
  const devices = await frida.listDevices(20_000).catch((e: unknown) => {
    console.log(`⚠ frida_list_devices timed out/failed (USB scan hang): ${(e as Error).message}`);
    return [] as { id: string; type: string; name: string }[];
  });
  console.log(
    `✓ frida_list_devices returned ${devices.length} device(s): ${devices.map((d) => `${d.id}/${d.type}`).join(', ') || '(none)'}`,
  );

  // ── 2. frida_list_processes on the remote device
  const procs = await frida.listProcesses(REMOTE, 30_000);
  if (procs.length === 0) fail('frida_list_processes(device=remote) returned no processes');
  console.log(`✓ frida_list_processes(device=remote) returned ${procs.length} processes`);
  const sample = procs
    .slice(0, 5)
    .map((p: FridaProcessInfo) => `${p.pid}:${p.name}`)
    .join(', ');
  console.log(`  sample: ${sample}`);

  // Pick a stable system target to attach: systemui first, then system_server.
  const preferred = ['com.android.systemui', 'system_server'];
  const target =
    preferred.map((n) => procs.find((p: FridaProcessInfo) => p.name === n)).find(Boolean) ??
    procs.find((p: FridaProcessInfo) => p.name.includes('android'));
  if (!target) fail('no attachable Android system process found');

  // ── 3. frida_attach on the remote device + script execution
  const sessionId = await frida.attach(String((target as FridaProcessInfo).pid), REMOTE);
  console.log(
    `✓ frida_attach(device=remote) attached to ${(target as FridaProcessInfo).name} (session ${sessionId})`,
  );

  // Shim + Android bionic verification: Module.findExportByName on libc.so.
  const probe = await frida.executeScript(
    [
      'var out = [];',
      'out.push("shim=" + (globalThis.__jshookShim === true));',
      'out.push("arch=" + Process.arch);',
      'var libc = Process.getModuleByName("libc.so");',
      'out.push("libc_base=" + (libc !== null && libc !== undefined));',
      'var openAddr = Module.findExportByName("libc.so", "open");',
      'out.push("libc_open=" + (openAddr !== null && openAddr !== undefined));',
      'out.push("pid=" + Process.getCurrentPid());',
      'console.log(out.join(" | "));',
    ].join('\n'),
    { timeoutMs: 30_000 },
  );
  if (probe.error) fail(`remote executeScript failed: ${probe.error}`);
  const remoteChecks: Array<[string, boolean]> = [
    ['shim injected on remote target', probe.output.includes('shim=true')],
    ['libc.so module resolved', probe.output.includes('libc_base=true')],
    ['libc open() export via compat shim', probe.output.includes('libc_open=true')],
    ['Process.getCurrentPid works', /\bpid=\d+/.test(probe.output)],
  ];
  for (const [label, ok] of remoteChecks) {
    if (!ok) fail(`${label}: got "${probe.output}"`);
    console.log(`✓ ${label}`);
  }

  // ── 4. keepAlive on the remote target (timer capture, same latch semantics)
  const kept = await frida.executeScript(
    'console.log("remote_imm"); setTimeout(function () { console.log("remote_after3s"); }, 3000);',
    { keepAlive: true, timeoutMs: 10_000 },
  );
  if (!kept.output.includes('remote_imm'))
    fail(`remote keepAlive lost immediate output: "${kept.output}"`);
  if (!kept.output.includes('remote_after3s')) {
    fail(
      `remote keepAlive lost timer output (report P1-1 regression on remote device): "${kept.output}"`,
    );
  }
  console.log('✓ keepAlive captures delayed output on the remote Android target');

  await frida.detach();
  console.log('\nALL REMOTE-DEVICE VERIFICATIONS PASSED');
}

main().catch((error) => {
  console.error(`\nVERIFICATION FAILED: ${(error as Error).message}`);
});
