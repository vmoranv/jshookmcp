import { describe, expect, it } from 'vitest';
import * as exports from '@server/domains/sandbox/index';
import { sandboxTools } from '@server/domains/sandbox/definitions';
import { SandboxToolHandlers } from '@server/domains/sandbox/handlers';

describe('sandbox domain exports', () => {
  it('should export sandboxTools', () => {
    expect(exports.sandboxTools).toBe(sandboxTools);
  });

  it('should export SandboxToolHandlers', () => {
    expect(exports.SandboxToolHandlers).toBe(SandboxToolHandlers);
  });
});
