/**
 * MCP 2.0 runtime contract guard.
 *
 * The `src/server/mcp2/*` modules pin the 2026-07-28 spec vocabulary (error
 * codes, `serverInfo` meta key, cache defaults, notifier shape, ...) so the
 * era-matrix tests can assert our understanding. Those constants are only
 * useful at runtime if they still match the installed SDK — a silent SDK
 * renumber would otherwise leave the pins (and every hardcoded literal that
 * now imports them) stale.
 *
 * This module is the production bridge between the spec-pins and the running
 * server: it compares our pinned values against the SDK's own exports and
 * reports drift through the logger. It is invoked once when the modern
 * `/mcp/v2` handler is first constructed (see MCPServer.transport.ts), so a
 * mismatched SDK is loud at startup instead of surfacing as broken wire
 * behavior on some later tool call.
 *
 * Keep this a leaf: importing it must not pull the whole server graph.
 */
import {
  ProtocolErrorCode,
  SERVER_INFO_META_KEY as SDK_SERVER_INFO_META_KEY,
} from '@modelcontextprotocol/server';
import { logger } from '@utils/logger';
import {
  ERROR_CODE_MISSING_REQUIRED_CLIENT_CAPABILITY,
  ERROR_CODE_UNSUPPORTED_PROTOCOL_VERSION,
  ERROR_CODE_RESOURCE_NOT_FOUND,
  ERROR_CODE_URL_ELICITATION_REQUIRED,
  httpStatusForErrorCode,
} from '@server/mcp2/error-codes';
import { SERVER_INFO_META_KEY } from '@server/mcp2/server-info-meta';
import { CACHE_HINT_DEFAULTS, isCacheableResultMethod } from '@server/mcp2/cache-defaults';
import { isLegalResultType, stripReservedEnvelopeKeys } from '@server/mcp2/breaking-changes';
import { isInputRequestMethod, isInputResponseKind } from '@server/mcp2/input-requests';
import { isLegacyShimFullHost, isLegacyShimDegradedHost } from '@server/mcp2/legacy-shim';
import { isServerNotifierShape } from '@server/mcp2/notifier-shape';
import { requiresMcpNameHeader, mirrorParamToMcpName } from '@server/mcp2/tasks-mcp-name';

/** A single pinned value vs the SDK's authoritative value. */
interface PinnedCheck {
  readonly label: string;
  readonly pinned: number | string;
  readonly sdk: number | string | undefined;
}

function pinnedChecks(): PinnedCheck[] {
  return [
    {
      label: 'MissingRequiredClientCapability',
      pinned: ERROR_CODE_MISSING_REQUIRED_CLIENT_CAPABILITY,
      sdk: ProtocolErrorCode.MissingRequiredClientCapability,
    },
    {
      label: 'UnsupportedProtocolVersion',
      pinned: ERROR_CODE_UNSUPPORTED_PROTOCOL_VERSION,
      sdk: ProtocolErrorCode.UnsupportedProtocolVersion,
    },
    {
      label: 'ResourceNotFound',
      pinned: ERROR_CODE_RESOURCE_NOT_FOUND,
      sdk: ProtocolErrorCode.ResourceNotFound,
    },
    {
      label: 'UrlElicitationRequired',
      pinned: ERROR_CODE_URL_ELICITATION_REQUIRED,
      sdk: ProtocolErrorCode.UrlElicitationRequired,
    },
    {
      label: 'serverInfo meta key',
      pinned: SERVER_INFO_META_KEY,
      sdk: SDK_SERVER_INFO_META_KEY,
    },
    {
      label: 'cache hint ttlMs default',
      pinned: CACHE_HINT_DEFAULTS.ttlMs,
      sdk: 0,
    },
    {
      label: 'cache hint cacheScope default',
      pinned: CACHE_HINT_DEFAULTS.cacheScope,
      sdk: 'private',
    },
  ];
}

/**
 * Verify the pinned spec vocabulary against the installed SDK and exercise the
 * pure predicates (so a predicate that accidentally stops classifying its own
 * canonical inputs is caught). Returns the list of drift descriptions; the
 * caller decides how loudly to report them.
 */
export function findMcp2ContractDrift(): string[] {
  const drift: string[] = [];
  for (const check of pinnedChecks()) {
    if (check.sdk === undefined) {
      drift.push(`${check.label}: SDK export missing (pinned ${String(check.pinned)})`);
    } else if (check.pinned !== check.sdk) {
      drift.push(`${check.label}: pinned ${String(check.pinned)} != SDK ${String(check.sdk)}`);
    }
  }

  // Predicate self-checks against canonical inputs from the same vocabulary.
  // These guard against a refactor breaking a classifier while its constant
  // table stays intact — exactly the regression the mcp2 tests pin.
  const predicateChecks: ReadonlyArray<readonly [string, boolean]> = [
    ['isCacheableResultMethod(tools/list)', isCacheableResultMethod('tools/list')],
    ['isLegalResultType(input_required)', isLegalResultType('input_required')],
    ['isInputRequestMethod(elicitation/create)', isInputRequestMethod('elicitation/create')],
    ['isInputResponseKind(roots)', isInputResponseKind('roots')],
    ['isLegacyShimFullHost(stdio)', isLegacyShimFullHost('stdio')],
    [
      'isLegacyShimDegradedHost(stateless_legacy_http)',
      isLegacyShimDegradedHost('stateless_legacy_http'),
    ],
    ['requiresMcpNameHeader(tools/call)', requiresMcpNameHeader('tools/call')],
    [
      'mirrorParamToMcpName(tasks/get)',
      mirrorParamToMcpName('tasks/get', { taskId: 't1' }) === 't1',
    ],
    [
      'isServerNotifierShape(full)',
      isServerNotifierShape({
        toolsChanged: () => undefined,
        promptsChanged: () => undefined,
        resourcesChanged: () => undefined,
        resourceUpdated: () => undefined,
      }),
    ],
    ['httpStatusForErrorCode(-32022)', httpStatusForErrorCode(-32022) === 400],
    [
      'stripReservedEnvelopeKeys',
      !(
        'io.modelcontextprotocol/protocolVersion' in
        stripReservedEnvelopeKeys({
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          keep: 1,
        })
      ),
    ],
  ];
  for (const [label, ok] of predicateChecks) {
    if (!ok) drift.push(`predicate self-check failed: ${label}`);
  }

  return drift;
}

/** Log any spec drift. Called once from the modern HTTP entry. */
export function assertMcp2Contract(): void {
  const drift = findMcp2ContractDrift();
  if (drift.length > 0) {
    logger.warn('[mcp2] spec/SDK contract drift detected:', drift.join('; '));
  } else {
    logger.info('[mcp2] spec/SDK contract verified');
  }
}
