import { describe, expect, it } from 'vitest';

import { ConsoleMonitor as CoreConsoleMonitor } from '@modules/monitor/ConsoleMonitor.impl.core';
import { ConsoleMonitor as ClassConsoleMonitor } from '@modules/monitor/ConsoleMonitor.impl.core.class';

describe('ConsoleMonitor.impl.core.ts', () => {
  it('re-exports the ConsoleMonitor class from the class module', () => {
    expect(CoreConsoleMonitor).toBe(ClassConsoleMonitor);
  });
});
