/**
 * detailId generation tests (a2-13): ids come from crypto.randomUUID and are
 * regenerated once when the first draw collides with an existing cache entry.
 * node:crypto is mocked at file scope so both branches are deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { randomUUIDMock } = vi.hoisted(() => ({
  randomUUIDMock: vi.fn<() => string>(),
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomUUID: randomUUIDMock };
});

import { DetailedDataManager } from '@utils/DetailedDataManager';

describe('DetailedDataManager detailId generation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(async () => {
    await DetailedDataManager.getInstance().shutdownAsync();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses crypto.randomUUID in the detail id', async () => {
    randomUUIDMock.mockImplementation(() => '11111111-2222-4333-8444-555555555555');
    const manager = DetailedDataManager.getInstance();
    const id = await manager.store({ x: 1 });
    expect(id).toBe(`detail_${Date.now()}_11111111-2222-4333-8444-555555555555`);
  });

  it('regenerates the id once when the first draw collides with an existing entry', async () => {
    const manager = DetailedDataManager.getInstance();
    // Draw sequence: store1 -> 'u1'; store2 -> 'u1' (collides, redraw) -> 'u2'.
    const draws = ['u1', 'u1', 'u2'];
    randomUUIDMock.mockImplementation(() => draws.shift()!);

    const id1 = await manager.store({ a: 1 });
    const id2 = await manager.store({ b: 2 });

    expect(id1).not.toBe(id2);
    expect(manager.retrieve(id1)).toEqual({ a: 1 });
    expect(manager.retrieve(id2)).toEqual({ b: 2 });
  });
});
