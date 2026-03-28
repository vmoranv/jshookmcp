import { describe, expect, it } from 'vitest';
import * as exports from '@server/domains/macro/index';
import { macroTools } from '@server/domains/macro/definitions';
import { MacroToolHandlers } from '@server/domains/macro/handlers';

describe('macro domain exports', () => {
  it('should export macroTools', () => {
    expect(exports.macroTools).toBe(macroTools);
  });

  it('should export MacroToolHandlers', () => {
    expect(exports.MacroToolHandlers).toBe(MacroToolHandlers);
  });
});
