/**
 * Tests for handleDartSymbolize obfuscation-map auto-detection (apkPath /
 * searchDir) added in Session 50. Covers the explicit-map back-compat path too.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DartInspectorHandlers } from '@server/domains/dart-inspector/handlers';
import { R } from '@server/domains/shared/ResponseBuilder';

describe('handleDartSymbolize — obfuscation map auto-detect', () => {
  it('auto-detects the map from searchDir and resolves names', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sym-'));
    try {
      await writeFile(
        join(dir, 'obfuscation.json'),
        JSON.stringify(['MyClass', 'a', 'doThing', 'b']),
      );
      const handlers = new DartInspectorHandlers();
      const response = await handlers.handleDartSymbolize({
        searchDir: dir,
        obfuscatedNames: ['a', 'b'],
      });
      const body = R.parse<{ success: boolean; symbols: any; mapSource: string }>(response);
      expect(body.success).toBe(true);
      expect(body.symbols.mapEntries).toBe(2);
      const resolved = body.symbols.resolved.map((r: any) => r.resolved);
      expect(resolved).toEqual(expect.arrayContaining(['MyClass', 'doThing']));
      expect(body.mapSource).toBe(`directory:${dir}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports NOT_FOUND when searchDir has no sidecar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sym-'));
    try {
      await writeFile(join(dir, 'libapp.so'), 'x');
      const handlers = new DartInspectorHandlers();
      const response = await handlers.handleDartSymbolize({
        searchDir: dir,
        obfuscatedNames: ['a'],
      });
      const body = R.parse<{ success: boolean; error: string }>(response);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/sidecar|not found|no obfuscation/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports VALIDATION when no map source is provided', async () => {
    const handlers = new DartInspectorHandlers();
    const response = await handlers.handleDartSymbolize({ obfuscatedNames: ['a'] });
    const body = R.parse<{ success: boolean; error: string }>(response);
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/obfuscationMapFile|apkPath|searchDir|auto-detect/i);
  });

  it('still accepts an explicit obfuscationMapFile (back-compat, mapSource=user-supplied)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sym-'));
    const mapPath = join(dir, 'custom.json');
    try {
      await writeFile(mapPath, JSON.stringify({ a: 'Alpha' }));
      const handlers = new DartInspectorHandlers();
      const response = await handlers.handleDartSymbolize({
        obfuscationMapFile: mapPath,
        obfuscatedNames: ['a'],
      });
      const body = R.parse<{ success: boolean; symbols: any; mapSource: string }>(response);
      expect(body.success).toBe(true);
      expect(body.symbols.resolved[0].resolved).toBe('Alpha');
      expect(body.mapSource).toBe('user-supplied');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
