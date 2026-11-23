import { describe, expect, it } from 'vitest';

import { evaluateRegistry } from '../../../scripts/search-tune/registry-eval';
import { buildBaseline } from '../../../scripts/search-tune/run-baseline';

describe('baseline and registry entry points', () => {
  it('expose callable entry points without executing their CLIs on import', () => {
    expect(typeof buildBaseline).toBe('function');
    expect(typeof evaluateRegistry).toBe('function');
  });
});
