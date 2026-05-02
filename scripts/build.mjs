#!/usr/bin/env node
import { rmSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { build } from 'tsdown';

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '..');
const withDts = process.argv.includes('--dts');

const t0 = Date.now();

rmSync(resolve(root, 'dist'), { recursive: true, force: true });

await import(pathToFileURL(resolve(dir, 'generate-domains-index.mjs')).href);

await build({ dts: withDts });

{
  const src = resolve(root, 'src', 'native', 'scripts');
  const dst = resolve(root, 'dist', 'native', 'scripts');
  if (existsSync(src)) {
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true, force: true });
  }
}

{
  const { chmodSync, readFileSync, existsSync: ex } = await import('node:fs');
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  for (const rel of new Set(Object.values(pkg.bin ?? {}))) {
    const p = resolve(root, rel);
    if (!ex(p)) throw new Error(`Bin target not found: ${rel}`);
    const txt = readFileSync(p, 'utf8');
    if (!txt.startsWith('#!')) throw new Error(`Bin target missing shebang: ${rel}`);
    if (process.platform !== 'win32') chmodSync(p, 0o755);
  }
}

console.log(`[build] ${withDts ? 'DTS+bundle' : 'bundle only'} in ${Date.now() - t0}ms`);
