/**
 * jadx_search_code — merged from the former standalone jadx-search domain into
 * binary-instrument. Validates the MCP envelope and argument-handling edges via
 * the BinaryInstrumentHandlers facade. The engine selection (ripgrep vs Node
 * fallback) is exercised in module-level tests; here we accept either.
 *
 * Kept in a dedicated file (no node:fs / child_process / yauzl mocks beyond
 * probeCommand) so the tool's real filesystem search over the fixture runs.
 *
 * B-phase (change `close-descoped-behaviors`): the old "cleanup mkdtemp scratch
 * dir" regression is REPLACED by content-addressed cache assertions. This is a
 * deliberate product behavior reversal (user-approved), not a bug fix.
 */
import { mkdirSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probeCommandMock = vi.fn();

vi.mock('@modules/external/ToolProbe', () => ({
  probeCommand: (...args: unknown[]) => probeCommandMock(...args),
}));

import { BinaryInstrumentHandlers } from '@server/domains/binary-instrument/handlers';
import { R } from '@server/domains/shared/ResponseBuilder';
import { getOrCreateCachedSources } from '@modules/jadx-search/decompile-cache';

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'jadx-search', 'jadx-out');

interface ParsedResponse {
  success: boolean;
  engine?: string;
  totalMatches?: number;
  filesMatched?: number;
  matches?: unknown[];
  truncated?: boolean;
  autoDecompiled?: boolean;
  cacheHit?: boolean;
  decompileDir?: string;
}

function makeHandlers(): BinaryInstrumentHandlers {
  return new BinaryInstrumentHandlers();
}

async function call(
  handlers: BinaryInstrumentHandlers,
  args: Record<string, unknown>,
): Promise<ParsedResponse> {
  const resp = await handlers.handleJadxSearchCode(args);
  return R.parse<ParsedResponse>(resp as Parameters<typeof R.parse>[0]);
}

/** A real file with stable bytes — the cache key is sha256 of these bytes. */
function makeFakeApk(dir: string, name: string, content: string): string {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

let cacheRoot: string;
const savedRoot = process.env.JADX_SEARCH_CACHE_ROOT;

beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'jshook-jadx-handler-cache-'));
  process.env.JADX_SEARCH_CACHE_ROOT = cacheRoot;
  probeCommandMock.mockReset();
});

afterEach(() => {
  if (savedRoot === undefined) delete process.env.JADX_SEARCH_CACHE_ROOT;
  else process.env.JADX_SEARCH_CACHE_ROOT = savedRoot;
  rmSync(cacheRoot, { recursive: true, force: true });
});

describe('binary-instrument · handleJadxSearchCode (merged from jadx-search)', () => {
  it('returns a successful result for a valid query', async () => {
    const result = await call(makeHandlers(), { decompileDir: FIXTURE_DIR, query: 'AES' });
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBeGreaterThan(0);
    expect(['ripgrep', 'node-fallback']).toContain(result.engine);
  });

  it('honours custom contextLines on a literal query', async () => {
    const result = await call(makeHandlers(), {
      decompileDir: FIXTURE_DIR,
      query: 'Cipher.getInstance',
      literal: true,
      contextLines: 1,
    });
    expect(result.success).toBe(true);
    expect((result.matches as Array<{ context?: unknown }>).every((m) => 'context' in m)).toBe(
      true,
    );
  });

  it('accepts contextLines=50 (raised ceiling) and rejects 51', async () => {
    const ok = await call(makeHandlers(), {
      decompileDir: FIXTURE_DIR,
      query: 'AES',
      contextLines: 50,
    });
    expect(ok.success).toBe(true);
    await expect(
      makeHandlers().handleJadxSearchCode({
        decompileDir: FIXTURE_DIR,
        query: 'AES',
        contextLines: 51,
      }),
    ).rejects.toThrow(/contextLines/);
  });

  it('caps results when maxResults is supplied', async () => {
    const result = await call(makeHandlers(), {
      decompileDir: FIXTURE_DIR,
      query: 'public',
      maxResults: 1,
    });
    expect(result.success).toBe(true);
    expect((result.matches as unknown[]).length).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it('throws on missing query', async () => {
    await expect(
      makeHandlers().handleJadxSearchCode({ decompileDir: FIXTURE_DIR }),
    ).rejects.toThrow(/query/i);
  });

  it('throws on missing decompileDir', async () => {
    await expect(makeHandlers().handleJadxSearchCode({ query: 'AES' })).rejects.toThrow(
      /decompileDir or apkPath/,
    );
  });

  // B-phase: blueprint `oneOf` mutual exclusion. Previously both were accepted
  // (apkPath treated as "contextual metadata"); now it is a validation error.
  it('rejects decompileDir AND apkPath together (mutually exclusive)', async () => {
    await expect(
      makeHandlers().handleJadxSearchCode({
        decompileDir: FIXTURE_DIR,
        query: 'AES',
        apkPath: '/tmp/whatever.apk',
      }),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it('rejects non-array globs', async () => {
    await expect(
      makeHandlers().handleJadxSearchCode({
        decompileDir: FIXTURE_DIR,
        query: 'AES',
        globs: 'not-an-array',
      }),
    ).rejects.toThrow(/globs/);
  });

  it('rejects globs containing non-string entries', async () => {
    await expect(
      makeHandlers().handleJadxSearchCode({
        decompileDir: FIXTURE_DIR,
        query: 'AES',
        globs: ['**/*.java', 42],
      }),
    ).rejects.toThrow(/globs/);
  });

  // ── B-phase: content-addressed cache (replaces the old cleanup tests) ──
  it('first apkPath call decompiles (cacheHit=false) and the cache dir PERSISTS', async () => {
    probeCommandMock.mockResolvedValue({ available: true, path: 'jadx', reason: undefined });
    const apk = makeFakeApk(cacheRoot, 'first.apk', 'UNIQUE-APK-BYTES-1');

    const handlers = new BinaryInstrumentHandlers() as unknown as {
      jadx: { runJadx: ReturnType<typeof vi.fn> };
      handleJadxSearchCode: (args: Record<string, unknown>) => Promise<unknown>;
    };
    // Stub jadx to emit one .java file into the cache outDir's sources/.
    handlers.jadx.runJadx = vi.fn(async (_bin: string, args: string[]) => {
      const dIdx = args.indexOf('-d');
      const outDir = args[dIdx + 1]!;
      mkdirSync(join(outDir, 'sources'), { recursive: true });
      writeFileSync(join(outDir, 'sources', 'A.java'), 'class A { String AES; }');
    });

    const parsed = await call(handlers as unknown as BinaryInstrumentHandlers, {
      apkPath: apk,
      query: 'AES',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.cacheHit).toBe(false);
    expect(parsed.autoDecompiled).toBe(true);
    expect(handlers.jadx.runJadx).toHaveBeenCalledTimes(1);
    // The cache dir is NOT deleted after the call (old finally-rm is gone).
    expect(parsed.decompileDir).toBeDefined();
    expect(existsSync(parsed.decompileDir!)).toBe(true);
  });

  it('second apkPath call on the SAME apk reuses the cache (cacheHit=true), jadx not re-run', async () => {
    probeCommandMock.mockResolvedValue({ available: true, path: 'jadx', reason: undefined });
    const apk = makeFakeApk(cacheRoot, 'reuse.apk', 'UNIQUE-APK-BYTES-REUSE');

    const handlers = new BinaryInstrumentHandlers() as unknown as {
      jadx: { runJadx: ReturnType<typeof vi.fn> };
      handleJadxSearchCode: (args: Record<string, unknown>) => Promise<unknown>;
    };
    handlers.jadx.runJadx = vi.fn(async (_bin: string, args: string[]) => {
      const outDir = args[args.indexOf('-d') + 1]!;
      mkdirSync(join(outDir, 'sources'), { recursive: true });
      writeFileSync(join(outDir, 'sources', 'A.java'), 'class A { String AES; }');
    });

    const first = await call(handlers as unknown as BinaryInstrumentHandlers, {
      apkPath: apk,
      query: 'AES',
    });
    const second = await call(handlers as unknown as BinaryInstrumentHandlers, {
      apkPath: apk,
      query: 'AES',
    });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.autoDecompiled).toBeUndefined();
    expect(second.decompileDir).toBe(first.decompileDir);
    expect(handlers.jadx.runJadx).toHaveBeenCalledTimes(1);
  });

  it('getOrCreateCachedSources does not delete the cache dir on a hit', async () => {
    const apk = makeFakeApk(cacheRoot, 'persist.apk', 'PERSIST-BYTES');
    const runner = async (_bin: string, _args: readonly string[], outDir: string) => {
      mkdirSync(join(outDir, 'sources'), { recursive: true });
      writeFileSync(join(outDir, 'sources', 'A.java'), 'class A {}');
    };
    const a = await getOrCreateCachedSources(apk, 'jadx', ['x'], runner, { root: cacheRoot });
    const b = await getOrCreateCachedSources(apk, 'jadx', ['x'], runner, { root: cacheRoot });
    expect(b.cacheHit).toBe(true);
    expect(existsSync(a.sourcesDir)).toBe(true);
  });
});
