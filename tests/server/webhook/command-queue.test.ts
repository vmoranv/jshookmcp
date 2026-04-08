import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommandQueue } from '@src/server/webhook/CommandQueue';

describe('CommandQueue', () => {
  let queue: CommandQueue;

  beforeEach(() => {
    queue = new CommandQueue({ maxRetries: 2, retryDelay: 100, processTimeout: 1000 });
  });

  describe('enqueue', () => {
    it('should add command to queue and return ID', async () => {
      const id = await queue.enqueue({
        endpointId: 'ep-1',
        payload: { action: 'test' },
      });
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('should emit enqueued event', async () => {
      const events: unknown[] = [];
      queue.on('enqueued', (e) => events.push(e));

      await queue.enqueue({ endpointId: 'ep-1', payload: {} });
      expect(events).toHaveLength(1);
    });
  });

  describe('dequeue', () => {
    it('should return all pending commands', async () => {
      await queue.enqueue({ endpointId: 'ep-1', payload: { a: 1 } });
      await queue.enqueue({ endpointId: 'ep-1', payload: { a: 2 } });

      const pending = await queue.dequeue({ status: 'pending' });
      expect(pending).toHaveLength(2);
    });

    it('should filter by endpointId', async () => {
      await queue.enqueue({ endpointId: 'ep-1', payload: {} });
      await queue.enqueue({ endpointId: 'ep-2', payload: {} });

      const filtered = await queue.dequeue({ endpointId: 'ep-1' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].endpointId).toBe('ep-1');
    });

    it('should return empty array when no matches', async () => {
      const result = await queue.dequeue({ status: 'processed' });
      expect(result).toEqual([]);
    });
  });

  describe('process', () => {
    it('should process command successfully', async () => {
      const id = await queue.enqueue({ endpointId: 'ep-1', payload: { data: 'test' } });

      await queue.process(id, async () => {});
      const entries = await queue.dequeue({ status: 'processed' });
      expect(entries).toHaveLength(1);
    });

    it('should throw if command not found', async () => {
      await expect(queue.process('nonexistent', async () => {})).rejects.toThrow(
        'Command nonexistent not found',
      );
    });

    it('should throw if already processed', async () => {
      const id = await queue.enqueue({ endpointId: 'ep-1', payload: {} });
      await queue.process(id, async () => {});
      await expect(queue.process(id, async () => {})).rejects.toThrow('already processed');
    });

    it('should retry on failure up to maxRetries', async () => {
      const id = await queue.enqueue({ endpointId: 'ep-1', payload: {} });

      await expect(
        queue.process(id, async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow('fail');
      const entries1 = await queue.dequeue({ status: 'pending' });
      expect(entries1).toHaveLength(1);
      expect(entries1[0]!.retries).toBe(1);

      await expect(
        queue.process(id, async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow('fail');
      const entries2 = await queue.dequeue({ status: 'failed' });
      expect(entries2).toHaveLength(1);
    });

    it('should timeout on slow handler', async () => {
      const queue2 = new CommandQueue({ processTimeout: 50 });
      const id = await queue2.enqueue({ endpointId: 'ep-1', payload: {} });

      await expect(
        queue2.process(id, async () => {
          await new Promise((r) => setTimeout(r, 200));
        }),
      ).rejects.toThrow('Process timeout');
    });

    it('should emit processed event', async () => {
      const events: unknown[] = [];
      queue.on('processed', (e) => events.push(e));

      const id = await queue.enqueue({ endpointId: 'ep-1', payload: {} });
      await queue.process(id, async () => {});
      expect(events).toHaveLength(1);
    });

    it('should emit retried event on failure with retries remaining', async () => {
      const events: unknown[] = [];
      queue.on('retried', (e) => events.push(e));

      const id = await queue.enqueue({ endpointId: 'ep-1', payload: {} });
      await expect(
        queue.process(id, async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow();
      expect(events).toHaveLength(1);
    });

    it('should emit failed event when retries exhausted', async () => {
      const events: unknown[] = [];
      queue.on('failed', (e) => events.push(e));

      const id = await queue.enqueue({ endpointId: 'ep-1', payload: {} });
      await expect(
        queue.process(id, async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow();
      await expect(
        queue.process(id, async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow();
      expect(events).toHaveLength(1);
    });
  });

  describe('retry', () => {
    it('should re-queue failed command', async () => {
      const id = await queue.enqueue({ endpointId: 'ep-1', payload: {} });

      await expect(
        queue.process(id, async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow();
      await expect(
        queue.process(id, async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow();

      await queue.retry(id);
      const entries = await queue.dequeue({ status: 'pending' });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.retries).toBe(0);
      expect(entries[0]!.lastError).toBeUndefined();
    });

    it('should throw if command not found', async () => {
      await expect(queue.retry('nonexistent')).rejects.toThrow('not found');
    });

    it('should throw if command not in failed state', async () => {
      const id = await queue.enqueue({ endpointId: 'ep-1', payload: {} });
      await expect(queue.retry(id)).rejects.toThrow('not in failed state');
    });
  });

  describe('state export/import', () => {
    it('should export and import state correctly', async () => {
      await queue.enqueue({ endpointId: 'ep-1', payload: { key: 'value' } });

      const state = queue.exportState();
      expect(state).toHaveLength(1);

      const queue2 = new CommandQueue();
      queue2.importState(state);
      const entries = await queue2.dequeue({ status: 'pending' });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.payload).toEqual({ key: 'value' });
    });

    it('should handle empty state import', () => {
      const queue2 = new CommandQueue();
      queue2.importState([]);
      expect(queue2.exportState()).toEqual([]);
    });
  });

  describe('event listener off', () => {
    it('should remove event listener', async () => {
      const fn = vi.fn();
      queue.on('enqueued', fn);
      queue.off('enqueued', fn);

      await queue.enqueue({ endpointId: 'ep-1', payload: {} });
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
