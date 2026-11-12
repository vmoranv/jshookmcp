/**
 * Proxy domain — offline-pure status/CA/rule/capture handlers.
 *
 * Ground truth: the in-memory invariants implemented by ProxyHandlers.
 * No mockttp server is started: every case seeds the handler's private state
 * directly (same reflection pattern as tests/server/domains/proxy/proxy.test.ts)
 * and calls the real facade handler. Session-scoped cases run inside an
 * explicit ToolRequestContext so the session id is deterministic offline.
 *
 * CA fixture lives only under os.tmpdir(); `caPathDir` is redirected there, so
 * proxy_export_ca reads a real local file without touching the repository.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProxyHandlers } from '@server/domains/proxy/handlers.impl';
import { runWithToolRequestContext } from '@server/runtime/ToolRequestContext';
import { body, expectSuccess, type BenchSuite } from '../harness';
import { buildTestUrl } from '@tests/shared/test-urls';

// Placeholder URLs are built from the shared helper (the test-urls guard
// rejects inline literal placeholder hosts). 'cdn.test' as a bare substring
// below is not a URL literal and is intentionally kept.
const U = {
  exampleApi: buildTestUrl('example', { path: 'api', suffix: 'test' }),
  aOne: buildTestUrl('a', { path: 'one', suffix: 'test' }),
  aTwo: buildTestUrl('a', { path: 'two', suffix: 'test' }),
  apiUsers: buildTestUrl('api', { path: 'v1/users', suffix: 'test' }),
  apiOrders: buildTestUrl('api', { path: 'v1/orders', suffix: 'test' }),
  cdnApp: buildTestUrl('cdn', { path: 'app.js', suffix: 'test' }),
  secretToken: buildTestUrl('secret', { path: 'token', suffix: 'test' }),
  apiOld1: buildTestUrl('api', { path: 'old-1', suffix: 'test' }),
  apiOld2: buildTestUrl('api', { path: 'old-2', suffix: 'test' }),
  apiNew1: buildTestUrl('api', { path: 'new-1', suffix: 'test' }),
};

const OWNER = 'bench-owner';

/** Overwrite private handler fields (reflection) — mirrors the proxy unit tests. */
function seed(handlers: ProxyHandlers, state: Record<string, unknown>): void {
  Object.assign(handlers as unknown as Record<string, unknown>, state);
}

const CA_FIXTURE = `-----BEGIN CERTIFICATE-----\nYmpob29rbWNwLWJlbmNoLWNhLWZpeHR1cmU=\n-----END CERTIFICATE-----\n`;

/** Build a fresh handler with an empty, deterministic offline baseline. */
function fresh(): ProxyHandlers {
  const handlers = new ProxyHandlers();
  seed(handlers, {
    server: null,
    currentPort: null,
    captureBuffer: [],
    ruleRecords: [],
    captureClearWatermarks: new Map<string, number>(),
    captureEnabled: true,
  });
  return handlers;
}

/** Run a handler under a fixed session id (the gate does not set a context). */
function inSession<T>(fn: () => Promise<T>, sessionId = OWNER): Promise<T> {
  return runWithToolRequestContext({ sessionId }, fn);
}

/** Allocate an unused ephemeral loopback port cleanly before binding mockttp. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function withLoopbackProxy<T>(
  fn: (handlers: ProxyHandlers, port: number) => Promise<T>,
): Promise<T> {
  const handlers = fresh();
  const port = await getFreePort();
  return inSession(async () => {
    const started = expectSuccess(
      await handlers.handleProxyStartTool({ port, useHttps: false, capture: true }),
    );
    if (Number(started.port) !== port) {
      throw new Error(`failed to bind loopback proxy on port ${port}`);
    }
    try {
      return await fn(handlers, port);
    } finally {
      try {
        await handlers.handleProxyStopTool({});
      } catch {}
    }
  });
}

/** Minimal rule record matching ProxyRuleRecord (offline, no mockttp endpoint). */
function rule(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    ownerSessionId: OWNER,
    endpointId: 'ep-1',
    action: 'mock_response',
    method: 'GET',
    urlPattern: U.exampleApi,
    mockStatus: 200,
    mockBody: 'ok',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

/** Minimal capture entry matching CaptureEntry. */
function capture(
  id: string,
  url: string,
  timestamp: number,
  over: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return { type: 'request', id, url, timestamp, ...over };
}

export const proxySuite: BenchSuite = {
  name: 'proxy',
  domain: 'proxy',
  description:
    'Offline-pure proxy handlers: status reflects server/port/owner/rule-count, export_ca reads a temp cert, list_rules filters by session, get_requests filters by URL, clear_logs watermarks hide old entries',
  cases: [
    {
      name: 'proxy_status/not-running-defaults',
      tool: 'proxy_status',
      origin: 'homemade',
      reference:
        'fresh handler with no server: running=false, port=null, owned=false, totalOwners=0, ruleCount=0, capture=true',
      run: () => fresh().handleProxyStatusTool({}),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.running !== false) return `expected running=false, got ${b.running}`;
        if (b.port !== null) return `expected port=null, got ${JSON.stringify(b.port)}`;
        if (b.owned !== false) return `expected owned=false, got ${b.owned}`;
        if (b.totalOwners !== 0) return `expected totalOwners=0, got ${b.totalOwners}`;
        if (b.ruleCount !== 0) return `expected ruleCount=0, got ${b.ruleCount}`;
        if (b.capture !== true) return `expected capture=true, got ${b.capture}`;
        return true;
      },
    },
    {
      name: 'proxy_status/reflects-server-state',
      tool: 'proxy_status',
      origin: 'homemade',
      reference:
        'seeded running proxy (server set, port 8899, owner lease): running=true, port=8899, owned=true, totalOwners=1; ruleCount counts only rules owned by the session',
      run: () => {
        const handlers = fresh();
        seed(handlers, {
          server: { stop: async () => undefined },
          currentPort: 8899,
          owners: new Set<string>([OWNER]),
          ruleRecords: [rule(), rule({ ownerSessionId: 'other-session', endpointId: 'ep-2' })],
        });
        return inSession(() => handlers.handleProxyStatusTool({}));
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.running !== true) return `expected running=true, got ${b.running}`;
        if (b.port !== 8899) return `expected port=8899, got ${b.port}`;
        if (b.owned !== true) return `expected owned=true, got ${b.owned}`;
        if (b.totalOwners !== 1) return `expected totalOwners=1, got ${b.totalOwners}`;
        if (b.ruleCount !== 1) return `expected ruleCount=1 (session-scoped), got ${b.ruleCount}`;
        return true;
      },
    },
    {
      name: 'proxy_export_ca/reads-temp-cert',
      tool: 'proxy_export_ca',
      origin: 'homemade',
      reference:
        'CA read returns the exact bytes of ca.pem from a temp dir under os.tmpdir() and reports that path; no repo path is touched',
      run: async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'jshook-proxy-bench-'));
        const caDir = path.join(dir, 'ca');
        await mkdir(caDir, { recursive: true });
        const certPath = path.join(caDir, 'ca.pem');
        await writeFile(certPath, CA_FIXTURE, 'utf8');

        const handlers = fresh();
        seed(handlers, { caPathDir: caDir });
        const response = await handlers.handleProxyExportCaTool({});
        return { response, expected: CA_FIXTURE, certPath };
      },
      validate: (result) => {
        const { response, expected, certPath } = result as {
          response: unknown;
          expected: string;
          certPath: string;
        };
        const b = expectSuccess(response);
        if (b.content !== expected) return `cert content mismatch: ${JSON.stringify(b.content)}`;
        if (b.path !== certPath) return `expected path=${certPath}, got ${b.path}`;
        return true;
      },
    },
    {
      name: 'proxy_list_rules/filters-by-session',
      tool: 'proxy_list_rules',
      origin: 'homemade',
      reference:
        'list_rules returns only rules whose ownerSessionId equals the current session, count matches that filtered set, and each rule is surfaced with its urlPattern',
      run: () => {
        const handlers = fresh();
        seed(handlers, {
          ruleRecords: [
            rule({ endpointId: 'ep-1', urlPattern: U.aOne }),
            rule({ endpointId: 'ep-2', urlPattern: U.aTwo, method: 'POST' }),
            rule({ ownerSessionId: 'foreign', endpointId: 'ep-3' }),
          ],
        });
        return inSession(() => handlers.handleProxyListRulesTool({}));
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.count !== 2) return `expected count=2 (session-scoped), got ${b.count}`;
        const rules = b.rules;
        if (!Array.isArray(rules) || rules.length !== 2)
          return `rules not a 2-array: ${JSON.stringify(rules)}`;
        const serialized = JSON.stringify(rules);
        if (!serialized.includes(U.aOne)) return 'missing owned rule urlPattern /one';
        if (!serialized.includes(U.aTwo)) return 'missing owned rule urlPattern /two';
        if (serialized.includes('foreign')) return 'foreign-session rule leaked into result';
        return true;
      },
    },
    {
      name: 'proxy_get_requests/url-filter',
      tool: 'proxy_get_requests',
      origin: 'homemade',
      reference:
        'get_requests with urlFilter returns only capture entries whose url contains the filter, count equals that subset, capture-disabled short-circuits to empty logs',
      run: () => {
        const handlers = fresh();
        seed(handlers, {
          captureBuffer: [
            capture('r1', U.apiUsers, 1),
            capture('r2', U.apiOrders, 2),
            capture('r3', U.cdnApp, 3),
          ],
        });
        return inSession(() => handlers.handleProxyGetRequestsTool({ urlFilter: '/v1/' }));
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.count !== 2) return `expected count=2 for /v1/ filter, got ${b.count}`;
        const logs = b.logs;
        if (!Array.isArray(logs) || logs.length !== 2)
          return `logs not a 2-array: ${JSON.stringify(logs)}`;
        const serialized = JSON.stringify(logs);
        if (serialized.includes('cdn.test')) return 'urlFilter leaked non-matching cdn.test entry';
        return true;
      },
    },
    {
      name: 'proxy_get_requests/capture-disabled-empty',
      tool: 'proxy_get_requests',
      origin: 'homemade',
      reference:
        'when captureEnabled=false, get_requests returns count=0/logs=[]/captureEnabled=false even with stale buffered entries',
      run: () => {
        const handlers = fresh();
        seed(handlers, {
          captureEnabled: false,
          captureBuffer: [capture('stale', U.secretToken, 1)],
        });
        return inSession(() => handlers.handleProxyGetRequestsTool({}));
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.captureEnabled !== false)
          return `expected captureEnabled=false, got ${b.captureEnabled}`;
        if (b.count !== 0) return `expected count=0, got ${b.count}`;
        if (!Array.isArray(b.logs) || b.logs.length !== 0)
          return `expected logs=[], got ${JSON.stringify(b.logs)}`;
        return true;
      },
    },
    {
      name: 'proxy_clear_logs/watermark-hides-old-entries',
      tool: 'proxy_clear_logs',
      origin: 'homemade',
      reference:
        'clear_logs sets a Date.now() watermark; get_requests filters entries with timestamp > watermark, so pre-clear entries are hidden but post-clear entries remain visible',
      run: () => {
        const handlers = fresh();
        return inSession(async () => {
          const clearResponse = await handlers.handleProxyClearLogsTool({});
          // Read the exact watermark the real handler just wrote for this session.
          const watermarks = (handlers as unknown as Record<string, unknown>)[
            'captureClearWatermarks'
          ] as Map<string, number>;
          const watermark = watermarks.get(OWNER);
          if (watermark === undefined) throw new Error('clear_logs wrote no watermark');
          seed(handlers, {
            captureBuffer: [
              capture('old-1', U.apiOld1, watermark - 10_000),
              capture('old-2', U.apiOld2, watermark - 5_000),
              capture('new-1', U.apiNew1, watermark + 1),
            ],
          });
          const afterResponse = await handlers.handleProxyGetRequestsTool({});
          return { clearResponse, afterResponse };
        });
      },
      validate: (result) => {
        const { clearResponse, afterResponse } = result as {
          clearResponse: unknown;
          afterResponse: unknown;
        };
        const cleared = expectSuccess(clearResponse);
        if (cleared.message !== 'Captured proxy logs cleared.')
          return `unexpected clear message: ${cleared.message}`;
        const b = expectSuccess(afterResponse);
        if (b.count !== 1) return `expected exactly 1 post-clear entry, got ${b.count}`;
        const logs = b.logs;
        if (!Array.isArray(logs) || logs.length !== 1)
          return `logs not a 1-array: ${JSON.stringify(logs)}`;
        const serialized = JSON.stringify(logs);
        if (!serialized.includes('new-1')) return 'post-clear entry missing from logs';
        if (serialized.includes('old-1') || serialized.includes('old-2'))
          return 'pre-clear entry leaked past the clear watermark';
        return true;
      },
    },

    // ── Coverage batch 2026-11-11 (autoresearch): loopback HTTP mockttp lifecycle & rule management ──
    {
      name: 'proxy_start/loopback-http-bind',
      tool: 'proxy_start',
      origin: 'homemade',
      reference: 'starts mockttp loopback HTTP proxy on ephemeral port and releases cleanly',
      run: () =>
        inSession(async () => {
          const handlers = fresh();
          const port = await getFreePort();
          const res = await handlers.handleProxyStartTool({
            port,
            useHttps: false,
            capture: false,
          });
          try {
            await handlers.handleProxyStopTool({});
          } catch {}
          return { res, expectedPort: port };
        }),
      validate: (v) => {
        const { res, expectedPort } = v as { res?: unknown; expectedPort?: number };
        const b = expectSuccess(res);
        if (Number(b.port) !== expectedPort || b.reused !== false)
          return `expected bound port ${expectedPort}, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'proxy_stop/tears-down-running-proxy',
      tool: 'proxy_stop',
      origin: 'homemade',
      reference: 'stops a running loopback proxy and confirms stopped=true, remainingOwners=0',
      run: () =>
        inSession(async () => {
          const handlers = fresh();
          const port = await getFreePort();
          expectSuccess(
            await handlers.handleProxyStartTool({ port, useHttps: false, capture: false }),
          );
          return handlers.handleProxyStopTool({});
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.stopped !== true || Number(b.remainingOwners) !== 0)
          return `expected stopped=true remainingOwners=0, got ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'proxy_add_rule/registers-mock-response-rule',
      tool: 'proxy_add_rule',
      origin: 'homemade',
      reference: 'adds a mock_response rule on running loopback proxy and returns endpointId',
      run: () =>
        withLoopbackProxy((handlers) =>
          handlers.handleProxyAddRuleTool({
            action: 'mock_response',
            method: 'GET',
            urlPattern: U.exampleApi,
            mockStatus: 200,
            mockBody: 'bench-ok',
          }),
        ),
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.endpointId !== 'string' || !b.endpointId.length || !b.rule)
          return `expected endpointId and rule in add_rule response: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'proxy_remove_rule/disposes-added-rule',
      tool: 'proxy_remove_rule',
      origin: 'homemade',
      reference: 'removes an active mock_response rule by endpointId',
      run: () =>
        withLoopbackProxy(async (handlers) => {
          const added = expectSuccess(
            await handlers.handleProxyAddRuleTool({
              action: 'mock_response',
              method: 'GET',
              urlPattern: U.aOne,
              mockStatus: 204,
              mockBody: '',
            }),
          );
          return handlers.handleProxyRemoveRuleTool({ endpointId: added.endpointId });
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (typeof b.endpointId !== 'string' || !b.removedRule)
          return `expected endpointId and removedRule in response: ${JSON.stringify(b)}`;
        return true;
      },
    },
    {
      name: 'proxy_clear_rules/disposes-all-session-rules',
      tool: 'proxy_clear_rules',
      origin: 'homemade',
      reference: 'clears all mockttp rules owned by the current session',
      run: () =>
        withLoopbackProxy(async (handlers) => {
          expectSuccess(
            await handlers.handleProxyAddRuleTool({
              action: 'block',
              method: 'GET',
              urlPattern: U.aTwo,
            }),
          );
          return handlers.handleProxyClearRulesTool({});
        }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (Number(b.cleared) !== 1) return `expected cleared === 1, got ${JSON.stringify(b)}`;
        return true;
      },
    },

    // ── ADB-contract batch 2026-11-12 (autoresearch) ─────────────────────────
    {
      name: 'proxy_setup_adb_device/requires-running-proxy',
      tool: 'proxy_setup_adb_device',
      origin: 'homemade',
      reference:
        'precondition contract: ADB reverse tethering needs a locally running proxy and says so instead of configuring adb against a dead proxy',
      run: () => new ProxyHandlers().handleProxySetupAdbDeviceTool({}),
      validate: (v) => {
        const b = body(v);
        if (b['success'] === true)
          return `must not configure ADB without a running proxy: ${JSON.stringify(b).slice(0, 180)}`;
        return /Proxy must be running/i.test(JSON.stringify(b))
          ? true
          : `failure should name the proxy precondition: ${JSON.stringify(b).slice(0, 180)}`;
      },
    },
  ],
};
