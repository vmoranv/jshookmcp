import { describe, it, expect } from 'vitest';
import { serializeScopeSidecar } from '../../../../src/server/domains/sourcemap/handlers/sourcemap-parsing';
import type { OriginalScopeNode } from '../../../../src/server/domains/sourcemap/handlers/sourcemap-handlers';

function makeRoot(overrides: Partial<OriginalScopeNode> = {}): OriginalScopeNode {
  return {
    index: 0,
    sourceIndex: 0,
    start: { line: 1, column: 0 },
    end: { line: 10, column: 0 },
    name: 'moduleScope',
    kind: 'module',
    isStackFrame: false,
    variables: ['x'],
    children: [],
    ...overrides,
  };
}

describe('serializeScopeSidecar', () => {
  it('returns null when root node is absent', () => {
    expect(serializeScopeSidecar('src/a.ts', null)).toBeNull();
    expect(serializeScopeSidecar('src/a.ts', undefined)).toBeNull();
  });

  it('serializes a flat scope node', () => {
    const root = makeRoot({
      name: 'mainFn',
      kind: 'function',
      isStackFrame: true,
      variables: ['a', 'b'],
    });
    const sidecar = serializeScopeSidecar('src/main.ts', root)!;
    expect(sidecar.format).toBe('sourcemap-v4-scopes');
    expect(sidecar.sourcePath).toBe('src/main.ts');
    expect(sidecar.scopeCount).toBe(1);
    expect(sidecar.scopes).toHaveLength(1);
    const node = sidecar.scopes[0]!;
    expect(node.name).toBe('mainFn');
    expect(node.kind).toBe('function');
    expect(node.isStackFrame).toBe(true);
    expect(node.variables).toEqual(['a', 'b']);
    expect(node.children).toEqual([]);
    expect(node.start).toEqual({ line: 1, column: 0 });
    expect(node.end).toEqual({ line: 10, column: 0 });
  });

  it('serializes nested children and counts all scopes', () => {
    const child: OriginalScopeNode = {
      index: 1,
      sourceIndex: 0,
      start: { line: 2, column: 4 },
      end: { line: 8, column: 0 },
      name: 'inner',
      kind: 'block',
      isStackFrame: false,
      variables: ['c'],
      children: [
        {
          index: 2,
          sourceIndex: 0,
          start: { line: 3, column: 6 },
          end: { line: 5, column: 0 },
          isStackFrame: false,
          variables: [],
          children: [],
        },
      ],
    };
    const root = makeRoot({ children: [child] });
    const sidecar = serializeScopeSidecar('src/nested.ts', root)!;
    expect(sidecar.scopeCount).toBe(3); // root + child + grandchild
    expect(sidecar.scopes[0]!.children).toHaveLength(1);
    expect(sidecar.scopes[0]!.children[0]!.name).toBe('inner');
    expect(sidecar.scopes[0]!.children[0]!.children).toHaveLength(1);
  });

  it('omits name/kind from output when undefined', () => {
    const root = makeRoot({ name: undefined, kind: undefined });
    const sidecar = serializeScopeSidecar('src/anon.ts', root)!;
    const node = sidecar.scopes[0]!;
    expect(node).not.toHaveProperty('name');
    expect(node).not.toHaveProperty('kind');
  });

  it('copies variables array (does not share reference)', () => {
    const root = makeRoot({ variables: ['x', 'y'] });
    const sidecar = serializeScopeSidecar('src/ref.ts', root)!;
    expect(sidecar.scopes[0]!.variables).toEqual(['x', 'y']);
    expect(sidecar.scopes[0]!.variables).not.toBe(root.variables);
  });

  it('handles deeply nested structure (recursion depth)', () => {
    let node: OriginalScopeNode = makeRoot({ variables: ['leaf'] });
    const root = node;
    for (let i = 0; i < 5; i++) {
      const child: OriginalScopeNode = {
        index: i + 1,
        sourceIndex: 0,
        start: { line: i + 1, column: 0 },
        end: { line: i + 2, column: 0 },
        isStackFrame: false,
        variables: [],
        children: [],
      };
      node.children.push(child);
      node = child;
    }
    const sidecar = serializeScopeSidecar('src/deep.ts', root)!;
    expect(sidecar.scopeCount).toBe(6);
  });

  it('produces valid JSON (no circular refs)', () => {
    const child: OriginalScopeNode = {
      index: 1,
      sourceIndex: 0,
      start: { line: 2, column: 0 },
      end: { line: 3, column: 0 },
      isStackFrame: false,
      variables: [],
      children: [],
    };
    const root = makeRoot({ children: [child] });
    const sidecar = serializeScopeSidecar('src/json.ts', root)!;
    expect(() => JSON.stringify(sidecar)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(sidecar));
    expect(parsed.scopes[0].children[0]).toBeDefined();
  });
});
