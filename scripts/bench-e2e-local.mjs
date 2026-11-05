#!/usr/bin/env node
// Deterministic, offline wrapper around `bench:e2e`.
//
// WHY THIS EXISTS
// ---------------
// `pnpm bench:e2e` needs a live HTTP origin at E2E_TARGET_URL. Pointing it at
// the public GitHub Pages site couples the measurement to external network +
// a third-party deploy. This wrapper starts the repo's own, dependency-free
// fixture server (scripts/serve-e2e-fixture.mjs), waits for readiness, runs the
// real pass^k measurement against http://127.0.0.1:<port>/, then ALWAYS stops
// the server (even on failure / signal).
//
// Both CI (.github/workflows/ci.yml) and local contributors use this single
// entry point, so the server lifecycle is defined in ONE place, not duplicated
// in YAML shell. `pnpm bench:e2e` (public target) stays as-is for the
// documented public-target path; `pnpm bench:e2e:local` is the offline one.
//
// No new dependencies: node:child_process + node:http only.

import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';

const PORT = Number.parseInt(process.env.E2E_FIXTURE_PORT ?? '4173', 10);
const HOST = '127.0.0.1';
const TARGET_URL = `http://${HOST}:${PORT}/`;

const server = spawn(process.execPath, ['scripts/serve-e2e-fixture.mjs'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, E2E_FIXTURE_PORT: String(PORT) },
});

// Surface fixture logs with a prefix so they are attributable in CI output.
server.stdout.on('data', (c) => process.stdout.write(`[fixture] ${c}`));
server.stderr.on('data', (c) => process.stderr.write(`[fixture] ${c}`));

let stopped = false;
function stopServer() {
  if (stopped) return;
  stopped = true;
  if (server.exitCode === null) server.kill('SIGTERM');
}
process.on('SIGINT', () => {
  stopServer();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopServer();
  process.exit(143);
});
process.on('exit', stopServer);

function probeReady() {
  return new Promise((resolve) => {
    const req = http.get(`${TARGET_URL}`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForReady(attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    if (await probeReady()) return true;
    if (server.exitCode !== null) return false; // server died
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

const ready = await waitForReady();
if (!ready) {
  console.error('[bench:e2e:local] fixture server failed to become ready');
  stopServer();
  process.exit(1);
}
console.log(`[bench:e2e:local] fixture ready at ${TARGET_URL}`);

// Run the REAL measurement (3 rounds, pass^k) against the local origin.
const result = spawnSync('corepack', ['pnpm', 'run', 'bench:e2e'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    E2E_TARGET_URL: TARGET_URL,
    E2E_FIXTURE_PORT: String(PORT),
    PUPPETEER_HEADLESS: process.env.PUPPETEER_HEADLESS ?? 'true',
    VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? '2',
  },
});

stopServer();
// Give the child a tick to close cleanly before we exit.
await Promise.race([once(server, 'exit').catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);

process.exit(result.status ?? 1);
