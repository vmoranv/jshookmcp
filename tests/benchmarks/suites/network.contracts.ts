/**
 * network domain contract cases — the 10 tools that need a browser, a raw
 * socket, or an external resolver.
 *
 * Ground truth on any machine:
 *  - console-inject dispatchers route by `type` and report which path ran
 *  - CDP performance/profiler controls refuse explicitly without a live page
 *    instead of returning zeroed metrics or an empty profile
 *  - loopback probes are answered by the host stack (ICMP echo, 1-hop
 *    traceroute), and unreachable endpoints report the connection error with
 *    no protocol details
 *  - a single unresolved reverse lookup fails with the resolver error and an
 *    empty hostname list
 */
import { AdvancedToolHandlers } from '@server/domains/network/handlers';
import { body } from '../harness';

/** Loopback authorization bag — private-network / insecure-http targets need it. */
const LOOPBACK_AUTH = {
  allowedHosts: ['127.0.0.1'],
  allowPrivateNetwork: true,
  allowInsecureHttp: true,
};

type Args = Record<string, unknown>;

function makeHandlers(monitor: Record<string, unknown> = {}): AdvancedToolHandlers {
  return new AdvancedToolHandlers({ getActivePage: async () => null } as never, monitor as never);
}

const defaultHandlers = makeHandlers();

const text = (v: unknown): Record<string, unknown> => body(v) as Record<string, unknown>;

const namedFailure: (b: Args) => true | string = (b) => {
  const message = String(b['error'] ?? b['message'] ?? b['raw'] ?? '');
  return message.length > 0
    ? true
    : `failure without a named reason: ${JSON.stringify(b).slice(0, 160)}`;
};

export const networkContractCases = [
  {
    name: 'console_inject/dispatches-by-type',
    tool: 'console_inject',
    origin: 'homemade' as const,
    reference:
      'dispatch contract: type=xhr/fetch route to the matching interceptor, and the default path is the script monitor — the response names which path ran',
    run: async () => {
      const calls: string[] = [];
      const h = makeHandlers({
        injectXHRInterceptor: async () => void calls.push('xhr'),
        injectFetchInterceptor: async () => void calls.push('fetch'),
        enableDynamicScriptMonitoring: async () => void calls.push('script'),
      });
      return {
        xhr: text(await h.handleConsoleInjectDispatch({ type: 'xhr' })),
        fetch: text(await h.handleConsoleInjectDispatch({ type: 'fetch' })),
        script: text(await h.handleConsoleInjectDispatch({})),
        calls,
      };
    },
    validate: (v: unknown) => {
      const r = v as Args;
      if (JSON.stringify(r['calls']) !== JSON.stringify(['xhr', 'fetch', 'script']))
        return `dispatch order wrong: ${JSON.stringify(r['calls'])}`;
      const xhr = r['xhr'] as Args;
      if (!/XHR interceptor injected/.test(String(xhr['message'] ?? '')))
        return `xhr message wrong: ${JSON.stringify(xhr)}`;
      const fetchRes = r['fetch'] as Args;
      if (!/Fetch interceptor injected/.test(String(fetchRes['message'] ?? '')))
        return `fetch message wrong: ${JSON.stringify(fetchRes)}`;
      return true;
    },
  },
  {
    name: 'console_inject_fetch_interceptor/reports-persistence',
    tool: 'console_inject_fetch_interceptor',
    origin: 'homemade' as const,
    reference:
      'inject contract: persistent=true is forwarded to the monitor and reflected in the confirmation message',
    run: async () => {
      const seen: boolean[] = [];
      const h = makeHandlers({
        injectFetchInterceptor: async (opts: Args) => void seen.push(opts?.['persistent'] === true),
      });
      return {
        persistent: text(await h.handleConsoleInjectFetchInterceptor({ persistent: true })),
        oneShot: text(await h.handleConsoleInjectFetchInterceptor({})),
        seen,
      };
    },
    validate: (v: unknown) => {
      const r = v as Args;
      if (JSON.stringify(r['seen']) !== JSON.stringify([true, false]))
        return `persistent flag not forwarded: ${JSON.stringify(r['seen'])}`;
      const persistent = r['persistent'] as Args;
      return /persistent/.test(String(persistent['message'] ?? ''))
        ? true
        : `persistent message missing: ${JSON.stringify(persistent)}`;
    },
  },
  {
    name: 'console_inject_xhr_interceptor/reports-persistence',
    tool: 'console_inject_xhr_interceptor',
    origin: 'homemade' as const,
    reference: 'inject contract: the XHR interceptor path reports the persistence mode it used',
    run: async () => {
      const h = makeHandlers({ injectXHRInterceptor: async () => undefined });
      return text(await h.handleConsoleInjectXhrInterceptor({ persistent: true }));
    },
    validate: (v: unknown) => {
      const b = v as Args;
      if (!/XHR interceptor injected/.test(String(b['message'] ?? '')))
        return `unexpected message: ${JSON.stringify(b)}`;
      return /persistent/.test(String(b['message'])) ? true : `persistence not reported`;
    },
  },
  {
    name: 'performance_get_metrics/refuses-without-page',
    tool: 'performance_get_metrics',
    origin: 'homemade' as const,
    reference:
      'admission contract: performance metrics need a live CDP page and fail explicitly instead of returning zeroed metrics',
    run: () => defaultHandlers.handlePerformanceGetMetrics({}),
    validate: (v: unknown) => {
      const b = text(v);
      if (b['success'] !== false)
        return `expected success=false, got ${JSON.stringify(b).slice(0, 200)}`;
      if (b['metrics'] !== undefined) return `must not return metrics without a page`;
      return namedFailure(b);
    },
  },
  {
    name: 'performance_trace/stop-without-start-refused',
    tool: 'performance_trace',
    origin: 'homemade' as const,
    reference:
      'state contract: stopping a trace that was never started is refused by naming the start step',
    run: () => defaultHandlers.handlePerformanceTraceDispatch({ action: 'stop' }),
    validate: (v: unknown) => {
      const b = text(v);
      if (b['success'] !== false)
        return `expected success=false: ${JSON.stringify(b).slice(0, 160)}`;
      return /not in progress|startTracing/i.test(String(b['error'] ?? b['message'] ?? ''))
        ? true
        : `refusal should name the start step`;
    },
  },
  {
    name: 'profiler_cpu/refuses-without-page',
    tool: 'profiler_cpu',
    origin: 'homemade' as const,
    reference:
      'admission contract: CPU profiling needs a live CDP page and fails explicitly rather than producing an empty profile',
    run: () => defaultHandlers.handleProfilerCpuDispatch({ action: 'stop' }),
    validate: (v: unknown) => {
      const b = text(v);
      if (b['success'] !== false)
        return `expected success=false: ${JSON.stringify(b).slice(0, 160)}`;
      if (b['profile'] !== undefined) return `must not return a profile without a page`;
      return namedFailure(b);
    },
  },
  {
    name: 'http2_probe/requires-url',
    tool: 'http2_probe',
    origin: 'homemade' as const,
    reference:
      'argument contract: the HTTP/2 probe takes a full url (not host/port) and rejects a bare call by name',
    run: () => defaultHandlers.handleHttp2Probe({}),
    validate: (v: unknown) => {
      const b = text(v);
      if (b['success'] !== false)
        return `expected success=false: ${JSON.stringify(b).slice(0, 160)}`;
      return /url is required/.test(String(b['error'] ?? '')) ? true : `expected a url error`;
    },
  },
  {
    name: 'http2_probe/unreachable-endpoint-honest',
    tool: 'http2_probe',
    origin: 'homemade' as const,
    reference:
      'connect contract: an authorized but closed loopback port reports the connection error and no ALPN/settings payload',
    run: () =>
      defaultHandlers.handleHttp2Probe({
        url: 'http://127.0.0.1:1/x',
        authorization: LOOPBACK_AUTH,
      }),
    validate: (v: unknown) => {
      const b = text(v);
      if (b['success'] !== false)
        return `expected success=false: ${JSON.stringify(b).slice(0, 160)}`;
      if (b['settings'] !== undefined || b['alpn'] !== undefined)
        return `must not report protocol details without a connection`;
      return /ECONNREFUSED|connect/i.test(String(b['error'] ?? b['message'] ?? ''))
        ? true
        : `error should name the connection failure`;
    },
  },
  {
    name: 'network_icmp_probe/loopback-echo',
    tool: 'network_icmp_probe',
    origin: 'homemade' as const,
    reference:
      'ICMP semantics: a loopback echo request is answered by the host stack — alive true, the resolved ip echoed back, and a numeric round-trip time',
    run: () =>
      defaultHandlers.handleNetworkIcmpProbe({
        target: '127.0.0.1',
        count: 1,
        timeout: 500,
        authorization: LOOPBACK_AUTH,
      }),
    validate: (v: unknown) => {
      const b = text(v);
      if (b['success'] === false) {
        // Raw ICMP may be unavailable without privileges; the honest contract
        // then names the capability rather than reporting "unreachable".
        return /not available|root|CAP_NET_RAW/i.test(String(b['error'] ?? ''))
          ? true
          : `unexpected ICMP failure: ${String(b['error']).slice(0, 160)}`;
      }
      if (b['alive'] !== true) return `loopback should be alive: ${JSON.stringify(b)}`;
      if (b['ip'] !== '127.0.0.1') return `resolved ip not echoed`;
      return typeof b['rtt'] === 'number' ? true : `rtt missing`;
    },
  },
  {
    name: 'network_icmp_probe/requires-target',
    tool: 'network_icmp_probe',
    origin: 'homemade' as const,
    reference: 'argument contract: the ICMP probe needs a target and names it when absent',
    run: () => defaultHandlers.handleNetworkIcmpProbe({}),
    validate: (v: unknown) => {
      const serialized = JSON.stringify(text(v));
      return /target is required/i.test(serialized)
        ? true
        : `expected a target error: ${serialized.slice(0, 160)}`;
    },
  },
  {
    name: 'network_traceroute/loopback-single-hop',
    tool: 'network_traceroute',
    origin: 'homemade' as const,
    reference:
      'traceroute semantics: a loopback target is reached in one hop, and the hop list carries the resolved ip',
    run: () =>
      defaultHandlers.handleNetworkTraceroute({
        target: '127.0.0.1',
        maxHops: 1,
        timeout: 500,
        authorization: LOOPBACK_AUTH,
      }),
    validate: (v: unknown) => {
      const b = text(v);
      if (b['success'] === false) {
        return /not available|root|CAP_NET_RAW/i.test(String(b['error'] ?? ''))
          ? true
          : `unexpected traceroute failure: ${String(b['error']).slice(0, 160)}`;
      }
      const hops = b['hops'] as Array<Args> | undefined;
      if (!Array.isArray(hops) || hops.length === 0)
        return `hops missing: ${JSON.stringify(b).slice(0, 160)}`;
      if (b['reached'] !== true) return `loopback should be reached`;
      return hops[0]?.['ip'] === '127.0.0.1' ? true : `first hop should be loopback`;
    },
  },
  {
    name: 'network_traceroute/requires-target',
    tool: 'network_traceroute',
    origin: 'homemade' as const,
    reference: 'argument contract: traceroute needs a target and names it when absent',
    run: () => defaultHandlers.handleNetworkTraceroute({}),
    validate: (v: unknown) => {
      const serialized = JSON.stringify(text(v));
      return /target is required/i.test(serialized)
        ? true
        : `expected a target error: ${serialized.slice(0, 160)}`;
    },
  },
  {
    name: 'dns_reverse/requires-ip',
    tool: 'dns_reverse',
    origin: 'homemade' as const,
    reference: 'argument contract: reverse DNS needs the ip to look up and names it when absent',
    run: () => defaultHandlers.handleDnsReverse({}),
    validate: (v: unknown) => {
      const serialized = JSON.stringify(text(v));
      return /ip is required/i.test(serialized)
        ? true
        : `expected an ip error: ${serialized.slice(0, 160)}`;
    },
  },
  {
    name: 'dns_reverse/unresolvable-ip-honest',
    tool: 'dns_reverse',
    origin: 'homemade' as const,
    reference:
      'reverse-lookup contract: an address with no PTR record fails with the resolver error and an empty hostname list — never a fabricated name',
    run: () => defaultHandlers.handleDnsReverse({ ip: '10.0.0.1', server: '127.0.0.1:1' }),
    validate: (v: unknown) => {
      const b = text(v);
      const names = b['hostnames'];
      if (b['success'] === true) {
        return Array.isArray(names) && names.length === 0
          ? true
          : `must not invent PTR names: ${JSON.stringify(names)}`;
      }
      if (Array.isArray(names) && names.length > 0) return `must not return hostnames on failure`;
      return /DNS reverse lookup failed|ENOTFOUND|not found/i.test(String(b['error'] ?? ''))
        ? true
        : `failure should name the resolver error`;
    },
  },
];
