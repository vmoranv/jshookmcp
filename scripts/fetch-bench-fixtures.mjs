#!/usr/bin/env node
/**
 * Fetch official benchmark fixtures (reproducible; no homemade ground truth):
 *
 *  1. pmndrs/detect-gpu official benchmark database (per-vendor JSON, PassMark-backed)
 *     from the npm registry tarball — used by the maintenance GPU-classification suite.
 *  2. tc39/source-map-tests official conformance fixtures (valid + invalid .map files,
 *     scopes fixtures, .golden expected outputs) — used by the sourcemap suite.
 *
 * Files land in tests/benchmarks/fixtures/ and are committed so the gate does not
 * depend on network access; re-run this script to refresh them.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = process.cwd();
const fixturesDir = resolve(root, 'tests/benchmarks/fixtures');
mkdirSync(fixturesDir, { recursive: true });

function curl(url, out, { maxTime = 90 } = {}) {
  const res = spawnSync('curl', ['-sL', '--max-time', String(maxTime), url, '-o', out], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return res.status === 0 && existsSync(out);
}

// ── 1. detect-gpu official benchmark database ──
console.log('[fetch] detect-gpu official benchmark data…');
{
  const metaTmp = '/tmp/dg-meta.json';
  if (!curl('https://registry.npmjs.org/detect-gpu/latest', metaTmp, { maxTime: 30 })) {
    console.error('  npm registry unreachable');
    process.exit(1);
  }
  const meta = JSON.parse(readFileSync(metaTmp, 'utf8'));
  const tgz = '/tmp/detect-gpu.tgz';
  if (!curl(meta.dist.tarball, tgz)) {
    console.error('  tarball download failed');
    process.exit(1);
  }
  const extractDir = '/tmp/dg-extract';
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  spawnSync('tar', ['-xzf', tgz, '-C', extractDir, 'package/dist/benchmarks'], { stdio: 'ignore' });
  const benchDir = join(extractDir, 'package/dist/benchmarks');
  let copied = 0;
  for (const f of readdirSync(benchDir)) {
    spawnSync('cp', [join(benchDir, f), join(fixturesDir, `detect-gpu-${f}`)], { stdio: 'ignore' });
    copied += 1;
  }
  console.log(`  ✓ ${copied} official benchmark files (per-vendor)`);
}

// ── 2. tc39/source-map-tests official conformance fixtures ──
console.log('[fetch] tc39/source-map-tests conformance fixtures…');
{
  const tgz = '/tmp/smt.tgz';
  if (!curl('https://codeload.github.com/tc39/source-map-tests/tar.gz/refs/heads/main', tgz)) {
    console.error('  codeload unreachable');
    process.exit(1);
  }
  const extractDir = '/tmp/smt-extract';
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });
  spawnSync('tar', ['-xzf', tgz, '-C', extractDir], { stdio: 'ignore' });
  const repoDir = join(extractDir, 'source-map-tests-main');
  const dest = join(fixturesDir, 'source-map-tests');
  rmSync(dest, { recursive: true, force: true });
  spawnSync('cp', ['-r', join(repoDir, 'resources'), dest + '/resources'], { stdio: 'ignore' });
  spawnSync('cp', ['-r', join(repoDir, 'decoding'), dest + '/decoding'], { stdio: 'ignore' });
  const resCount = readdirSync(join(dest, 'resources')).filter((f) => f.endsWith('.map')).length;
  console.log(
    `  ✓ ${resCount} official .map fixtures (+ .golden expected outputs, scopes fixtures)`,
  );
}

console.log('[fetch] done — fixtures committed under tests/benchmarks/fixtures/');
