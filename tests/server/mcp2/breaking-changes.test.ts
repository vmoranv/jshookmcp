import { describe, expect, it } from 'vitest';
import {
  RESERVED_ENVELOPE_KEYS,
  LIFTED_RETRY_FIELDS,
  ERA_MISMATCH_ERROR_CODE,
  ERA_MISMATCHED_METHODS,
  SERVER_INFO_META_KEY,
  isReservedEnvelopeKey,
  isLiftedRetryField,
  stripReservedEnvelopeKeys,
  isLegalResultType,
  readServerInfoFromDiscover,
  CACHE_HINT_DEFAULTS,
  CACHEABLE_RESULT_METHODS,
  isCacheableResultMethod,
  INPUT_REQUEST_METHODS,
  INPUT_RESPONSE_KINDS,
  isInputRequestMethod,
  isInputResponseKind,
  inputRequestMethodToResponseKind,
  SERVER_NOTIFIER_METHODS,
  isServerNotifierShape,
  LEGACY_SHIM_FULL_HOSTS,
  LEGACY_SHIM_DEGRADED_HOSTS,
  isLegacyShimFullHost,
  isLegacyShimDegradedHost,
  LEGACY_SHIM_DEFAULTS,
  ERROR_CODE_MISSING_REQUIRED_CLIENT_CAPABILITY,
  ERROR_CODE_UNSUPPORTED_PROTOCOL_VERSION,
  httpStatusForErrorCode,
  MCP_NAME_REQUIRED_METHODS,
  TASKS_TASKID_MIRROR_METHODS,
  TASKS_PUSH_NOTIFICATION_METHOD,
  TASKS_PUSH_SUBSCRIPTION_FILTER,
  requiresMcpNameHeader,
  mirrorParamToMcpName,
  resolveCacheHint,
} from '@server/mcp2';

/**
 * Regression tests for the 6 breaking-change risks identified in
 * `spec-delta.md §5`. Each block pins a single risk so a future
 * refactor that silently re-introduces the broken behavior is caught.
 */

describe('BC#1 — resultType stripped from public Result types (handlers must not return it)', () => {
  it('"complete" is the consumed-and-stripped kind', () => {
    expect(isLegalResultType('complete')).toBe(true);
  });

  it('"input_required" is the auto-fulfilled kind', () => {
    expect(isLegalResultType('input_required')).toBe(true);
  });

  it('any non-legal kind rejects with SdkError(UnsupportedResultType)', () => {
    const illegals = [
      'error',
      'cancelled',
      'partial',
      'accepted',
      'rejected',
      'pending',
      '',
      'COMPLETE',
      'Input_Required',
    ];
    for (const kind of illegals) {
      expect(isLegalResultType(kind)).toBe(false);
    }
  });

  it('non-string kinds (number, object, null, undefined) reject', () => {
    expect(isLegalResultType(0)).toBe(false);
    expect(isLegalResultType({})).toBe(false);
    expect(isLegalResultType([])).toBe(false);
    expect(isLegalResultType(null)).toBe(false);
    expect(isLegalResultType(undefined)).toBe(false);
    expect(isLegalResultType(true)).toBe(false);
  });
});

describe('BC#2 — reserved envelope keys are lifted from params._meta before handlers run', () => {
  it('the four reserved keys are the canonical SDK list', () => {
    expect([...RESERVED_ENVELOPE_KEYS]).toEqual([
      'io.modelcontextprotocol/protocolVersion',
      'io.modelcontextprotocol/clientInfo',
      'io.modelcontextprotocol/clientCapabilities',
      'io.modelcontextprotocol/logLevel',
    ]);
  });

  it('serverInfo is NOT a reserved key (it is a response meta key, not a request envelope key)', () => {
    expect(isReservedEnvelopeKey(SERVER_INFO_META_KEY)).toBe(false);
  });

  it('stripReservedEnvelopeKeys drops the four reserved keys', () => {
    const before = {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1.0' },
      'io.modelcontextprotocol/clientCapabilities': { sampling: {}, elicitation: {} },
      'io.modelcontextprotocol/logLevel': 'debug',
      'app-specific-key': 'kept',
    };
    const after = stripReservedEnvelopeKeys(before);
    expect(Object.keys(after).toSorted()).toEqual(['app-specific-key']);
  });

  it('stripReservedEnvelopeKeys preserves unrelated keys in the same meta object', () => {
    const before = {
      'io.modelcontextprotocol/logLevel': 'info',
      'io.modelcontextprotocol/serverInfo': { name: 'jshookmcp' },
      'custom/tool-data': { x: 1 },
    };
    const after = stripReservedEnvelopeKeys(before);
    expect(after).toEqual({
      'io.modelcontextprotocol/serverInfo': { name: 'jshookmcp' },
      'custom/tool-data': { x: 1 },
    });
  });
});

describe('BC#3 — inputResponses / requestState lifted from top-level params (collision note)', () => {
  it('the two lifted retry fields are the canonical SDK list', () => {
    expect([...LIFTED_RETRY_FIELDS]).toEqual(['inputResponses', 'requestState']);
  });

  it('isLiftedRetryField is a tight guard for the two fields', () => {
    expect(isLiftedRetryField('inputResponses')).toBe(true);
    expect(isLiftedRetryField('requestState')).toBe(true);
    expect(isLiftedRetryField('name')).toBe(false);
    expect(isLiftedRetryField('uri')).toBe(false);
    expect(isLiftedRetryField('arguments')).toBe(false);
    expect(isLiftedRetryField('taskId')).toBe(false);
    expect(isLiftedRetryField('meta')).toBe(false);
  });
});

describe('BC#5 — MessageExtraInfo.classification mismatch rejects as -32022', () => {
  it('the era-mismatch error code is locked to -32022', () => {
    expect(ERA_MISMATCH_ERROR_CODE).toBe(-32022);
  });

  it('the era-mismatch error code matches the canonical SDK value', () => {
    expect(ERA_MISMATCH_ERROR_CODE).toBe(ERROR_CODE_UNSUPPORTED_PROTOCOL_VERSION);
  });

  it('the era-mismatch error maps to HTTP 400 (spec MUST)', () => {
    expect(httpStatusForErrorCode(ERA_MISMATCH_ERROR_CODE)).toBe(400);
  });
});

describe('BC#6 — era-mismatched outbound method throws MethodNotSupportedByProtocolVersion', () => {
  it('2026-only methods are pinned in ERA_MISMATCHED_METHODS.outboundFrom2025', () => {
    // Sending any of these toward a 2025 peer throws before reaching the
    // transport. Pinned against the module export (not a local literal) so
    // a vocabulary change fails here instead of silently drifting.
    expect([...ERA_MISMATCHED_METHODS.outboundFrom2025].toSorted()).toEqual(
      [
        'server/discover',
        'subscriptions/listen',
        'tasks/cancel',
        'tasks/get',
        'tasks/list',
        'tasks/result',
      ].toSorted(),
    );
  });

  it('tasks/* are 2026 extension methods — valid on a 2026 connection', () => {
    // The Tasks extension is 2026-only: every tasks method mismatches when
    // sent toward a 2025 peer, and none is era-mismatched toward a 2026
    // peer. The real tasks domain (TaskStoreAdapter) registers
    // get / list / result / cancel on the modern stack.
    for (const m of ['tasks/list', 'tasks/get', 'tasks/result', 'tasks/cancel'] as const) {
      expect(ERA_MISMATCHED_METHODS.outboundFrom2025).toContain(m);
      expect(ERA_MISMATCHED_METHODS.outboundFrom2026).not.toContain(m);
    }
    expect(ERA_MISMATCHED_METHODS.outboundFrom2026).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-cutting regression tests
// ─────────────────────────────────────────────────────────────────────────────

describe('regression — serverInfo placement is the only correct path on 2026-07-28', () => {
  it('reading discover.serverInfo returns the meta-keyed identity', () => {
    const identity = { name: 'jshookmcp', version: '1.0.0' };
    const discover = { _meta: { [SERVER_INFO_META_KEY]: identity } };
    expect(readServerInfoFromDiscover(discover)).toEqual(identity);
  });

  it('reading discover._meta key is the canonical path (matches SDK export)', () => {
    expect(SERVER_INFO_META_KEY).toBe('io.modelcontextprotocol/serverInfo');
  });
});

describe('regression — cache defaults are conservative on every endpoint', () => {
  it('default ttlMs is 0 (no caching) and cacheScope is "private" (no shared cache)', () => {
    expect(CACHE_HINT_DEFAULTS).toEqual({ ttlMs: 0, cacheScope: 'private' });
  });

  it('every cacheable method defaults to conservative when no hint is set', () => {
    for (const method of CACHEABLE_RESULT_METHODS) {
      const resolved = resolveCacheHint(method, undefined, undefined, undefined);
      expect(resolved).toEqual({ ttlMs: 0, cacheScope: 'private' });
    }
  });

  it('"server/discover" is a cacheable method (per spec §server/discover + changelog Minor #5)', () => {
    expect(isCacheableResultMethod('server/discover')).toBe(true);
  });
});

describe('regression — inputRequests supports all three request methods and four response kinds', () => {
  it('all three inputRequests methods are legal', () => {
    expect(isInputRequestMethod('elicitation/create')).toBe(true);
    expect(isInputRequestMethod('sampling/createMessage')).toBe(true);
    expect(isInputRequestMethod('roots/list')).toBe(true);
  });

  it('all four response kinds are legal', () => {
    expect(isInputResponseKind('elicit')).toBe(true);
    expect(isInputResponseKind('sampling')).toBe(true);
    expect(isInputResponseKind('roots')).toBe(true);
    expect(isInputResponseKind('missing')).toBe(true);
  });

  it('each method maps to its response kind (round-trip integrity)', () => {
    const methodToKind: Record<string, string> = {
      'elicitation/create': 'elicit',
      'sampling/createMessage': 'sampling',
      'roots/list': 'roots',
    };
    for (const [method, expectedKind] of Object.entries(methodToKind)) {
      expect(inputRequestMethodToResponseKind(method)).toBe(expectedKind);
    }
  });

  it('the canonical lists are stable (prevents silent reordering)', () => {
    expect([...INPUT_REQUEST_METHODS]).toEqual([
      'elicitation/create',
      'sampling/createMessage',
      'roots/list',
    ]);
    expect([...INPUT_RESPONSE_KINDS]).toEqual(['elicit', 'sampling', 'roots', 'missing']);
  });
});

describe('regression — handler.notify.* surface is complete and ordered', () => {
  it('all four notifier methods are present in canonical order', () => {
    expect([...SERVER_NOTIFIER_METHODS]).toEqual([
      'toolsChanged',
      'promptsChanged',
      'resourcesChanged',
      'resourceUpdated',
    ]);
  });

  it('a complete notifier is recognized as such', () => {
    expect(
      isServerNotifierShape({
        toolsChanged: () => undefined,
        promptsChanged: () => undefined,
        resourcesChanged: () => undefined,
        resourceUpdated: () => undefined,
      }),
    ).toBe(true);
  });

  it('a notifier missing resourceUpdated is NOT recognized', () => {
    expect(
      isServerNotifierShape({
        toolsChanged: () => undefined,
        promptsChanged: () => undefined,
        resourcesChanged: () => undefined,
      }),
    ).toBe(false);
  });
});

describe('regression — legacy shim full/degraded host partition', () => {
  it('stdio and sessionful streaming HTTP are the only fully-functional shim hosts', () => {
    expect([...LEGACY_SHIM_FULL_HOSTS].toSorted()).toEqual(['sessionful_streaming_http', 'stdio']);
  });

  it('stateless legacy HTTP and enableJsonResponse legacy are degraded', () => {
    expect([...LEGACY_SHIM_DEGRADED_HOSTS].toSorted()).toEqual([
      'enable_json_response_legacy',
      'stateless_legacy_http',
    ]);
  });

  it('host predicates partition the universe of legacy HTTP hosts', () => {
    const allHosts = [
      'stdio',
      'sessionful_streaming_http',
      'stateless_legacy_http',
      'enable_json_response_legacy',
    ];
    for (const host of allHosts) {
      const isFull = isLegacyShimFullHost(host);
      const isDegraded = isLegacyShimDegradedHost(host);
      // Each host is exactly one of: full or degraded (not both, not neither).
      expect(isFull !== isDegraded).toBe(true);
    }
  });

  it('shim defaults match the SDK (maxRounds: 8, roundTimeoutMs: 600_000, legacyShim: true)', () => {
    expect(LEGACY_SHIM_DEFAULTS).toEqual({
      maxRounds: 8,
      roundTimeoutMs: 600_000,
      legacyShim: true,
    });
  });
});

describe('regression — error code HTTP-status mapping is spec-MUST', () => {
  it('-32021 (post-dispatch capability) maps to HTTP 400', () => {
    expect(httpStatusForErrorCode(-32021)).toBe(400);
    expect(ERROR_CODE_MISSING_REQUIRED_CLIENT_CAPABILITY).toBe(-32021);
  });

  it('-32022 (era/version mismatch) maps to HTTP 400', () => {
    expect(httpStatusForErrorCode(-32022)).toBe(400);
    expect(ERROR_CODE_UNSUPPORTED_PROTOCOL_VERSION).toBe(-32022);
  });

  it('in-band JSON-RPC errors map to HTTP 200 (body is the error response)', () => {
    // Internal error (-32603) and parse error (-32700) are in-band.
    expect(httpStatusForErrorCode(-32603)).toBe(200);
    expect(httpStatusForErrorCode(-32700)).toBe(200);
    expect(httpStatusForErrorCode(-32601)).toBe(200); // Method not found
    expect(httpStatusForErrorCode(-32600)).toBe(200); // Invalid request
  });
});

describe('regression — SEP-2243 Mcp-Name requirement includes tasks/* methods', () => {
  it('all registered taskId-mirroring tasks methods require Mcp-Name', () => {
    // No tasks/update in this project — the tasks domain registers
    // get / list / result / cancel, and list takes a cursor not a taskId.
    expect(requiresMcpNameHeader('tasks/get')).toBe(true);
    expect(requiresMcpNameHeader('tasks/cancel')).toBe(true);
    expect(requiresMcpNameHeader('tasks/result')).toBe(true);
    expect(requiresMcpNameHeader('tasks/update')).toBe(false);
  });

  it('taskId is the mirrored value for all tasks/* methods', () => {
    for (const method of TASKS_TASKID_MIRROR_METHODS) {
      expect(mirrorParamToMcpName(method, { taskId: 't-1' })).toBe('t-1');
      expect(mirrorParamToMcpName(method, { other: 'x' })).toBeUndefined();
    }
  });

  it('the full set of Mcp-Name required methods is the union of standard + tasks', () => {
    const standard = ['tools/call', 'resources/read', 'prompts/get'];
    const all = new Set([...standard, ...TASKS_TASKID_MIRROR_METHODS]);
    for (const m of MCP_NAME_REQUIRED_METHODS) {
      expect(all.has(m)).toBe(true);
    }
  });

  it('the push notification method is "notifications/tasks" and the subscription filter is "tasks"', () => {
    expect(TASKS_PUSH_NOTIFICATION_METHOD).toBe('notifications/tasks');
    expect(TASKS_PUSH_SUBSCRIPTION_FILTER).toBe('tasks');
  });
});
