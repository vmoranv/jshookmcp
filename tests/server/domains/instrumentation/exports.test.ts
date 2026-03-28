import { describe, expect, it } from 'vitest';
import * as exports from '@server/domains/instrumentation/index';
import { instrumentationTools } from '@server/domains/instrumentation/definitions';
import { InstrumentationHandlers } from '@server/domains/instrumentation/handlers';

describe('instrumentation domain exports', () => {
  it('should export instrumentationTools', () => {
    expect(exports.instrumentationTools).toBe(instrumentationTools);
  });
  it('should export InstrumentationHandlers', () => {
    expect(exports.InstrumentationHandlers).toBe(InstrumentationHandlers);
  });
});
