/**
 * Tests for the snapshot version table — built-in lookups, user-supplied
 * JSON merge precedence, and structural validation.
 */

import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SNAPSHOT_VERSION_TABLE,
  loadVersionTable,
  resetUserTableCacheForTests,
} from '@modules/dart-inspector/snapshot-version-table';
import { ToolError } from '@errors/ToolError';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'snapshot-table-'));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

afterEach(() => {
  resetUserTableCacheForTests();
});

describe('SNAPSHOT_VERSION_TABLE built-in seed', () => {
  it('contains at least 5 entries spanning multiple Flutter major versions', () => {
    expect(SNAPSHOT_VERSION_TABLE.size).toBeGreaterThanOrEqual(5);
    const versions = Array.from(SNAPSHOT_VERSION_TABLE.values()).map((e) => e.flutterVersion);
    expect(versions).toEqual(expect.arrayContaining(['2.0.0', '3.0.0']));
  });

  it('every entry has a flutterVersion string', () => {
    for (const entry of SNAPSHOT_VERSION_TABLE.values()) {
      expect(typeof entry.flutterVersion).toBe('string');
      expect(entry.flutterVersion.length).toBeGreaterThan(0);
    }
  });

  it('keys are 64-char lowercase hex digests', () => {
    for (const key of SNAPSHOT_VERSION_TABLE.keys()) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('loadVersionTable - built-in only', () => {
  it('returns the built-in table when no override is supplied', async () => {
    const table = await loadVersionTable();
    expect(table.size).toBe(SNAPSHOT_VERSION_TABLE.size);
  });

  it('returns the built-in table when override path is empty string', async () => {
    const table = await loadVersionTable('');
    expect(table.size).toBe(SNAPSHOT_VERSION_TABLE.size);
  });
});

describe('loadVersionTable - user merge', () => {
  it('merges entries from a custom JSON file', async () => {
    const customHash = 'aa'.repeat(32);
    const path = join(tmpDir, 'merge.json');
    await writeFile(
      path,
      JSON.stringify({
        [customHash]: {
          flutterVersion: '99.99.99',
          engineCommit: 'custom-engine',
          dartSdkRev: '99.0.0',
          releaseDate: '2099-01-01',
          abis: ['arm64'],
        },
      }),
    );
    const table = await loadVersionTable(path);
    const entry = table.get(customHash);
    expect(entry).toBeDefined();
    expect(entry?.flutterVersion).toBe('99.99.99');
    expect(entry?.engineCommit).toBe('custom-engine');
    expect(entry?.abis).toEqual(['arm64']);
  });

  it('user entry wins over built-in on hash collision', async () => {
    const collidingHash = '0000000000000000000000000000000000000000000000000000000000000003';
    const path = join(tmpDir, 'collide.json');
    await writeFile(
      path,
      JSON.stringify({
        [collidingHash]: { flutterVersion: 'override-1.2.3' },
      }),
    );
    const table = await loadVersionTable(path);
    expect(table.get(collidingHash)?.flutterVersion).toBe('override-1.2.3');
  });

  it('caches the user table — second call does not re-parse', async () => {
    const path = join(tmpDir, 'cache.json');
    await writeFile(
      path,
      JSON.stringify({
        ['bb'.repeat(32)]: { flutterVersion: 'cached-1' },
      }),
    );
    const first = await loadVersionTable(path);
    // Mutate file but expect cache hit.
    await writeFile(
      path,
      JSON.stringify({
        ['bb'.repeat(32)]: { flutterVersion: 'cached-2' },
      }),
    );
    const second = await loadVersionTable(path);
    expect(first.get('bb'.repeat(32))?.flutterVersion).toBe('cached-1');
    expect(second.get('bb'.repeat(32))?.flutterVersion).toBe('cached-1');
  });

  it('lower-cases user-supplied hash keys', async () => {
    const upperHash = 'CD'.repeat(32);
    const path = join(tmpDir, 'case.json');
    await writeFile(path, JSON.stringify({ [upperHash]: { flutterVersion: '1.2.3' } }));
    const table = await loadVersionTable(path);
    expect(table.get(upperHash.toLowerCase())?.flutterVersion).toBe('1.2.3');
  });

  it('accepts entries without optional fields', async () => {
    const path = join(tmpDir, 'min.json');
    const hash = 'ab'.repeat(32);
    await writeFile(path, JSON.stringify({ [hash]: { flutterVersion: '1.0.0' } }));
    const table = await loadVersionTable(path);
    const entry = table.get(hash);
    expect(entry?.flutterVersion).toBe('1.0.0');
    expect(entry?.engineCommit).toBeUndefined();
    expect(entry?.abis).toBeUndefined();
  });

  it('drops non-string ABI tokens silently', async () => {
    const path = join(tmpDir, 'bad-abi.json');
    const hash = 'ac'.repeat(32);
    await writeFile(
      path,
      JSON.stringify({
        [hash]: { flutterVersion: '1.0.0', abis: ['arm64', 42, 'not-an-abi'] },
      }),
    );
    const table = await loadVersionTable(path);
    expect(table.get(hash)?.abis).toEqual(['arm64']);
  });

  it('omits empty abis array', async () => {
    const path = join(tmpDir, 'empty-abi.json');
    const hash = 'ad'.repeat(32);
    await writeFile(
      path,
      JSON.stringify({
        [hash]: { flutterVersion: '1.0.0', abis: [123, 'nope'] },
      }),
    );
    const table = await loadVersionTable(path);
    expect(table.get(hash)?.abis).toBeUndefined();
  });
});

describe('loadVersionTable - error handling', () => {
  it('throws RUNTIME for missing custom table file', async () => {
    const missing = join(tmpDir, 'does-not-exist.json');
    await expect(loadVersionTable(missing)).rejects.toMatchObject({
      code: 'RUNTIME',
    });
  });

  it('throws RUNTIME for invalid JSON', async () => {
    const path = join(tmpDir, 'bad.json');
    await writeFile(path, '{not valid json');
    const err = await loadVersionTable(path).catch((e) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe('RUNTIME');
    expect((err as ToolError).message).toContain(path);
  });

  it('throws RUNTIME when JSON top-level is an array', async () => {
    const path = join(tmpDir, 'array.json');
    await writeFile(path, JSON.stringify([{ flutterVersion: '1.0.0' }]));
    await expect(loadVersionTable(path)).rejects.toMatchObject({ code: 'RUNTIME' });
  });

  it('throws RUNTIME when JSON top-level is null', async () => {
    const path = join(tmpDir, 'null.json');
    await writeFile(path, 'null');
    await expect(loadVersionTable(path)).rejects.toMatchObject({ code: 'RUNTIME' });
  });

  it('throws RUNTIME on entry missing flutterVersion', async () => {
    const path = join(tmpDir, 'missing-fv.json');
    await writeFile(path, JSON.stringify({ ['ae'.repeat(32)]: { engineCommit: 'orphan' } }));
    await expect(loadVersionTable(path)).rejects.toMatchObject({ code: 'RUNTIME' });
  });

  it('throws RUNTIME on non-object entry', async () => {
    const path = join(tmpDir, 'string-entry.json');
    await writeFile(path, JSON.stringify({ ['af'.repeat(32)]: 'not-an-object' }));
    await expect(loadVersionTable(path)).rejects.toMatchObject({ code: 'RUNTIME' });
  });
});
