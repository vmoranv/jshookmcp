/**
 * Tests for Symbolizer — Flutter obfuscation-map.json lookup.
 *
 * Synthetic fixtures cover the three on-disk shapes (flat pair array,
 * tuple array, object map) plus auto-detection, forward/reverse mode,
 * partial misses, malformed JSON, oversize files, and validation
 * errors.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Symbolizer } from '@modules/dart-inspector/Symbolizer';

let tmpDir: string;
let flatPath: string;
let pairsPath: string;
let objectPath: string;
let oddPath: string;
let malformedPath: string;
let emptyArrayPath: string;
let oversizePath: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'dart-symbolize-'));

  // Flutter actual format: flat [orig, obf, orig, obf, ...]
  const flat = ['HomePage', 'a1', 'LoginService', 'a2', '_doLogin', 'a3', 'apiKey', 'a4'];
  flatPath = join(tmpDir, 'flat.json');
  await writeFile(flatPath, JSON.stringify(flat));

  // Pairs variant
  const pairs = [
    ['HomePage', 'a1'],
    ['LoginService', 'a2'],
    ['_doLogin', 'a3'],
  ];
  pairsPath = join(tmpDir, 'pairs.json');
  await writeFile(pairsPath, JSON.stringify(pairs));

  // Object variant: { obfuscated: original }
  const obj = { a1: 'HomePage', a2: 'LoginService', a3: '_doLogin' };
  objectPath = join(tmpDir, 'object.json');
  await writeFile(objectPath, JSON.stringify(obj));

  // Odd-length flat array (corrupted)
  oddPath = join(tmpDir, 'odd.json');
  await writeFile(oddPath, JSON.stringify(['HomePage', 'a1', 'unpaired']));

  malformedPath = join(tmpDir, 'malformed.json');
  await writeFile(malformedPath, '{not valid json');

  emptyArrayPath = join(tmpDir, 'empty.json');
  await writeFile(emptyArrayPath, JSON.stringify([]));

  // Oversize fixture: a tiny array padded out to > maxMapBytes for the test
  oversizePath = join(tmpDir, 'oversize.json');
  await writeFile(oversizePath, JSON.stringify(['x', 'a1']) + ' '.repeat(2048));
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('Symbolizer.resolveNames — flat format', () => {
  it('resolves obfuscated names back to originals (forward mode)', async () => {
    const sym = new Symbolizer();
    const result = await sym.resolveNames(['a1', 'a3', 'a4'], flatPath);
    expect(result.format).toBe('flat');
    expect(result.mode).toBe('forward');
    expect(result.mapEntries).toBe(4);
    expect(result.resolved).toEqual([
      { query: 'a1', resolved: 'HomePage', index: 0 },
      { query: 'a3', resolved: '_doLogin', index: 2 },
      { query: 'a4', resolved: 'apiKey', index: 3 },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('returns unresolved entries for unknown obfuscated names', async () => {
    const sym = new Symbolizer();
    const result = await sym.resolveNames(['a1', 'b9', 'z0'], flatPath);
    expect(result.resolved.map((r) => r.query)).toEqual(['a1']);
    expect(result.unresolved).toEqual(['b9', 'z0']);
  });

  it('supports reverse mode (original → obfuscated)', async () => {
    const sym = new Symbolizer();
    const result = await sym.resolveNames(['HomePage', '_doLogin', 'apiKey'], flatPath, {
      mode: 'reverse',
    });
    expect(result.mode).toBe('reverse');
    expect(result.resolved.map((r) => r.resolved)).toEqual(['a1', 'a3', 'a4']);
  });

  it('honors maxLookups by treating extras as unresolved', async () => {
    const sym = new Symbolizer();
    const result = await sym.resolveNames(['a1', 'a2', 'a3'], flatPath, { maxLookups: 1 });
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]?.resolved).toBe('HomePage');
    expect(result.unresolved).toEqual(['a2', 'a3']);
  });
});

describe('Symbolizer.resolveNames — pairs format', () => {
  it('parses 2-tuple array and resolves forwards', async () => {
    const sym = new Symbolizer();
    const result = await sym.resolveNames(['a2'], pairsPath);
    expect(result.format).toBe('pairs');
    expect(result.resolved).toEqual([{ query: 'a2', resolved: 'LoginService', index: 1 }]);
  });

  it('parses 2-tuple array and supports reverse mode', async () => {
    const sym = new Symbolizer();
    const result = await sym.resolveNames(['_doLogin'], pairsPath, { mode: 'reverse' });
    expect(result.resolved).toEqual([{ query: '_doLogin', resolved: 'a3', index: 2 }]);
  });
});

describe('Symbolizer.resolveNames — object format', () => {
  it('parses object {obfuscated: original}', async () => {
    const sym = new Symbolizer();
    const result = await sym.resolveNames(['a1', 'a2'], objectPath);
    expect(result.format).toBe('object');
    expect(result.mapEntries).toBe(3);
    expect(result.resolved.map((r) => r.resolved)).toEqual(['HomePage', 'LoginService']);
  });
});

describe('Symbolizer.resolveNames — empty input', () => {
  it('handles empty queries gracefully', async () => {
    const sym = new Symbolizer();
    const result = await sym.resolveNames([], flatPath);
    expect(result.resolved).toEqual([]);
    expect(result.unresolved).toEqual([]);
    expect(result.mapEntries).toBe(4);
  });

  it('handles empty flat map', async () => {
    const sym = new Symbolizer();
    const result = await sym.resolveNames(['a1'], emptyArrayPath);
    expect(result.mapEntries).toBe(0);
    expect(result.unresolved).toEqual(['a1']);
  });
});

describe('Symbolizer.resolveNames — format override', () => {
  it('respects an explicit format choice', async () => {
    const sym = new Symbolizer();
    const result = await sym.resolveNames(['a1'], flatPath, { format: 'flat' });
    expect(result.format).toBe('flat');
    expect(result.resolved).toHaveLength(1);
  });
});

describe('Symbolizer.resolveNames — error handling', () => {
  it('throws NOT_FOUND for a missing file', async () => {
    const sym = new Symbolizer();
    await expect(sym.resolveNames(['a1'], join(tmpDir, 'no-such-map.json'))).rejects.toThrowError(
      expect.objectContaining({ code: 'NOT_FOUND' }),
    );
  });

  it('throws VALIDATION for empty path', async () => {
    const sym = new Symbolizer();
    await expect(sym.resolveNames(['a1'], '')).rejects.toThrowError(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
  });

  it('throws VALIDATION for non-string entries in queries', async () => {
    const sym = new Symbolizer();
    await expect(sym.resolveNames(['a1', 7 as unknown as string], flatPath)).rejects.toThrowError(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
  });

  it('throws VALIDATION for an unknown format', async () => {
    const sym = new Symbolizer();
    await expect(
      sym.resolveNames(['a1'], flatPath, {
        format: 'yaml' as unknown as 'auto',
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
  });

  it('throws VALIDATION for invalid mode', async () => {
    const sym = new Symbolizer();
    await expect(
      sym.resolveNames(['a1'], flatPath, {
        mode: 'sideways' as unknown as 'forward',
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'VALIDATION' }));
  });

  it('throws RUNTIME for malformed JSON', async () => {
    const sym = new Symbolizer();
    await expect(sym.resolveNames(['a1'], malformedPath)).rejects.toThrowError(
      expect.objectContaining({ code: 'RUNTIME' }),
    );
  });

  it('throws RUNTIME for odd-length flat map', async () => {
    const sym = new Symbolizer();
    await expect(sym.resolveNames(['a1'], oddPath)).rejects.toThrowError(
      expect.objectContaining({ code: 'RUNTIME' }),
    );
  });

  it('throws PERMISSION when file exceeds maxMapBytes', async () => {
    const sym = new Symbolizer();
    await expect(sym.resolveNames(['a1'], oversizePath, { maxMapBytes: 64 })).rejects.toThrowError(
      expect.objectContaining({ code: 'PERMISSION' }),
    );
  });
});
