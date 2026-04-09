import { cpus } from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const DEFAULT_IDLE_TARGET = 0.8;
const DEFAULT_SAMPLE_MS = 750;
const require = createRequire(import.meta.url);
const vitestPackageJson = require.resolve('vitest/package.json');
const vitestEntrypoint = join(dirname(vitestPackageJson), 'vitest.mjs');

function parsePositiveInt(rawValue, fallback) {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(rawValue, fallback) {
  const parsed = Number.parseFloat(rawValue ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function snapshotCpuTimes() {
  return cpus().map((cpu) => ({ ...cpu.times }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeIdleRatio(before, after) {
  let idleDelta = 0;
  let totalDelta = 0;

  for (let index = 0; index < Math.min(before.length, after.length); index += 1) {
    const prev = before[index];
    const next = after[index];
    const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
    const nextTotal = next.user + next.nice + next.sys + next.idle + next.irq;
    idleDelta += Math.max(0, next.idle - prev.idle);
    totalDelta += Math.max(0, nextTotal - prevTotal);
  }

  if (totalDelta <= 0) {
    return 1;
  }

  return Math.min(1, Math.max(0, idleDelta / totalDelta));
}

async function determineVitestWorkers() {
  const logicalCpuCount = Math.max(1, cpus().length);
  const explicitWorkers = parsePositiveInt(process.env.VITEST_MAX_WORKERS, 0);
  if (explicitWorkers > 0) {
    return Math.min(explicitWorkers, logicalCpuCount);
  }

  const sampleWindowMs = parsePositiveInt(process.env.VITEST_CPU_SAMPLE_MS, DEFAULT_SAMPLE_MS);
  const idleTarget = parsePositiveFloat(
    process.env.VITEST_IDLE_RESOURCE_TARGET,
    DEFAULT_IDLE_TARGET,
  );
  const minWorkers = Math.min(logicalCpuCount, parsePositiveInt(process.env.VITEST_MIN_WORKERS, 1));
  const maxWorkers = Math.min(
    logicalCpuCount,
    parsePositiveInt(process.env.VITEST_MAX_WORKERS_CAP, logicalCpuCount),
  );

  const before = snapshotCpuTimes();
  await sleep(sampleWindowMs);
  const after = snapshotCpuTimes();
  const idleRatio = computeIdleRatio(before, after);
  const workerBudget = Math.floor(logicalCpuCount * idleRatio * idleTarget);

  return Math.max(minWorkers, Math.min(maxWorkers, workerBudget || 1));
}

async function main() {
  const vitestArgs = process.argv.slice(2);
  const workerCount = await determineVitestWorkers();
  const args = [vitestEntrypoint, ...vitestArgs, '--maxWorkers', String(workerCount)];

  console.log(
    `[vitest-smart] launching vitest with maxWorkers=${workerCount} on ${cpus().length} logical CPUs`,
  );

  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      VITEST_MAX_WORKERS: String(workerCount),
    },
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

await main();
