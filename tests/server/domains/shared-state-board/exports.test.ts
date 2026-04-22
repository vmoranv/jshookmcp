import { describe, expect, it } from 'vitest';
import * as exports_ from '@server/domains/shared-state-board/index';
import { sharedStateBoardTools } from '@server/domains/shared-state-board/index';
import { SharedStateBoardHandlers } from '@server/domains/shared-state-board/index';

describe('shared-state-board index barrel exports', () => {
  it('exports SharedStateBoardHandlers class', async () => {
    expect(exports_.SharedStateBoardHandlers).toBeDefined();
    expect(typeof exports_.SharedStateBoardHandlers).toBe('function');
  });

  it('exports sharedStateBoardTools array', async () => {
    expect(exports_.sharedStateBoardTools).toBe(sharedStateBoardTools);
    expect(Array.isArray(exports_.sharedStateBoardTools)).toBe(true);
  });

  it('SharedStateBoardHandlers has all required handler methods', async () => {
    const h = new SharedStateBoardHandlers();
    expect(typeof h.handleSet).toBe('function');
    expect(typeof h.handleGet).toBe('function');
    expect(typeof h.handleDelete).toBe('function');
    expect(typeof h.handleList).toBe('function');
    expect(typeof h.handleWatch).toBe('function');
    expect(typeof h.handleUnwatch).toBe('function');
    expect(typeof h.handlePoll).toBe('function');
    expect(typeof h.handleHistory).toBe('function');
    expect(typeof h.handleExport).toBe('function');
    expect(typeof h.handleImport).toBe('function');
    expect(typeof h.handleClear).toBe('function');
    expect(typeof h.handleStats).toBe('function');
    expect(typeof h.cleanupExpired).toBe('function');
  });
});
