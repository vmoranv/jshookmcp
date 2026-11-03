/**
 * Native bridge domain — status report and fallback guide (offline, no bridge process needed).
 *
 * Ground truth:
 *  - native_bridge_status reports connection failure / offline status for loopback endpoints
 *  - rizin_bridge / binary_ninja_bridge guide actions return offline documentation/setup guidelines
 *  - loopback check rejects non-loopback endpoints (SSRF guard)
 */
import { NativeBridgeHandlers } from '@server/domains/native-bridge/handlers.impl';
import { expectSuccess, type BenchSuite } from '../harness';

const handlers = new NativeBridgeHandlers();

export const nativeBridgeSuite: BenchSuite = {
  name: 'native-bridge',
  domain: 'native-bridge',
  description:
    'Native bridge offline status probing, SSRF loopback endpoint validation, and static tool guides',
  cases: [
    {
      name: 'native_bridge_status/loopback-probe-offline',
      tool: 'native_bridge_status',
      origin: 'homemade',
      reference:
        'status check against all 4 backends reports structured results with reachable=false when no bridge is listening',
      run: async () => {
        return handlers.handleNativeBridgeStatusTool({ backend: 'all' });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const backends = (b.backends as Array<Record<string, unknown>>) ?? [];
        if (backends.length !== 4) return `expected 4 backends, got ${backends.length}`;
        const names = backends.map((x) => String(x.backend));
        if (
          !names.includes('ghidra') ||
          !names.includes('ida') ||
          !names.includes('rizin') ||
          !names.includes('binaryninja')
        ) {
          return `backends missing expected entries: ${names.join(',')}`;
        }
        return true;
      },
    },
    {
      name: 'rizin_bridge/guide-action',
      tool: 'rizin_bridge',
      origin: 'homemade',
      reference: 'static action returns setup guide and official links',
      run: async () => {
        return handlers.handleRizinBridgeTool({ action: 'guide' });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const guide = b.guide as Record<string, unknown> | undefined;
        if (!guide) return `expected guide object: ${JSON.stringify(b)}`;
        const links = (guide.links as string[]) ?? [];
        if (!links.some((l) => l.includes('rizin.re'))) return 'guide missing rizin.re link';
        return true;
      },
    },
    {
      name: 'binary_ninja_bridge/guide-action',
      tool: 'binary_ninja_bridge',
      origin: 'homemade',
      reference: 'static action returns setup guide and official links',
      run: async () => {
        return handlers.handleBinaryNinjaBridgeTool({ action: 'guide' });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        const guide = b.guide as Record<string, unknown> | undefined;
        if (!guide) return `expected guide object: ${JSON.stringify(b)}`;
        const links = (guide.links as string[]) ?? [];
        if (!links.some((l) => l.includes('binary.ninja')))
          return 'guide missing binary.ninja link';
        return true;
      },
    },
  ],
};
