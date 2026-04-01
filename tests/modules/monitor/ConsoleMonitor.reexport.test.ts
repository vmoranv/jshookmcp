import { describe, expect, it } from 'vitest';

import { ConsoleMonitor as PublicConsoleMonitor } from '@modules/monitor/ConsoleMonitor';
import { ConsoleMonitor as ImplConsoleMonitor } from '@modules/monitor/ConsoleMonitor.impl';

describe('ConsoleMonitor.ts re-exports', () => {
  it('re-exports ConsoleMonitor from ConsoleMonitor.impl', () => {
    expect(PublicConsoleMonitor).toBe(ImplConsoleMonitor);
  });
});
