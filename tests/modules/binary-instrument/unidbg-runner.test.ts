import { describe, expect, it } from 'vitest';
import { UnidbgRunner } from '@modules/binary-instrument/UnidbgRunner';

describe('UnidbgRunner', () => {
  describe('close', () => {
    it('does not throw when closing an unlaunched runner', () => {
      const r = new UnidbgRunner();
      expect(() => r.close()).not.toThrow();
    });

    it('can be called multiple times safely', () => {
      const r = new UnidbgRunner();
      r.close();
      expect(() => r.close()).not.toThrow();
    });
  });

  describe('callFunction', () => {
    it('throws when no session exists', async () => {
      const runner = new UnidbgRunner();
      await expect(runner.callFunction('nonexistent', 'testFunc', {})).rejects.toThrow();
      runner.close();
    });
  });

  describe('trace', () => {
    it('throws when no session exists', async () => {
      const runner = new UnidbgRunner();
      await expect(runner.trace('nonexistent')).rejects.toThrow();
      runner.close();
    });
  });
});
