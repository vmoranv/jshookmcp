import { describe, expect, it } from 'vitest';
import * as exports from '@server/domains/coordination/index';
import { coordinationTools } from '@server/domains/coordination/definitions';

describe('coordination domain exports', () => {
  it('should export coordinationTools', () => {
    expect(exports.coordinationTools).toBe(coordinationTools);
  });
});
