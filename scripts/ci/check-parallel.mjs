// Runs the two expensive, independent `pnpm check` legs concurrently:
//   - typecheck (tsc main project + extension-sdk)
//   - test (run-vitest-smart)
// The remaining guard scripts (metadata/openapi/domain/event/promise audits,
// lint, format) stay serial ahead of this — they are seconds-fast and provide
// the fastest possible fail signal on drift.
//
// Memory: both legs allocate multiple GB (vitest fork pool + tsc). On
// memory-constrained machines set CHECK_SERIAL=1 to fall back to the fully
// serial chain. This mirrors the reasoning documented in lefthook.yml's
// pre-push section, which stays serial because coverage remapping peaks
// higher than plain `pnpm test`.
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npm = isWin ? 'pnpm.cmd' : 'pnpm';

function run(script, label) {
  return new Promise((resolve) => {
    const child = spawn(npm, ['run', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWin,
    });
    let output = '';
    const forward = (chunk) => {
      const text = chunk.toString();
      output += text;
      // Pipe through with a leg prefix so interleaved output stays attributable.
      process.stderr.write(text);
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('exit', (code) => resolve({ label, code: code ?? 1, output }));
    child.on('error', (err) => {
      process.stderr.write(`[${label}] spawn failed: ${err.message}\n`);
      resolve({ label, code: 1, output });
    });
  });
}

const legs =
  process.env.CHECK_SERIAL === '1' ? [] : [run('typecheck', 'typecheck'), run('test', 'test')];

// Serial fallback: keep the original behaviour (guards then typecheck then test).
if (legs.length === 0) {
  const result = await run('typecheck', 'typecheck');
  if (result.code !== 0) process.exit(result.code);
  const testResult = await run('test', 'test');
  process.exit(testResult.code);
}

const results = await Promise.all(legs);
const failed = results.filter((r) => r.code !== 0);
if (failed.length > 0) {
  process.stderr.write(
    `\n[check:parallel] failed legs: ${failed.map((f) => f.label).join(', ')}\n`,
  );
  process.exit(1);
}
process.exit(0);
