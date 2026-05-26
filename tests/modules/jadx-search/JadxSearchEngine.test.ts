/**
 * Tests for the jadx-search module.
 *
 * Covers the dispatcher ({@link JadxSearchEngine.search}) and the Node
 * fallback engine end-to-end. ripgrep is exercised only when available
 * on the host; otherwise the equivalent tests run via the fallback path
 * and the engine field is asserted accordingly.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import { ToolError } from '@errors/ToolError';
import {
  JadxSearchEngine,
  buildRipgrepArgs,
  compileSafePattern,
  detectRipgrep,
  enumerateFiles,
  matchesGlobs,
  resetRipgrepDetection,
  setRipgrepDetectionForTests,
} from '@modules/jadx-search';
import { buildJadxOutFixture } from '@tests/fixtures/jadx-search/build-jadx-out';

const FIXTURE_BASE = join(process.cwd(), 'tests', 'fixtures', 'jadx-search', 'jadx-out');

async function makeTempFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'jadx-search-'));
  await buildJadxOutFixture(root);
  return root;
}

let probedRipgrepAvailable = false;

describe('JadxSearchEngine — ripgrep when available', () => {
  beforeAll(async () => {
    resetRipgrepDetection();
    const probe = await detectRipgrep();
    probedRipgrepAvailable = probe.available;
  });

  it.skipIf(!probedRipgrepAvailable)(
    'finds "AES" matches across multiple files via ripgrep',
    async () => {
      const engine = new JadxSearchEngine();
      const result = await engine.search({
        decompileDir: FIXTURE_BASE,
        query: 'AES',
      });
      expect(result.engine).toBe('ripgrep');
      expect(result.totalMatches).toBeGreaterThanOrEqual(2);
      expect(result.filesMatched).toBeGreaterThanOrEqual(2);
      const files = new Set(result.matches.map((m) => m.file));
      expect(files.has('com/example/Crypto.java')).toBe(true);
      // META-INF is excluded by default globs (.java/.kt only).
      expect(files.has('META-INF/MANIFEST.MF')).toBe(false);
    },
  );
});

describe('JadxSearchEngine — node fallback (forceFallback)', () => {
  it('returns matches using the Node engine when forceFallback=true', async () => {
    const engine = new JadxSearchEngine();
    const result = await engine.search({
      decompileDir: FIXTURE_BASE,
      query: 'AES',
      forceFallback: true,
    });
    expect(result.engine).toBe('node-fallback');
    expect(result.totalMatches).toBeGreaterThan(0);
    expect(result.matches[0]?.file.includes('com/example/')).toBe(true);
    // Every match exposes 1-indexed line / column.
    for (const m of result.matches) {
      expect(m.line).toBeGreaterThan(0);
      expect(m.column).toBeGreaterThan(0);
      expect(m.matchEnd).toBeGreaterThan(m.matchStart);
    }
  });

  it('respects glob filters: !**/*Test.java excludes UserTest.java', async () => {
    const engine = new JadxSearchEngine();
    const result = await engine.search({
      decompileDir: FIXTURE_BASE,
      query: 'class',
      forceFallback: true,
      globs: ['**/*.java', '!**/*Test.java'],
    });
    const files = result.matches.map((m) => m.file);
    expect(files).not.toContain('com/example/UserTest.java');
    expect(files).toContain('com/example/Crypto.java');
  });

  it('literal mode escapes regex metacharacters', async () => {
    const engine = new JadxSearchEngine();
    const literalResult = await engine.search({
      decompileDir: FIXTURE_BASE,
      query: 'Cipher.getInstance(ALG)',
      literal: true,
      forceFallback: true,
    });
    expect(literalResult.totalMatches).toBe(1);
    expect(literalResult.matches[0]?.file).toBe('com/example/Crypto.java');
  });

  it('caseInsensitive=true makes "aes" match AES', async () => {
    const engine = new JadxSearchEngine();
    const result = await engine.search({
      decompileDir: FIXTURE_BASE,
      query: 'aes',
      caseInsensitive: true,
      forceFallback: true,
    });
    expect(result.totalMatches).toBeGreaterThan(0);
  });

  it('emits context lines around matches when contextLines>0', async () => {
    const engine = new JadxSearchEngine();
    const result = await engine.search({
      decompileDir: FIXTURE_BASE,
      query: 'Cipher.getInstance',
      literal: true,
      contextLines: 2,
      forceFallback: true,
    });
    const match = result.matches.find((m) => m.file === 'com/example/Crypto.java');
    expect(match).toBeDefined();
    expect(match!.context).toBeDefined();
    expect(match!.context!.before.length).toBeGreaterThan(0);
    expect(match!.context!.after.length).toBeGreaterThanOrEqual(0);
  });

  it('maxMatchesPerFile truncates per-file output', async () => {
    const engine = new JadxSearchEngine();
    const result = await engine.search({
      decompileDir: FIXTURE_BASE,
      query: 'public',
      forceFallback: true,
      maxMatchesPerFile: 1,
    });
    const perFile = new Map<string, number>();
    for (const m of result.matches) perFile.set(m.file, (perFile.get(m.file) ?? 0) + 1);
    for (const count of perFile.values()) expect(count).toBeLessThanOrEqual(1);
    expect(result.truncated).toBe(true);
  });

  it('maxResults truncates total output and sets truncated=true', async () => {
    const engine = new JadxSearchEngine();
    const result = await engine.search({
      decompileDir: FIXTURE_BASE,
      query: 'public',
      forceFallback: true,
      maxResults: 2,
    });
    expect(result.matches.length).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it('crosses multiple files for a shared keyword', async () => {
    const engine = new JadxSearchEngine();
    const result = await engine.search({
      decompileDir: FIXTURE_BASE,
      query: 'AES',
      forceFallback: true,
    });
    const files = new Set(result.matches.map((m) => m.file));
    expect(files.size).toBeGreaterThanOrEqual(2);
  });
});

describe('JadxSearchEngine — validation', () => {
  it('rejects empty query', async () => {
    const engine = new JadxSearchEngine();
    await expect(
      engine.search({ decompileDir: FIXTURE_BASE, query: '', forceFallback: true }),
    ).rejects.toThrow(/query must be a non-empty string/);
  });

  it('rejects out-of-range contextLines', async () => {
    const engine = new JadxSearchEngine();
    await expect(
      engine.search({
        decompileDir: FIXTURE_BASE,
        query: 'AES',
        contextLines: 9999,
        forceFallback: true,
      }),
    ).rejects.toThrow(/contextLines/);
  });

  it('throws NOT_FOUND when decompileDir does not exist', async () => {
    const engine = new JadxSearchEngine();
    await expect(
      engine.search({
        decompileDir: join(FIXTURE_BASE, '__does_not_exist__'),
        query: 'AES',
        forceFallback: true,
      }),
    ).rejects.toThrow(/decompileDir not found/);
  });

  it('rejects ReDoS-shaped regex queries', async () => {
    const engine = new JadxSearchEngine();
    await expect(
      engine.search({
        decompileDir: FIXTURE_BASE,
        query: '(a+)+',
        forceFallback: true,
      }),
    ).rejects.toThrow(/ReDoS/);
  });

  it('returns zero matches for an empty directory', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'jadx-empty-'));
    try {
      const engine = new JadxSearchEngine();
      const result = await engine.search({
        decompileDir: empty,
        query: 'AES',
        forceFallback: true,
      });
      expect(result.totalMatches).toBe(0);
      expect(result.filesMatched).toBe(0);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe('node-fallback engine helpers', () => {
  it('compileSafePattern escapes literals', () => {
    const re = compileSafePattern('Cipher.getInstance(ALG)', true, false);
    expect(re.test('return Cipher.getInstance(ALG);')).toBe(true);
    expect(re.test('return Cipher_xgetInstance_ALG_;')).toBe(false);
  });

  it('compileSafePattern rejects ReDoS patterns in regex mode', () => {
    expect(() => compileSafePattern('(a+)+', false, false)).toThrow(ToolError);
  });

  it('matchesGlobs honours include + negative globs', () => {
    expect(matchesGlobs('com/example/Foo.java', ['**/*.java'])).toBe(true);
    expect(matchesGlobs('com/example/Foo.java', ['**/*.kt'])).toBe(false);
    expect(matchesGlobs('com/example/UserTest.java', ['**/*.java', '!**/*Test.java'])).toBe(false);
    expect(matchesGlobs('com/example/Foo.java', ['!**/*Test.java'])).toBe(true);
  });

  it('enumerateFiles enumerates only matching files', async () => {
    const files = await enumerateFiles(FIXTURE_BASE, ['**/*.java']);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.endsWith('.java')).toBe(true);
    }
    expect(files.some((f) => f.endsWith('MANIFEST.MF'))).toBe(false);
  });
});

describe('ripgrep engine helpers', () => {
  it('buildRipgrepArgs passes through query, globs, and flags', () => {
    const args = buildRipgrepArgs({
      decompileDir: '/tmp/decomp',
      query: 'AES',
      globs: ['**/*.java'],
      literal: true,
      caseInsensitive: true,
      contextLines: 3,
      maxMatchesPerFile: 50,
      maxResults: 500,
    });
    expect(args).toContain('--json');
    expect(args).toContain('-F');
    expect(args).toContain('-i');
    expect(args).toContain('-C');
    expect(args).toContain('3');
    expect(args).toContain('--glob');
    expect(args).toContain('**/*.java');
    expect(args).toContain('AES');
    expect(args).toContain('/tmp/decomp');
  });
});

describe('JadxSearchEngine — fallback forced via probe override', () => {
  afterAll(() => resetRipgrepDetection());

  it('forces fallback when the probe reports rg as unavailable', async () => {
    setRipgrepDetectionForTests({ available: false, reason: 'mocked-unavailable' });
    const engine = new JadxSearchEngine();
    const result = await engine.search({ decompileDir: FIXTURE_BASE, query: 'AES' });
    expect(result.engine).toBe('node-fallback');
    expect(result.totalMatches).toBeGreaterThan(0);
  });
});

describe('JadxSearchEngine — temp dir round trip', () => {
  let tempRoot: string;
  beforeAll(async () => {
    tempRoot = await makeTempFixture();
  });
  afterAll(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  });

  it('handles a freshly built fixture in a temp directory', async () => {
    const engine = new JadxSearchEngine();
    const result = await engine.search({
      decompileDir: tempRoot,
      query: 'LoginViewModel',
      literal: true,
      forceFallback: true,
    });
    expect(result.totalMatches).toBe(1);
    expect(result.matches[0]?.file).toBe('com/example/Login.java');
  });
});

describe('JadxSearchEngine — Kotlin sources', () => {
  it('includes Kotlin files by default', async () => {
    // Ensure the .kt file exists; regenerate if missing.
    await mkdir(FIXTURE_BASE, { recursive: true });
    await buildJadxOutFixture(FIXTURE_BASE);
    const engine = new JadxSearchEngine();
    const result = await engine.search({
      decompileDir: FIXTURE_BASE,
      query: 'object Utils',
      literal: true,
      forceFallback: true,
    });
    expect(result.totalMatches).toBe(1);
    expect(result.matches[0]?.file).toBe('com/example/Utils.kt');
  });
});
