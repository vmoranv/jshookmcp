/**
 * Registry-coverage retrieval fixture — full-corpus eval set for the REAL
 * 736-tool registry (real descriptions, real distractor pool).
 *
 * Why a second fixture: the search-quality fixture measures a hand-written
 * 163-tool corpus with short descriptions — a production-realistic retrieval
 * benchmark must run against the actual registry (LiveMCPBench "ocean of
 * tools" methodology: distractor pool size is part of the measurement).
 *
 * Built in domain batches (see .ccg/tasks/retrieval-full-coverage): each batch
 * appends one domain's cases. Every tool in a covered domain gets ≥1 case
 * where it is the ideal answer, so per-tool evidence covers the whole domain.
 *
 * Queries are realistic user intents — variants of what doc-expansion
 * keywords (manifest sceneKeywords) anticipate, deliberately NOT verbatim
 * copies, so the benchmark measures retrieval quality rather than echo.
 *
 * Consumers: tests/server/benchmarks/registry-retrieval.test.ts
 */
import type { SearchEvalCase } from '@tests/server/search/fixtures/search-quality.fixture';

export interface RegistryCoverageBatch {
  readonly domain: string;
  readonly cases: readonly SearchEvalCase[];
}

// ── Batch 1 (pilot): network (38 tools) ──

const networkBatch: RegistryCoverageBatch = {
  domain: 'network',
  cases: [
    {
      id: 'reg-net-enable-capture',
      title: 'start capturing page traffic',
      query: 'start capturing http traffic on the page',
      topK: 10,
      expectations: [
        { tool: 'network_enable', gain: 3 },
        { tool: 'network_monitor', gain: 2 },
      ],
      idealTool: 'network_enable',
      tags: ['network'],
    },
    {
      id: 'reg-net-disable-capture',
      title: 'stop traffic capture',
      query: 'stop recording network traffic',
      topK: 10,
      expectations: [{ tool: 'network_disable', gain: 3 }],
      idealTool: 'network_disable',
      tags: ['network'],
    },
    {
      id: 'reg-net-capture-state',
      title: 'is capture active',
      query: 'check whether traffic capture is currently running',
      topK: 10,
      expectations: [{ tool: 'network_get_status', gain: 3 }],
      idealTool: 'network_get_status',
      tags: ['network'],
    },
    {
      id: 'reg-net-watch-requests',
      title: 'watch requests live',
      query: 'watch network requests as they happen',
      topK: 10,
      expectations: [
        { tool: 'network_monitor', gain: 3 },
        { tool: 'network_enable', gain: 2 },
      ],
      idealTool: 'network_monitor',
      tags: ['network'],
    },
    {
      id: 'reg-net-list-captured',
      title: 'list captured calls',
      query: 'show me the http calls that were captured so far',
      topK: 10,
      expectations: [{ tool: 'network_get_requests', gain: 3 }],
      idealTool: 'network_get_requests',
      tags: ['network'],
    },
    {
      id: 'reg-net-response-content',
      title: 'read a response payload',
      query: 'what did the server return in that response body',
      topK: 10,
      expectations: [{ tool: 'network_get_response_body', gain: 3 }],
      idealTool: 'network_get_response_body',
      tags: ['network'],
    },
    {
      id: 'reg-net-traffic-summary',
      title: 'capture overview counters',
      query: 'give me a traffic summary with request counts',
      topK: 10,
      expectations: [{ tool: 'network_get_stats', gain: 3 }],
      idealTool: 'network_get_stats',
      tags: ['network'],
    },
    {
      id: 'reg-net-page-metrics',
      title: 'page performance snapshot',
      query: 'show current page performance numbers',
      topK: 10,
      expectations: [{ tool: 'performance_get_metrics', gain: 3 }],
      idealTool: 'performance_get_metrics',
      tags: ['network'],
    },
    {
      id: 'reg-net-chrome-trace',
      title: 'record a chrome trace',
      query: 'record a chrome tracing session for the page',
      topK: 10,
      expectations: [{ tool: 'performance_trace', gain: 3 }],
      idealTool: 'performance_trace',
      tags: ['network'],
    },
    {
      id: 'reg-net-cpu-profile',
      title: 'sample js cpu usage',
      query: 'profile javascript cpu usage while the page runs',
      topK: 10,
      expectations: [{ tool: 'profiler_cpu', gain: 3 }],
      idealTool: 'profiler_cpu',
      tags: ['network'],
    },
    {
      id: 'reg-net-uncaught-errors',
      title: 'list thrown exceptions',
      query: 'list the javascript errors thrown on the page',
      topK: 10,
      expectations: [{ tool: 'console_get_exceptions', gain: 3 }],
      idealTool: 'console_get_exceptions',
      tags: ['network'],
    },
    {
      id: 'reg-net-console-hook',
      title: 'patch console methods',
      query: 'hook the page console to capture everything it prints',
      topK: 10,
      expectations: [{ tool: 'console_inject', gain: 3 }],
      idealTool: 'console_inject',
      tags: ['network'],
    },
    {
      id: 'reg-net-fetch-hook',
      title: 'log every fetch call',
      query: 'log all fetch calls the page makes',
      topK: 10,
      expectations: [{ tool: 'console_inject_fetch_interceptor', gain: 3 }],
      idealTool: 'console_inject_fetch_interceptor',
      tags: ['network'],
    },
    {
      id: 'reg-net-xhr-hook',
      title: 'log ajax requests',
      query: 'intercept XMLHttpRequest activity on the page',
      topK: 10,
      expectations: [{ tool: 'console_inject_xhr_interceptor', gain: 3 }],
      idealTool: 'console_inject_xhr_interceptor',
      tags: ['network'],
    },
    {
      id: 'reg-net-buffer-contents',
      title: 'inspect ring buffer store',
      query: 'show what the captured data buffer currently holds',
      topK: 10,
      expectations: [{ tool: 'console_buffers', gain: 3 }],
      idealTool: 'console_buffers',
      tags: ['network'],
    },
    {
      id: 'reg-net-craft-http',
      title: 'construct raw request text',
      query: 'craft a raw http request message for this url',
      topK: 10,
      expectations: [{ tool: 'http_request_build', gain: 3 }],
      idealTool: 'http_request_build',
      tags: ['network'],
    },
    {
      id: 'reg-net-send-raw',
      title: 'send over a raw socket',
      query: 'send a hand-built http request over a plain tcp socket',
      topK: 10,
      expectations: [
        { tool: 'http_plain_request', gain: 3 },
        { tool: 'http_request_build', gain: 2 },
      ],
      idealTool: 'http_plain_request',
      tags: ['network'],
    },
    {
      id: 'reg-net-h2-support',
      title: 'test h2 capability',
      query: 'check whether this endpoint speaks http2',
      topK: 10,
      expectations: [{ tool: 'http2_probe', gain: 3 }],
      idealTool: 'http2_probe',
      tags: ['network'],
    },
    {
      id: 'reg-net-h2-frame-craft',
      title: 'build h2 frame bytes',
      query: 'construct an http2 frame with these settings',
      topK: 10,
      expectations: [{ tool: 'http2_frame_build', gain: 3 }],
      idealTool: 'http2_frame_build',
      tags: ['network'],
    },
    {
      id: 'reg-net-h2-frame-decode',
      title: 'dissect h2 frame bytes',
      query: 'decode this raw http2 frame for me',
      topK: 10,
      expectations: [{ tool: 'http2_frame_parse', gain: 3 }],
      idealTool: 'http2_frame_parse',
      tags: ['network'],
    },
    {
      id: 'reg-net-h2-fingerprint',
      title: 'h2 settings fingerprint',
      query: 'compute the akamai-style fingerprint of an http2 connection',
      topK: 10,
      expectations: [{ tool: 'network_http2_fingerprint', gain: 3 }],
      idealTool: 'network_http2_fingerprint',
      tags: ['network'],
    },
    {
      id: 'reg-net-grpc-decode',
      title: 'split grpc frames',
      query: 'decode these length-prefixed grpc message frames',
      topK: 10,
      expectations: [{ tool: 'grpc_frame_parse', gain: 3 }],
      idealTool: 'grpc_frame_parse',
      tags: ['network'],
    },
    {
      id: 'reg-net-grpc-encode',
      title: 'assemble grpc frame',
      query: 'build a grpc message frame from this payload',
      topK: 10,
      expectations: [{ tool: 'grpc_frame_build', gain: 3 }],
      idealTool: 'grpc_frame_build',
      tags: ['network'],
    },
    {
      id: 'reg-net-round-trip',
      title: 'measure round trip delay',
      query: 'how long does a round trip to this host take',
      topK: 10,
      expectations: [{ tool: 'network_rtt_measure', gain: 3 }],
      idealTool: 'network_rtt_measure',
      tags: ['network'],
    },
    {
      id: 'reg-net-delay-percentiles',
      title: 'latency distribution',
      query: 'show the p95 latency distribution for this target',
      topK: 10,
      expectations: [{ tool: 'network_latency_stats', gain: 3 }],
      idealTool: 'network_latency_stats',
      tags: ['network'],
    },
    {
      id: 'reg-net-hop-path',
      title: 'hop-by-hop route',
      query: 'trace the router hops packets take to reach this host',
      topK: 10,
      expectations: [{ tool: 'network_traceroute', gain: 3 }],
      idealTool: 'network_traceroute',
      tags: ['network'],
    },
    {
      id: 'reg-net-icmp-echo',
      title: 'ping a host',
      query: 'ping this server to see if it answers icmp',
      topK: 10,
      expectations: [
        { tool: 'network_icmp_probe', gain: 3 },
        { tool: 'network_traceroute', gain: 2 },
      ],
      idealTool: 'network_icmp_probe',
      tags: ['network'],
    },
    {
      id: 'reg-net-domain-lookup',
      title: 'resolve a hostname',
      query: 'look up the ip address for this domain name',
      topK: 10,
      expectations: [{ tool: 'dns_resolve', gain: 3 }],
      idealTool: 'dns_resolve',
      tags: ['network'],
    },
    {
      id: 'reg-net-ip-to-host',
      title: 'reverse dns',
      query: 'which hostname does this ip address belong to',
      topK: 10,
      expectations: [{ tool: 'dns_reverse', gain: 3 }],
      idealTool: 'dns_reverse',
      tags: ['network'],
    },
    {
      id: 'reg-net-record-query',
      title: 'structured dns record query',
      query: 'query the dns record types for this domain',
      topK: 10,
      expectations: [
        { tool: 'dns_probe', gain: 3 },
        { tool: 'dns_resolve', gain: 2 },
      ],
      idealTool: 'dns_probe',
      tags: ['network'],
    },
    {
      id: 'reg-net-alias-chain',
      title: 'follow cname aliases',
      query: 'trace the full cname alias chain for this domain',
      topK: 10,
      expectations: [{ tool: 'dns_cname_chain', gain: 3 }],
      idealTool: 'dns_cname_chain',
      tags: ['network'],
    },
    {
      id: 'reg-net-batch-lookup',
      title: 'bulk domain resolution',
      query: 'resolve this whole list of domains at once',
      topK: 10,
      expectations: [
        { tool: 'dns_bulk_resolve', gain: 3 },
        { tool: 'dns_resolve', gain: 2 },
      ],
      idealTool: 'dns_bulk_resolve',
      tags: ['network'],
    },
    {
      id: 'reg-net-find-credentials',
      title: 'pull tokens from traffic',
      query: 'find api keys and tokens in the captured requests',
      topK: 10,
      expectations: [{ tool: 'network_extract_auth', gain: 3 }],
      idealTool: 'network_extract_auth',
      tags: ['network'],
    },
    {
      id: 'reg-net-save-har',
      title: 'export capture as har',
      query: 'save the recorded traffic as a har file',
      topK: 10,
      expectations: [{ tool: 'network_export_har', gain: 3 }],
      idealTool: 'network_export_har',
      tags: ['network'],
    },
    {
      id: 'reg-net-resend-request',
      title: 'replay with modifications',
      query: 'resend that captured request but with a different header',
      topK: 10,
      expectations: [{ tool: 'network_replay_request', gain: 3 }],
      idealTool: 'network_replay_request',
      tags: ['network'],
    },
    {
      id: 'reg-net-block-mock',
      title: 'mock or block requests',
      query: 'block requests to this url and return a fake response instead',
      topK: 10,
      expectations: [{ tool: 'network_intercept', gain: 3 }],
      idealTool: 'network_intercept',
      tags: ['network'],
    },
    {
      id: 'reg-net-ja3-hash',
      title: 'tls client hello fingerprint',
      query: 'compute the ja3 and ja4 fingerprint of a tls handshake',
      topK: 10,
      expectations: [{ tool: 'network_tls_fingerprint', gain: 3 }],
      idealTool: 'network_tls_fingerprint',
      tags: ['network'],
    },
    {
      id: 'reg-net-bot-signals',
      title: 'anti-bot signal scoring',
      query: 'analyze whether this traffic looks like a bot',
      topK: 10,
      expectations: [{ tool: 'network_bot_detect_analyze', gain: 3 }],
      idealTool: 'network_bot_detect_analyze',
      tags: ['network'],
    },
  ],
};

// ── aggregated fixture ──

const BATCHES: readonly RegistryCoverageBatch[] = [networkBatch];

export function buildRegistryCoverageCases(): SearchEvalCase[] {
  return BATCHES.flatMap((b) => [...b.cases]);
}

/** Domains whose per-tool coverage has landed (for the scorecard/gates). */
export function registryCoverageDomains(): readonly string[] {
  return BATCHES.map((b) => b.domain);
}
