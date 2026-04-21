import { describe, it, expect } from 'vitest';
import manifest from '../../../../src/server/domains/shared-state-board/manifest';

describe('shared-state-board manifest', () => {
  it('should have correct domain configuration', () => {
    expect(manifest.domain).toBe('shared-state-board');
    expect(manifest.depKey).toBe('sharedStateBoardHandlers');
    expect(manifest.version).toBe(1);
    expect(manifest.kind).toBe('domain-manifest');
  });

  it('should have workflow and full profiles', () => {
    expect(manifest.profiles).toContain('full');
    expect(manifest.profiles).toContain('workflow');
  });

  it('should have all tool registrations', () => {
    const toolNames = manifest.registrations.map((r) => r.tool.name);

    expect(toolNames).toContain('state_board');
    expect(toolNames).toContain('state_board_watch');
    expect(toolNames).toContain('state_board_io');
    expect(toolNames).toHaveLength(3);
  });

  it('should have ensure function that returns handler instance', () => {
    const mockCtx = {
      getDomainInstance: () => undefined,
    } as unknown as import('@server/MCPServer.context').MCPServerContext;
    const handler = manifest.ensure(mockCtx);

    expect(handler).toBeDefined();
    expect(typeof handler.handleSet).toBe('function');
    expect(typeof handler.handleGet).toBe('function');
    expect(typeof handler.handleDelete).toBe('function');
    expect(typeof handler.handleList).toBe('function');
    expect(typeof handler.handleDispatch).toBe('function');
    expect(typeof handler.handleWatch).toBe('function');
    expect(typeof handler.handleUnwatch).toBe('function');
    expect(typeof handler.handleHistory).toBe('function');
    expect(typeof handler.handleExport).toBe('function');
    expect(typeof handler.handleImport).toBe('function');
    expect(typeof handler.handleClear).toBe('function');
  });
});
