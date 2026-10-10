/**
 * Runtime verification for the ghidra_bridge TCP backend (kimi-cu report
 * P2-6 option (b)): interop against the REAL jfx-bridge Python server —
 * the same wire stack `pip install ghidra_bridge` runs inside Ghidra.
 * NOT a test — run once:
 *   npx tsx scripts/verify-ghidra-bridge-tcp.ts
 *
 * Covers what mock unit tests cannot: actual framing on both ends, the
 * Python server's serialize/deserialize round-trip, kwargs-as-locals, and
 * the exception-as-result path.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  ghidraBridgeEval,
  ghidraBridgeExec,
  ghidraBridgePing,
  type GhidraBridgeTcpOptions,
} from '../src/server/domains/native-bridge/ghidra-bridge-tcp';

const SERVER_SCRIPT = 'C:/Users/vmoranv/AppData/Local/Temp/jfx-bridge-test-server.py';

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function readReadyLine(child: ChildProcess): Promise<number> {
  return await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('server did not report ready in 15s')), 15_000);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      const match = /JSHOOK_BRIDGE_READY (\d+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`python server exited early (code ${code}): ${buffer.slice(0, 300)}`));
    });
  });
}

async function main(): Promise<void> {
  const child = spawn('python', [SERVER_SCRIPT], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const port = await readReadyLine(child);
    const opts: GhidraBridgeTcpOptions = { port, timeoutMs: 10_000 };
    console.log(`✓ real jfx-bridge Python server listening on 127.0.0.1:${port}`);

    // 1. ping
    if (!(await ghidraBridgePing(opts))) fail('ping returned false against a live server');
    console.log('✓ ping round-trip (eval "True" → true)');

    // 2. basic eval
    const sum = await ghidraBridgeEval('1+1', {}, opts);
    if (sum !== 2) fail(`eval("1+1") returned ${JSON.stringify(sum)}`);
    console.log('✓ eval("1+1") → 2');

    // 3. kwargs become the expression's locals (injection-safety design)
    const doubled = await ghidraBridgeEval('_jshook_x * 2', { _jshook_x: 21 }, opts);
    if (doubled !== 42) fail(`kwargs-as-locals returned ${JSON.stringify(doubled)}`);
    console.log('✓ kwargs travel as locals: eval("_jshook_x * 2", {_jshook_x: 21}) → 42');

    // 4. list of strings round-trip (list_functions shape)
    const names = (await ghidraBridgeEval('["main","WinMain"]', {}, opts)) as string[];
    if (!Array.isArray(names) || names[0] !== 'main') {
      fail(`list round-trip returned ${JSON.stringify(names)}`);
    }
    console.log('✓ list[str] round-trip (list_functions result shape)');

    // 5. exception-as-result (remote eval failure surfaces the message)
    let remoteError: string | undefined;
    try {
      await ghidraBridgeEval('_jshook_undefined_name_xyz', {}, opts);
    } catch (error) {
      remoteError = (error as Error).message;
    }
    if (!remoteError || !remoteError.includes('remote eval failed')) {
      fail(`expected a remote eval failure, got: ${remoteError}`);
    }
    console.log(`✓ remote exception surfaces the message: "${remoteError.slice(0, 80)}..."`);

    // 6. exec-then-eval (the decompile_function pattern: define a helper, call it)
    await ghidraBridgeExec(
      ['def _jshook_add_one(_jshook_a):', '    return _jshook_a + 1'].join('\n'),
      {},
      opts,
    );
    const fortyTwo = await ghidraBridgeEval('_jshook_add_one(_jshook_a)', { _jshook_a: 41 }, opts);
    if (fortyTwo !== 42) fail(`exec+eval helper pattern returned ${JSON.stringify(fortyTwo)}`);
    console.log('✓ exec defines a helper, eval calls it with kwargs → 42 (decompile pattern)');

    // 7. exec returns none
    const execResult = await ghidraBridgeEval('_jshook_add_one(1) is None', {}, opts);
    if (execResult !== false) fail(`sanity check failed: ${JSON.stringify(execResult)}`);

    console.log('\nALL GHIDRA-BRIDGE-TCP INTEROP VERIFICATIONS PASSED');
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(`\nVERIFICATION FAILED: ${(error as Error).message}`);
  process.exitCode = 1;
});
