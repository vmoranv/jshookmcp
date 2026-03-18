import { beforeEach, describe, expect, it } from 'vitest';
import { isExtensionBuilder, isWorkflowContract } from '@server/extensions/ExtensionManager.guards';

describe('ExtensionManager.guards', () => {
  beforeEach(() => {
    // Keep a consistent structure with other server tests.
  });

  it('recognizes a valid extension builder shape', () => {
    expect(
      isExtensionBuilder({
        id: 'plugin-id',
        version: '1.0.0',
        tools: [],
      })
    ).toBe(true);
  });

  it('rejects invalid extension builder values', () => {
    expect(isExtensionBuilder(null)).toBe(false);
    expect(isExtensionBuilder('plugin')).toBe(false);
    expect(
      isExtensionBuilder({
        id: 'plugin-id',
        version: '1.0.0',
        tools: 'not-an-array',
      })
    ).toBe(false);
    expect(
      isExtensionBuilder({
        id: 'plugin-id',
        tools: [],
      })
    ).toBe(false);
  });

  it('recognizes a valid workflow contract shape', () => {
    expect(
      isWorkflowContract({
        kind: 'workflow-contract',
        version: 1,
        id: 'workflow-id',
        displayName: 'Workflow',
        build: () => ({ kind: 'sequence', id: 'root', steps: [] }),
      })
    ).toBe(true);
  });

  it('rejects invalid workflow contract values', () => {
    expect(isWorkflowContract(undefined)).toBe(false);
    expect(
      isWorkflowContract({
        kind: 'workflow-contract',
        version: 2,
        id: 'workflow-id',
        displayName: 'Workflow',
        build: () => ({ kind: 'sequence', id: 'root', steps: [] }),
      })
    ).toBe(false);
    expect(
      isWorkflowContract({
        kind: 'workflow-contract',
        version: 1,
        id: 'workflow-id',
        displayName: 'Workflow',
      })
    ).toBe(false);
  });
});
