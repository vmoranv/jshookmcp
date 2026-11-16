/**
 * B-phase (user-approved intent reversal): content-addressed APK decompile cache.
 * The old behavior used mkdtemp + `finally rm` (per-request scratch dir);
 * jadx-search.test.ts will be rewritten to assert cache reuse instead.
 *
 * `runJadx` is injectable so no real jadx binary / APK is needed.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveCacheDir,
  getOrCreateCachedSources,
  type CacheOptions,
  type RunJadx,
} from '@modules/jadx-search/decompile-cache';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'jshook-jadx-cache-test-'));
}

/** Fake APK: distinct bytes -> distinct sha256 -> distinct cache dir. */
function makeApk(dir: string, name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

const noopJadx: RunJadx = async (_jadxBin, _args, outDir) => {
  // Simulate jadx producing a sources/ dir with one file.
  const { mkdirSync, writeFileSync: wf } = await import('node:fs');
  mkdirSync(join(outDir, 'sources'), { recursive: true });
  wf(join(outDir, 'sources', 'A.java'), 'class A {}');
};

describe('resolveCacheDir (SHA256 content-addressed)', () => {
  it('same content -> same dir; different content -> different dir', () => {
    const root = tmpRoot();
    try {
      const a = makeApk(root, 'a.apk', 'APK-CONTENT-A');
      const b = makeApk(root, 'b.apk', 'APK-CONTENT-B');
      const a2 = makeApk(root, 'a2.apk', 'APK-CONTENT-A');
      const da = resolveCacheDir(a, { root });
      const db = resolveCacheDir(b, { root });
      const da2 = resolveCacheDir(a2, { root });
      expect(da).toBe(da2); // content-addressed, not filename-addressed
      expect(da).not.toBe(db);
      expect(da).toContain(root.replace(/\\/g, '/'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('honors a custom cache root', () => {
    const root = tmpRoot();
    try {
      const apk = makeApk(root, 'x.apk', 'X');
      const custom = join(root, 'custom-root');
      expect(resolveCacheDir(apk, { root: custom })).toContain(custom.replace(/\\/g, '/'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('getOrCreateCachedSources', () => {
  function opts(root: string, over: Partial<CacheOptions> = {}): CacheOptions {
    return { root, maxAgeMs: 60_000, now: () => 1_000_000, ...over };
  }

  it('first call runs jadx, second call on the SAME apk reuses (cacheHit) and does NOT re-run', async () => {
    const root = tmpRoot();
    try {
      const apk = makeApk(root, 'a.apk', 'SAME-CONTENT');
      let runs = 0;
      const runJadx: RunJadx = async (_b, _a, outDir) => {
        runs += 1;
        await noopJadx(_b, _a, outDir);
      };
      const o = opts(root);
      const first = await getOrCreateCachedSources(apk, 'jadx', ['x', apk], runJadx, o);
      const second = await getOrCreateCachedSources(apk, 'jadx', ['x', apk], runJadx, o);
      expect(first.cacheHit).toBe(false);
      expect(second.cacheHit).toBe(true);
      expect(runs).toBe(1);
      expect(second.sourcesDir).toBe(first.sourcesDir);
      expect(existsSync(join(second.sourcesDir, 'A.java'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('different APK content never collides', async () => {
    const root = tmpRoot();
    try {
      const a = makeApk(root, 'a.apk', 'AAA');
      const b = makeApk(root, 'b.apk', 'BBB');
      const o = opts(root);
      const ra = await getOrCreateCachedSources(a, 'jadx', ['x', a], noopJadx, o);
      const rb = await getOrCreateCachedSources(b, 'jadx', ['x', b], noopJadx, o);
      expect(ra.sourcesDir).not.toBe(rb.sourcesDir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stale cache entry is rebuilt after maxAgeMs', async () => {
    const root = tmpRoot();
    try {
      const apk = makeApk(root, 'a.apk', 'STALE');
      let runs = 0;
      const runJadx: RunJadx = async (b, a, outDir) => {
        runs += 1;
        await noopJadx(b, a, outDir);
      };
      const fresh = opts(root, { now: () => 1_000_000 });
      await getOrCreateCachedSources(apk, 'jadx', ['x', apk], runJadx, fresh);
      const late = opts(root, { now: () => 1_000_000 + 120_000, maxAgeMs: 60_000 });
      const rebuilt = await getOrCreateCachedSources(apk, 'jadx', ['x', apk], runJadx, late);
      expect(rebuilt.cacheHit).toBe(false);
      expect(runs).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does NOT delete the cache dir after a successful call (old finally-rm behavior is gone)', async () => {
    const root = tmpRoot();
    try {
      const apk = makeApk(root, 'a.apk', 'KEEP');
      const r = await getOrCreateCachedSources(apk, 'jadx', ['x', apk], noopJadx, opts(root));
      expect(existsSync(r.sourcesDir)).toBe(true);
      expect(readFileSync(join(r.sourcesDir, 'A.java'), 'utf8')).toBe('class A {}');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
