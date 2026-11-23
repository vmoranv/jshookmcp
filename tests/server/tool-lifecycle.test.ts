import { describe, expect, it, vi } from 'vitest';
import { deactivateToolCore, type ToolDeactivationDeps } from '@server/tool-lifecycle';

/**
 * Regression test: deactivation must clear the full extension record state.
 * Leaving `activationSource` / `activatedAt` behind made a deactivated tool
 * still look reload-activated (ExtensionManager.reload's `autoActivatedTools`)
 * and drifted the TTL/LRU bookkeeping from reality.
 */
function createDeps(): {
  deps: ToolDeactivationDeps;
  remove: ReturnType<typeof vi.fn>;
  removeHandler: ReturnType<typeof vi.fn>;
  record: {
    registeredTool?: unknown;
    activatedAt?: string;
    activationSource?: 'reload' | 'activate_tools' | 'activate_domain';
  };
} {
  const remove = vi.fn();
  const removeHandler = vi.fn();
  const record = {
    registeredTool: { remove },
    activatedAt: '2026-11-23T00:00:00.000Z',
    activationSource: 'reload' as const,
  };

  const deps: ToolDeactivationDeps = {
    activatedToolNames: new Set(['tool_a']),
    activatedRegisteredTools: new Map([['tool_a', { remove }]]),
    router: { removeHandler },
    extensionToolsByName: new Map([['tool_a', record]]),
  };

  return { deps, remove, removeHandler, record };
}

describe('deactivateToolCore', () => {
  it('removes the registration and clears all tracking state', () => {
    const { deps, remove, removeHandler, record } = createDeps();

    deactivateToolCore('tool_a', deps);

    expect(remove).toHaveBeenCalledOnce();
    expect(removeHandler).toHaveBeenCalledWith('tool_a');
    expect(deps.activatedToolNames.has('tool_a')).toBe(false);
    expect(deps.activatedRegisteredTools.has('tool_a')).toBe(false);
    expect(record).toEqual({
      registeredTool: undefined,
      activatedAt: undefined,
      activationSource: undefined,
    });
  });

  it('still cleans up when the registered tool removal throws', () => {
    const { deps, record } = createDeps();
    deps.activatedRegisteredTools.set('tool_a', {
      remove: () => {
        throw new Error('already gone');
      },
    });

    expect(() => deactivateToolCore('tool_a', deps)).not.toThrow();
    expect(deps.activatedToolNames.has('tool_a')).toBe(false);
    expect(record.registeredTool).toBeUndefined();
  });

  it('ignores a non-extension tool with no extension record', () => {
    const removeHandler = vi.fn();
    const deps: ToolDeactivationDeps = {
      activatedToolNames: new Set(['builtin_tool']),
      activatedRegisteredTools: new Map(),
      router: { removeHandler },
    };

    deactivateToolCore('builtin_tool', deps);

    expect(removeHandler).toHaveBeenCalledWith('builtin_tool');
    expect(deps.activatedToolNames.has('builtin_tool')).toBe(false);
  });
});
