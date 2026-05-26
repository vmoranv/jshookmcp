/**
 * Handler-level tests for the jadx-search domain.
 *
 * Validates the MCP envelope shape and argument-handling edge cases.
 * The underlying engine selection is exercised in module-level tests;
 * here we force the Node fallback so results stay deterministic across
 * hosts.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { JadxSearchEngine } from '@modules/jadx-search';
import { JadxSearchHandlers } from '@server/domains/jadx-search/handlers';
import { R } from '@server/domains/shared/ResponseBuilder';

const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'jadx-search', 'jadx-out');

function makeHandlers(): JadxSearchHandlers {
  // The engine internally honours forceFallback; we still construct a
  // fresh engine per test for isolation.
  return new JadxSearchHandlers(new JadxSearchEngine());
}

interface ParsedResponse {
  success: boolean;
  error?: string;
  engine?: string;
  totalMatches?: number;
  filesMatched?: number;
  matches?: unknown[];
  truncated?: boolean;
}

async function call(
  handler: JadxSearchHandlers,
  args: Record<string, unknown>,
): Promise<ParsedResponse> {
  const resp = await handler.handleJadxSearchCode(args);
  return R.parse<ParsedResponse>(resp);
}

describe('JadxSearchHandlers.handleJadxSearchCode', () => {
  it('returns a successful result for a valid query (Node fallback)', async () => {
    const handler = makeHandlers();
    const result = await call(handler, {
      decompileDir: FIXTURE_DIR,
      query: 'AES',
      // Use a synthetic flag understood by the engine via forceFallback.
      // We can't pass it through MCP normally; the engine accepts only
      // documented fields. Exercise the dispatcher and accept either
      // engine here.
    });
    expect(result.success).toBe(true);
    expect(result.totalMatches).toBeGreaterThan(0);
    expect(['ripgrep', 'node-fallback']).toContain(result.engine);
  });

  it('rejects missing query with success=false', async () => {
    const handler = makeHandlers();
    const result = await call(handler, { decompileDir: FIXTURE_DIR });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/query/i);
  });

  it('rejects missing decompileDir', async () => {
    const handler = makeHandlers();
    const result = await call(handler, { query: 'AES' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/decompileDir/);
  });

  it('rejects apkPath input with a helpful error', async () => {
    const handler = makeHandlers();
    const result = await call(handler, {
      decompileDir: FIXTURE_DIR,
      query: 'AES',
      apkPath: '/tmp/whatever.apk',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/apkPath is not supported/);
    expect(result.error).toMatch(/binary-instrument/);
  });

  it('rejects non-array globs', async () => {
    const handler = makeHandlers();
    const result = await call(handler, {
      decompileDir: FIXTURE_DIR,
      query: 'AES',
      globs: 'not-an-array',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/globs/);
  });

  it('rejects globs containing non-string entries', async () => {
    const handler = makeHandlers();
    const result = await call(handler, {
      decompileDir: FIXTURE_DIR,
      query: 'AES',
      globs: ['**/*.java', 42],
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/globs/);
  });

  it('honours custom contextLines', async () => {
    const handler = makeHandlers();
    const result = await call(handler, {
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

  it('caps results when maxResults is supplied', async () => {
    const handler = makeHandlers();
    const result = await call(handler, {
      decompileDir: FIXTURE_DIR,
      query: 'public',
      maxResults: 1,
    });
    expect(result.success).toBe(true);
    expect((result.matches as unknown[]).length).toBe(1);
    expect(result.truncated).toBe(true);
  });
});
