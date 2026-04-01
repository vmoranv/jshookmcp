import { describe, expect, it } from 'vitest';

import { NetworkMonitor as PublicNetworkMonitor } from '@modules/monitor/NetworkMonitor';
import { NetworkMonitor as ImplNetworkMonitor } from '@modules/monitor/NetworkMonitor.impl';

describe('NetworkMonitor.ts re-exports', () => {
  it('re-exports NetworkMonitor from NetworkMonitor.impl', () => {
    expect(PublicNetworkMonitor).toBe(ImplNetworkMonitor);
  });
});
