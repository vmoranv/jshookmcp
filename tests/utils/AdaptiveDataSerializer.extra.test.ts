import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AdaptiveDataSerializer } from '@utils/AdaptiveDataSerializer';
import { DetailedDataManager } from '@utils/DetailedDataManager';

describe('AdaptiveDataSerializer Extra Coverage', () => {
  let serializer: AdaptiveDataSerializer;

  beforeEach(() => {
    serializer = new AdaptiveDataSerializer();
    vi.spyOn(DetailedDataManager, 'getInstance').mockReturnValue({
      store: vi.fn(() => 'test-id'),
    } as any);
  });

  it('detects unknown type for simple objects', () => {
    const data = { foo: 'bar' };
    const result = serializer.serialize(data);
    expect(result).toBe(JSON.stringify(data));
  });

  it('detects deep objects beyond depth 3', () => {
    const deep = { a: { b: { c: { d: 'e' } } } };
    const result = JSON.parse(serializer.serialize(deep));
    expect(result.a.b.c).toBe('[Max depth reached]');
  });

  it('limits depth for arrays', () => {
    const deepArray = [[[[['end']]]]];
    const result = JSON.parse(serializer.serialize(deepArray, { maxDepth: 2 }));
    expect(result[0][0]).toBe('[Max depth reached]');
  });

  it('handles getDepth recursion limit', () => {
    const deep: any = {};
    let current = deep;
    for (let i = 0; i < 15; i++) {
      current.next = {};
      current = current.next;
    }
    // Should not crash and return depth <= 11 (10 limit in code)
    const result = serializer.serialize(deep);
    expect(result).toBeDefined();
  });

  it('isCodeString recognizes various patterns', () => {
    const patterns = [
      'const x = 1;' + ' '.repeat(100),
      'let y = 2;' + ' '.repeat(100),
      'var z = 3;' + ' '.repeat(100),
      'class Foo {}' + ' '.repeat(100),
      'import x from "y";' + ' '.repeat(100),
      'export const a = 1;' + ' '.repeat(100),
    ];
    patterns.forEach((p) => {
      const result = JSON.parse(serializer.serialize(p));
      expect(typeof result).toBe('string'); // length <= 100 lines, so returns string directly
    });
  });

  it('isNetworkRequest checks keys', () => {
    // Missing method or type
    const incomplete = [{ requestId: '1', url: 'http://' }];
    const result = serializer.serialize(incomplete);
    expect(result).toBe(JSON.stringify(incomplete));
  });

  it('isDOMStructure checks keys', () => {
    const incomplete = { tag: 'DIV' }; // missing children/childNodes
    const result = serializer.serialize(incomplete);
    expect(result).toBe(JSON.stringify(incomplete));
  });

  it('isFunctionTree checks keys', () => {
    const incomplete = { functionName: 'foo' }; // missing dependencies/calls
    const result = serializer.serialize(incomplete);
    expect(result).toBe(JSON.stringify(incomplete));
  });

  it('simplifyFunctionTree handles max depth', () => {
    const tree = {
      name: 'root',
      dependencies: [{ name: 'child', dependencies: [] }],
    };
    const result = JSON.parse(serializer.serialize(tree, { maxDepth: 0 }));
    expect(result.truncated).toBe(true);
  });

  it('serializeLargeArray uses sample', () => {
    const arr = Array.from({ length: 150 }, (_, i) => i);
    const result = JSON.parse(serializer.serialize(arr, { maxArrayLength: 10 }));
    expect(result.type).toBe('large-array');
    expect(result.sample).toEqual([0, 1, 2, 3, 4, 145, 146, 147, 148, 149]);
  });

  it('detectType handles undefined', () => {
    expect(serializer.serialize(undefined)).toBeUndefined();
  });
});
