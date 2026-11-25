import { describe, expect, it } from 'vitest';
import {
  buildCatalogDescriptors,
  describeCatalogChange,
  findFirstByteDifference,
  type CatalogToolDescriptor,
} from '@server/search/CatalogSnapshot';

function baseCatalog(): CatalogToolDescriptor[] {
  return [
    {
      name: 'page_navigate',
      domain: 'browser',
      description: 'Navigate to a URL',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' } },
      },
    },
    {
      name: 'network_get_requests',
      domain: 'network',
      description: 'Read captured requests',
      inputSchema: { type: 'object' },
    },
  ];
}

describe('CatalogSnapshot', () => {
  it('builds descriptors with stable defaults', () => {
    const [descriptor] = buildCatalogDescriptors([{ name: 'x' }], new Map());
    expect(descriptor).toEqual({
      name: 'x',
      domain: null,
      description: '',
      inputSchema: undefined,
    });
  });

  it('reports no change for a reordered descriptor list', () => {
    const report = describeCatalogChange(baseCatalog(), baseCatalog().toReversed());
    expect(report.added).toEqual([]);
    expect(report.removed).toEqual([]);
    expect(report.mutated).toEqual([]);
    expect(report.truncated).toBe(false);
  });

  it('treats schema key reordering as identical (canonical hashing)', () => {
    const before = baseCatalog();
    const after = baseCatalog();
    after[0] = {
      ...after[0]!,
      inputSchema: {
        properties: { url: { type: 'string' } },
        type: 'object',
      },
    };
    expect(describeCatalogChange(before, after).mutated).toEqual([]);
  });

  it('classifies additions and removals', () => {
    const after = baseCatalog().slice(1);
    after.push({ name: 'tls_probe', domain: 'tls', description: 'Probe TLS', inputSchema: {} });
    const report = describeCatalogChange(baseCatalog(), after);
    expect(report.added).toEqual(['tls_probe']);
    expect(report.removed).toEqual(['page_navigate']);
    expect(report.mutated).toEqual([]);
  });

  it('pinpoints the mutated schema field', () => {
    const before = baseCatalog();
    const after = baseCatalog();
    after[0] = {
      ...after[0]!,
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'number' } },
      },
    };

    const report = describeCatalogChange(before, after);

    expect(report.mutated).toHaveLength(1);
    expect(report.mutated[0]!.name).toBe('page_navigate');
    expect(report.mutated[0]!.fields[0]!.path).toBe('$.inputSchema.properties.url.type');
    expect(report.mutated[0]!.fields[0]!.before).toContain('string');
    expect(report.mutated[0]!.fields[0]!.after).toContain('number');
    expect(report.mutated[0]!.byteOffset).toBeTypeOf('number');
  });

  it('reports the top-level field for description and domain edits', () => {
    const before = baseCatalog();
    const after = baseCatalog();
    after[0] = { ...after[0]!, description: 'Navigate somewhere' };
    after[1] = { ...after[1]!, domain: 'network-capture' };

    const report = describeCatalogChange(before, after);

    expect(report.mutated.map((entry) => entry.fields[0]!.path).toSorted()).toEqual([
      '$.description',
      '$.domain',
    ]);
  });

  it('caps the report and flags truncation', () => {
    const before = baseCatalog();
    const after = baseCatalog().map((tool) => ({ ...tool, description: `${tool.description}!` }));

    const report = describeCatalogChange(before, after, { maxMutated: 1 });

    expect(report.mutated).toHaveLength(1);
    expect(report.truncated).toBe(true);
  });

  it('pinpoints array elements and added object properties', () => {
    const beforeArray = baseCatalog();
    const afterArray = baseCatalog();
    beforeArray[0] = {
      ...beforeArray[0]!,
      inputSchema: { type: 'object', required: ['a', 'b'] },
    };
    afterArray[0] = {
      ...afterArray[0]!,
      inputSchema: { type: 'object', required: ['a', 'c'] },
    };

    expect(describeCatalogChange(beforeArray, afterArray).mutated[0]!.fields[0]!.path).toBe(
      '$.inputSchema.required[1]',
    );

    const afterAddedProperty = baseCatalog();
    afterAddedProperty[0] = {
      ...afterAddedProperty[0]!,
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string' }, timeout: { type: 'number' } },
      },
    };
    expect(
      describeCatalogChange(baseCatalog(), afterAddedProperty).mutated[0]!.fields[0]!.path,
    ).toBe('$.inputSchema.properties.timeout');
  });

  it('flags truncation when a tool has more changed fields than the cap', () => {
    const before = baseCatalog();
    const after = baseCatalog();
    after[0] = {
      ...after[0]!,
      description: 'changed',
      inputSchema: { type: 'object', properties: { url: { type: 'number' } } },
    };

    const report = describeCatalogChange(before, after, { maxFieldsPerTool: 1 });

    expect(report.mutated[0]!.fields).toHaveLength(1);
    expect(report.truncated).toBe(true);
  });

  it('finds the first differing UTF-8 byte', () => {
    expect(findFirstByteDifference('abc', 'abc')).toBeNull();
    expect(findFirstByteDifference('abc', 'abd')).toBe(2);
    expect(findFirstByteDifference('abc', 'abcd')).toBe(3);
    expect(findFirstByteDifference('a', '')).toBe(0);
  });
});
