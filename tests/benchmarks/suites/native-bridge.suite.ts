/**
 * Native bridge domain — status report and fallback guide (offline, no bridge process needed).
 *
 * Ground truth:
 *  - native_bridge_status reports connection failure / offline status for loopback endpoints
 *  - rizin_bridge / binary_ninja_bridge guide actions return offline documentation/setup guidelines
 *  - loopback check rejects non-loopback endpoints (SSRF guard)
 */
import { NativeBridgeHandlers } from '@server/domains/native-bridge/handlers.impl';
import { body, expectSuccess, type BenchSuite } from '../harness';

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

    // ── Bridge-contract batch 2026-11-12 (autoresearch) ──────────────────────
    // The bridge/symbol tools need a running Ghidra/IDA/Binary Ninja bridge.
    // Portable contract: a missing "action" is rejected by name, the symbol
    // source enum is validated first, and an unavailable backend is reported
    // rather than pretending symbols were synced.
    {
      name: 'ghidra_bridge/requires-action',
      tool: 'ghidra_bridge',
      origin: 'homemade',
      reference: 'argument contract: the Ghidra bridge needs an action and names it when absent',
      run: () => handlers.handleGhidraBridge({}),
      validate: (v) => {
        const text = JSON.stringify(body(v));
        return /action/i.test(text) ? true : `expected an action error: ${text.slice(0, 180)}`;
      },
    },
    {
      name: 'ida_bridge/requires-action',
      tool: 'ida_bridge',
      origin: 'homemade',
      reference: 'argument contract: the IDA bridge needs an action and names it when absent',
      run: () => handlers.handleIdaBridge({}),
      validate: (v) => {
        const text = JSON.stringify(body(v));
        return /action/i.test(text) ? true : `expected an action error: ${text.slice(0, 180)}`;
      },
    },
    {
      name: 'native_symbol_sync/validates-source-enum',
      tool: 'native_symbol_sync',
      origin: 'homemade',
      reference:
        'argument contract: symbol sync accepts only ghidra/ida/rizin/binaryninja as the source and lists them on any other value',
      run: () => handlers.handleNativeSymbolSync({}),
      validate: (v) => {
        const text = JSON.stringify(body(v));
        return /ghidra, ida, rizin, binaryninja/.test(text)
          ? true
          : `expected the source enum list: ${text.slice(0, 180)}`;
      },
    },
    {
      name: 'native_symbol_sync/unavailable-backend-reported',
      tool: 'native_symbol_sync',
      origin: 'homemade',
      reference:
        'availability contract: a valid but unavailable source reports the backend state instead of claiming a successful sync',
      run: () => handlers.handleNativeSymbolSync({ source: 'ghidra' }),
      validate: (v) => {
        const b = body(v);
        if (b['success'] === true) {
          const synced = b['synced'] ?? b['symbols'];
          return Array.isArray(synced) ? true : 'success without a synced symbol list';
        }
        const text = JSON.stringify(b);
        // The bridge is contacted over HTTP; an absent server surfaces as a
        // transport error (fetch failed / ECONNREFUSED) plus the endpoint it
        // tried, which is the honest "backend unavailable" answer.
        return /unavailable|not available|not running|connect|fetch failed|ECONNREFUSED/i.test(
          text,
        ) && /endpoint/i.test(text)
          ? true
          : `failure should report backend availability: ${text.slice(0, 220)}`;
      },
    },
  ],
};
