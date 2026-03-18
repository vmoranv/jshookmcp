import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBuildHookCode = vi.hoisted(() =>
  vi.fn(
    (name: string, _body: string, cs: boolean, lc: boolean) => `[mock:${name}:cs=${cs}:lc=${lc}]`
  )
);

vi.mock('@server/domains/hooks/preset-builder', () => ({
  buildHookCode: mockBuildHookCode,
}));

import { PRESETS, PRESET_LIST } from '@server/domains/hooks/preset-definitions';
import { CORE_PRESETS } from '@server/domains/hooks/preset-definitions.core';
import { SECURITY_PRESETS } from '@server/domains/hooks/preset-definitions.security';

describe('PRESETS (combined)', () => {
  beforeEach(() => {
    mockBuildHookCode.mockClear();
  });

  it('exports a Record<string, PresetEntry>', () => {
    expect(PRESETS).toBeDefined();
    expect(typeof PRESETS).toBe('object');
    expect(PRESETS).not.toBeNull();
  });

  it('contains all core preset IDs', () => {
    const presetIds = Object.keys(PRESETS);
    for (const coreId of Object.keys(CORE_PRESETS)) {
      expect(presetIds).toContain(coreId);
    }
  });

  it('contains all security preset IDs', () => {
    const presetIds = Object.keys(PRESETS);
    for (const securityId of Object.keys(SECURITY_PRESETS)) {
      expect(presetIds).toContain(securityId);
    }
  });

  it('has a size equal to the sum of core and security presets', () => {
    const coreCount = Object.keys(CORE_PRESETS).length;
    const securityCount = Object.keys(SECURITY_PRESETS).length;
    const totalCount = Object.keys(PRESETS).length;
    expect(totalCount).toBe(coreCount + securityCount);
  });

  it('has no duplicate IDs across core and security presets', () => {
    const coreIds = Object.keys(CORE_PRESETS);
    const securityIds = Object.keys(SECURITY_PRESETS);
    const overlap = coreIds.filter((id) => securityIds.includes(id));
    expect(overlap).toEqual([]);
  });

  it('entries from PRESETS match their source (core)', () => {
    for (const [id, entry] of Object.entries(CORE_PRESETS)) {
      expect(PRESETS[id]).toBe(entry);
    }
  });

  it('entries from PRESETS match their source (security)', () => {
    for (const [id, entry] of Object.entries(SECURITY_PRESETS)) {
      expect(PRESETS[id]).toBe(entry);
    }
  });

  it('every entry has a description and buildCode function', () => {
    for (const entry of Object.values(PRESETS)) {
      expect(typeof entry.description).toBe('string');
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.buildCode).toBe('function');
    }
  });
});

describe('PRESET_LIST', () => {
  it('is an array', () => {
    expect(Array.isArray(PRESET_LIST)).toBe(true);
  });

  it('has the same length as PRESETS', () => {
    expect(PRESET_LIST.length).toBe(Object.keys(PRESETS).length);
  });

  it('each element has only id and description fields', () => {
    for (const item of PRESET_LIST) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('description');
      expect(typeof item.id).toBe('string');
      expect(typeof item.description).toBe('string');
      const keys = Object.keys(item);
      expect(keys).toEqual(expect.arrayContaining(['id', 'description']));
      expect(keys.length).toBe(2);
    }
  });

  it('does not include buildCode in list items', () => {
    for (const item of PRESET_LIST) {
      expect(item).not.toHaveProperty('buildCode');
    }
  });

  it('contains IDs for all PRESETS entries', () => {
    const listIds = PRESET_LIST.map((p) => p.id);
    for (const presetId of Object.keys(PRESETS)) {
      expect(listIds).toContain(presetId);
    }
  });

  it('has no duplicate IDs', () => {
    const ids = PRESET_LIST.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('descriptions in PRESET_LIST match descriptions in PRESETS', () => {
    for (const item of PRESET_LIST) {
      const presetEntry = PRESETS[item.id];
      expect(presetEntry).toBeDefined();
      expect(item.description).toBe(presetEntry!.description);
    }
  });

  it('contains specific known entries', () => {
    const ids = PRESET_LIST.map((p) => p.id);
    expect(ids).toContain('eval');
    expect(ids).toContain('anti-debug-bypass');
    expect(ids).toContain('crypto-key-capture');
    expect(ids).toContain('webassembly-full');
  });
});
