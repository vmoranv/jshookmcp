import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as entry from '@src/native/NativeMemoryManager';
import * as implementation from '@src/native/NativeMemoryManager.impl';

describe('NativeMemoryManager entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-exports the implementation surface from NativeMemoryManager.impl', () => {
    expect(entry.NativeMemoryManager).toBe(implementation.NativeMemoryManager);
    expect(entry.scanRegionInChunks).toBe(implementation.scanRegionInChunks);
  });
});
