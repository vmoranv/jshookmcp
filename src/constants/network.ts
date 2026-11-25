/**
 * Network monitoring: HAR export, replay, ICMP probe, TLS fingerprinting, bot detection, DNS.
 * Prefixes: NETWORK_*, ICMP_*, PROTO_*, BOT_*, FETCH_*
 */

import { int, float } from './helpers.js';

/* ================================================================== */
/*  Network replay                                                     */
/* ================================================================== */

export const NETWORK_REPLAY_TIMEOUT_MS = int('NETWORK_REPLAY_TIMEOUT_MS', 30_000);
export const NETWORK_REPLAY_MAX_BODY_BYTES = int('NETWORK_REPLAY_MAX_BODY_BYTES', 512_000);
export const NETWORK_REPLAY_MAX_REDIRECTS = int('NETWORK_REPLAY_MAX_REDIRECTS', 5);
export const NETWORK_HAR_BODY_CONCURRENCY = int('NETWORK_HAR_BODY_CONCURRENCY', 4, { min: 1 });

/** Cap on bytes retained per HAR entry response body when includeBodies is true. */
export const NETWORK_HAR_BODY_MAX_BYTES = int('NETWORK_HAR_BODY_MAX_BYTES', 1 * 1024 * 1024);

/** Cap on the total retained payload bytes across messages parsed from one gRPC body. */
export const GRPC_MAX_TOTAL_PAYLOAD_BYTES = int('GRPC_MAX_TOTAL_PAYLOAD_BYTES', 1 * 1024 * 1024);

/** Cap on in-memory request/response records kept by the Playwright monitor. */
export const NETWORK_MAX_RECORDS = int('NETWORK_MAX_RECORDS', 500);

/**
 * Smart-handle threshold (bytes) for network_get_requests payloads: responses
 * larger than this are truncated to a summary + detailId. Kept lower than the
 * global DETAILED_DATA_SMART_THRESHOLD_BYTES (50 KB) because request listings
 * are LLM-facing and rarely need full fidelity.
 *
 * @env NETWORK_SMART_HANDLE_THRESHOLD_BYTES
 * @default 25600
 */
export const NETWORK_SMART_HANDLE_THRESHOLD_BYTES = int(
  'NETWORK_SMART_HANDLE_THRESHOLD_BYTES',
  25 * 1024,
);

/** Response-body cache budgets shared by CDP and Playwright monitors. */
export const NETWORK_BODY_CACHE_MAX_ENTRIES = int('NETWORK_BODY_CACHE_MAX_ENTRIES', 200);
export const NETWORK_BODY_CACHE_MAX_BODY_BYTES = int(
  'NETWORK_BODY_CACHE_MAX_BODY_BYTES',
  1024 * 1024,
);
export const NETWORK_BODY_CACHE_MAX_TOTAL_BYTES = int(
  'NETWORK_BODY_CACHE_MAX_TOTAL_BYTES',
  64 * 1024 * 1024,
);

/* ================================================================== */
/*  ICMP probe                                                         */
/* ================================================================== */

/** Default timeout for a single ICMP ping probe. */
export const ICMP_PROBE_TIMEOUT_MS = int('ICMP_PROBE_TIMEOUT_MS', 5_000);

/** Default max hops for traceroute. */
export const ICMP_TRACEROUTE_MAX_HOPS = int('ICMP_TRACEROUTE_MAX_HOPS', 30);

/** Default ICMP packet payload size in bytes. */
export const ICMP_DEFAULT_PACKET_SIZE = int('ICMP_DEFAULT_PACKET_SIZE', 32);

/** Default IP TTL used by ICMP echo probes when the caller does not override. */
export const ICMP_DEFAULT_TTL = int('ICMP_DEFAULT_TTL', 128);

/* ================================================================== */
/*  Protocol fingerprint detection                                     */
/* ================================================================== */

export const PROTO_TLS_MIN_RECORD_LEN = int('PROTO_TLS_MIN_RECORD_LEN', 4);
export const PROTO_TLS_CONFIDENCE = float('PROTO_TLS_CONFIDENCE', 0.95);
export const PROTO_WS_CONFIDENCE = float('PROTO_WS_CONFIDENCE', 0.85);
export const PROTO_HTTP_CONFIDENCE = float('PROTO_HTTP_CONFIDENCE', 0.95);
export const PROTO_SSH_CONFIDENCE = float('PROTO_SSH_CONFIDENCE', 0.95);
export const PROTO_MQTT_CONFIDENCE = float('PROTO_MQTT_CONFIDENCE', 0.85);
export const PROTO_STUN_CONFIDENCE = float('PROTO_STUN_CONFIDENCE', 0.92);
export const PROTO_QUIC_CONFIDENCE = float('PROTO_QUIC_CONFIDENCE', 0.88);
export const PROTO_SOCKS5_CONFIDENCE = float('PROTO_SOCKS5_CONFIDENCE', 0.9);
export const PROTO_H2_CONFIDENCE = float('PROTO_H2_CONFIDENCE', 0.9);
/** DNS header-shape heuristic (weaker than the exact-fingerprint protocols). */
export const PROTO_DNS_CONFIDENCE = float('PROTO_DNS_CONFIDENCE', 0.85);
/** Generic TLS record (complete record, not a ClientHello) fallback match. */
export const PROTO_TLS_RECORD_CONFIDENCE = float('PROTO_TLS_RECORD_CONFIDENCE', 0.9);
/** HTTP/2 connection preface (`PRI * HTTP/2.0`) magic fallback match. */
export const PROTO_H2_PRI_CONFIDENCE = float('PROTO_H2_PRI_CONFIDENCE', 0.9);

/* ================================================================== */
/*  Network bot detection                                              */
/* ================================================================== */

export const BOT_DETECT_LIMIT_DEFAULT = int('BOT_DETECT_LIMIT_DEFAULT', 50);
export const BOT_DETECT_LIMIT_MIN = int('BOT_DETECT_LIMIT_MIN', 1);
export const BOT_DETECT_LIMIT_MAX = int('BOT_DETECT_LIMIT_MAX', 500);

/* ================================================================== */
/*  HTTP Fetch                                                         */
/* ================================================================== */

export const FETCH_ABORT_TIMEOUT_MS = int('FETCH_ABORT_TIMEOUT_MS', 10_000);
