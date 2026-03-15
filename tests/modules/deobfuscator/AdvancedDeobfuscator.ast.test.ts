import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as parser from '@babel/parser';

const loggerState = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import {
  derotateStringArray,
  removeDeadCode,
  removeOpaquePredicates,
} from '@modules/deobfuscator/AdvancedDeobfuscator.ast';

describe('AdvancedDeobfuscator AST helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes string-array rotation IIFEs while preserving surrounding code', () => {
    const input = `
      (function(){ while(true){ arr.push(arr.shift()); break; } })();
      console.log("kept");
    `;

    const output = derotateStringArray(input);

    expect(output).toContain('console.log("kept")');
    expect(output).not.toContain('arr.push(arr.shift())');
  });

  it('removes dead branches and unreachable statements after return', () => {
    const input = `
      function demo() {
        if (false) { hidden(); } else { visible(); }
        if (true) { alive(); }
        return 1;
        afterReturn();
      }
    `;

    const output = removeDeadCode(input);

    expect(output).toContain('visible()');
    expect(output).toContain('alive()');
    expect(output).not.toContain('hidden()');
    expect(output).not.toContain('afterReturn()');
  });

  it('removes opaque predicates backed by static arithmetic or numeric comparisons', () => {
    const input = `
      if (4 > 1) { hot(); } else { cold(); }
      if ((0 * value) === 0) { always(); }
    `;

    const output = removeOpaquePredicates(input);

    expect(output).toContain('hot()');
    expect(output).toContain('always()');
    expect(output).not.toContain('cold()');
  });

  it('returns the original code when parsing fails', () => {
    const parseSpy = vi.spyOn(parser, 'parse').mockImplementation(() => {
      throw new Error('parse failed');
    });

    expect(removeDeadCode('const keep = true;')).toBe('const keep = true;');

    parseSpy.mockRestore();
  });
});
