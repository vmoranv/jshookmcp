/**
 * Integration tests for the dart-inspector domain — Phase 3.
 *
 * Verifies the domain is discoverable by the registry and the
 * registered `dart_strings_extract` tool can be invoked end-to-end
 * against the committed tiny-libapp.so fixture.
 *
 * @see openspec/changes/add-dart-strings-extract/tasks.md §3
 */
import { describe, expect, it } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import manifest from '@server/domains/dart-inspector/manifest';
import type { MCPServerContext } from '@server/MCPServer.context';
import { R } from '@server/domains/shared/ResponseBuilder';
import { discoverDomainManifests } from '@server/registry/discovery';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'fixtures',
  'dart-inspector',
);
const TINY_LIBAPP = join(FIXTURE_DIR, 'tiny-libapp.so');
const EXPECTED_JSON = join(FIXTURE_DIR, 'expected-strings.json');

describe('dart-inspector integration', () => {
  it('is discoverable by the registry', async () => {
    const manifests = await discoverDomainManifests();
    const found = manifests.find((m) => m.domain === 'dart-inspector');
    expect(found).toBeDefined();
    expect(found?.depKey).toBe('dartInspectorHandlers');
  });

  it('registry exposes dart_strings_extract via the manifest registrations', () => {
    const toolNames = manifest.registrations.map((r) => r.tool.name);
    expect(toolNames).toContain('dart_strings_extract');
    expect(toolNames).toContain('dart_smi_scan');
    expect(toolNames).toContain('dart_symbolize');
  });

  it('end-to-end call returns the expected categories for the tiny libapp fixture', async () => {
    const ctx = {} as MCPServerContext;
    const handler = await manifest.ensure(ctx);
    const response = await handler.handleDartStringsExtract({ filePath: TINY_LIBAPP });
    const payload = R.parse<{ success: boolean; strings: Record<string, unknown[]> }>(response);

    expect(payload.success).toBe(true);
    expect(payload.strings).toBeDefined();

    const expected = JSON.parse(await readFile(EXPECTED_JSON, 'utf-8')) as {
      categories: Record<string, Array<{ value: string }>>;
    };

    for (const [category, items] of Object.entries(expected.categories)) {
      const actualValues = (payload.strings[category] as Array<{ value: string }> | undefined)?.map(
        (s) => s.value,
      );
      const expectedValues = items.map((s) => s.value).toSorted();
      expect(actualValues?.toSorted()).toEqual(expectedValues);
    }
  });

  it('end-to-end call surfaces ToolError for a missing file', async () => {
    const ctx = {} as MCPServerContext;
    const handler = await manifest.ensure(ctx);
    const response = await handler.handleDartStringsExtract({
      filePath: join(FIXTURE_DIR, 'does-not-exist.bin'),
    });
    const payload = R.parse<{ success: boolean; error?: string }>(response);
    expect(payload.success).toBe(false);
    expect(payload.error).toBeDefined();
  });

  it('end-to-end dart_symbolize call resolves obfuscated names from a map fixture', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'dart-symbolize-int-'));
    try {
      const mapPath = join(tmp, 'obfuscation-map.json');
      await writeFile(
        mapPath,
        JSON.stringify(['HomePage', 'a1', 'LoginService', 'a2', '_doLogin', 'a3']),
      );

      const ctx = {} as MCPServerContext;
      const handler = await manifest.ensure(ctx);
      const response = await handler.handleDartSymbolize({
        obfuscationMapFile: mapPath,
        obfuscatedNames: ['a1', 'a3', 'unknown'],
      });
      const payload = R.parse<{
        success: boolean;
        symbols: {
          resolved: Array<{ query: string; resolved: string }>;
          unresolved: string[];
          mapEntries: number;
          format: string;
          mode: string;
        };
      }>(response);

      expect(payload.success).toBe(true);
      expect(payload.symbols.format).toBe('flat');
      expect(payload.symbols.mode).toBe('forward');
      expect(payload.symbols.mapEntries).toBe(3);
      expect(payload.symbols.resolved.map((r) => r.resolved)).toEqual(['HomePage', '_doLogin']);
      expect(payload.symbols.unresolved).toEqual(['unknown']);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('end-to-end dart_symbolize call surfaces ToolError for a missing map file', async () => {
    const ctx = {} as MCPServerContext;
    const handler = await manifest.ensure(ctx);
    const response = await handler.handleDartSymbolize({
      obfuscationMapFile: join(FIXTURE_DIR, 'no-such-map.json'),
      obfuscatedNames: ['a1'],
    });
    const payload = R.parse<{ success: boolean; error?: string }>(response);
    expect(payload.success).toBe(false);
    expect(payload.error).toBeDefined();
  });
});
