import { R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import type { NetworkHandlerDeps } from './shared';
import { parseBooleanArg, parseNumberArg } from './shared';
import { asOptionalString } from './network-types';
import { ToolError } from '@errors/ToolError';

export async function handleNetworkGetResponseBody(
  deps: NetworkHandlerDeps,
  args: Record<string, unknown>,
  ensureNetworkEnabled: (options: { autoEnable: boolean; enableExceptions: boolean }) => Promise<{
    enabled: boolean;
    autoEnabled: boolean;
    error?: string;
  }>,
): Promise<ToolResponse> {
  try {
    const requestId = asOptionalString(args.requestId) || '';
    const maxSize = parseNumberArg(args.maxSize, {
      defaultValue: 100000,
      min: 1024,
      max: 20 * 1024 * 1024,
      integer: true,
    });
    const returnSummary = parseBooleanArg(args.returnSummary, false);
    const retries = parseNumberArg(args.retries, {
      defaultValue: 3,
      min: 0,
      max: 10,
      integer: true,
    });
    const retryIntervalMs = parseNumberArg(args.retryIntervalMs, {
      defaultValue: 500,
      min: 50,
      max: 5000,
      integer: true,
    });
    const autoEnable = parseBooleanArg(args.autoEnable, false);
    const enableExceptions = parseBooleanArg(args.enableExceptions, true);

    if (!requestId) {
      return R.fail('requestId parameter is required')
        .set('hint', 'Get requestId from network_get_requests tool')
        .json();
    }

    const networkState = await ensureNetworkEnabled({
      autoEnable,
      enableExceptions,
    });

    if (!networkState.enabled) {
      return R.fail('Network monitoring is not enabled')
        .merge({
          hint: autoEnable
            ? 'Auto-enable failed. Check active page and call network_enable manually.'
            : 'Use network_enable tool first, or set autoEnable=true',
          detail: networkState.error,
        })
        .json();
    }

    let body: { body: string; base64Encoded: boolean } | null = null;
    let skippedReason: string | null = null;
    let unavailable: BodyUnavailable | null = null;
    let attemptsMade = 0;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      attemptsMade = attempt + 1;
      try {
        body = await deps.consoleMonitor.getResponseBody(requestId);
      } catch (error) {
        // Two non-retryable classes ride the same throw path: a body over the
        // single-body cap, and a body that cannot exist / is already gone.
        // Both used to burn retries*interval waiting for something that would
        // never arrive.
        const skip = getSkippedBodyReason(error);
        if (skip !== null) {
          skippedReason = skip;
          break;
        }
        unavailable = getBodyUnavailable(error, requestId);
        if (unavailable !== null) {
          break;
        }
        throw error;
      }
      if (body) {
        break;
      }
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
      }
    }

    if (skippedReason !== null) {
      return R.fail(`Response body skipped for requestId: ${requestId}`)
        .merge({
          skipped: true,
          reason: skippedReason,
          attempts: attemptsMade,
          hint:
            'The response body was not captured because its size exceeds the single-body cap. ' +
            'The request metadata is still available via network_get_requests.',
        })
        .json();
    }

    if (unavailable !== null) {
      // The reason is deterministic — retrying, or picking a different
      // requestId, cannot help. Say which one it was.
      return R.fail(`Response body unavailable for requestId: ${requestId}`)
        .merge({
          bodyUnavailable: true,
          reason: unavailable.reason,
          detail: unavailable.detail,
          attempts: attemptsMade,
          hint: BODY_UNAVAILABLE_HINTS[unavailable.reason],
        })
        .json();
    }

    if (!body) {
      // Only the genuinely transient case reaches here: the response has not
      // been received yet. This is the one message that SHOULD say "wait".
      return R.fail(`No response body found for requestId: ${requestId}`)
        .merge({
          hint:
            'The response for this requestId has not completed yet (or the request failed before ' +
            'responding). Re-check with network_get_requests, then retry with a larger retries value.',
          attempts: attemptsMade,
          waitedMs: retries * retryIntervalMs,
          retryConfig: { retries, retryIntervalMs },
        })
        .json();
    }

    return buildResponseBodyResult(requestId, body, attemptsMade, maxSize, returnSummary);
  } catch (error) {
    return R.fail(error).json();
  }
}

/**
 * Extracts the skip reason when a body fetch threw a `ToolError` carrying a
 * `details.skipped` marker (set by `NetworkMonitor.getResponseBody` when the
 * content-length exceeded the single-body cap). Returns `null` for any other
 * error so callers rethrow it unchanged.
 */
function getSkippedBodyReason(error: unknown): string | null {
  if (!(error instanceof ToolError)) return null;
  const details = error.details;
  if (!details || details.skipped !== true) return null;
  return typeof details.reason === 'string' ? details.reason : error.message;
}

/** A `details.bodyUnavailable` failure: the body cannot be read, at all. */
interface BodyUnavailable {
  reason: string;
  detail: string;
}

/**
 * What a `details.bodyUnavailable` throw means for the CALLER.
 *
 * Each hint names a different next action, because the four causes have
 * nothing in common: one is a capture-window problem, one is a status that
 * never has a body, one needs the cache disabled, one needs an earlier read.
 * The previous single hint ("may not have completed yet, or the requestId is
 * invalid") was wrong for every one of them and sent callers into a retry
 * loop that could not succeed.
 */
const BODY_UNAVAILABLE_HINTS: Record<string, string> = {
  request_evicted:
    'This request is no longer tracked by the monitor. Capture the body earlier in the session ' +
    '(call network_enable before navigating), or re-issue the request.',
  no_body_by_status:
    'This status code (1xx/204/304) never carries a body — there is nothing to read. Use the ' +
    'request metadata from network_get_requests instead.',
  from_cache:
    'Chrome served this response from cache or a service worker and did not keep the body. ' +
    'Re-run the request with caching disabled to capture it.',
  body_expired:
    'Chrome has already discarded this body. Read it right after the request completes, or ' +
    'enable auto-capture before navigating.',
};

function getBodyUnavailable(error: unknown, requestId: string): BodyUnavailable | null {
  if (!(error instanceof ToolError)) return null;
  const details = error.details;
  if (!details || details.bodyUnavailable !== true) return null;
  return {
    reason: typeof details.reason === 'string' ? details.reason : 'unknown',
    detail:
      typeof details.detail === 'string'
        ? details.detail
        : `Response body unavailable for requestId: ${requestId}`,
  };
}

function buildResponseBodyResult(
  requestId: string,
  body: { body: string; base64Encoded: boolean },
  attemptsMade: number,
  maxSize: number,
  returnSummary: boolean,
): ToolResponse {
  const originalSize = body.body.length;
  const isTooLarge = originalSize > maxSize;

  if (returnSummary || isTooLarge) {
    const preview = body.body.substring(0, 500);

    return R.ok()
      .merge({
        requestId,
        attempts: attemptsMade,
        summary: {
          size: originalSize,
          sizeKB: (originalSize / 1024).toFixed(2),
          base64Encoded: body.base64Encoded,
          preview: preview + (originalSize > 500 ? '...' : ''),
          truncated: isTooLarge,
          reason: isTooLarge
            ? `Response too large (${(originalSize / 1024).toFixed(2)} KB > ${(maxSize / 1024).toFixed(2)} KB)`
            : 'Summary mode enabled',
        },
        tip: isTooLarge
          ? 'Use collect_code tool to collect and compress this script, or increase maxSize parameter'
          : 'Set returnSummary=false to get full body',
      })
      .json();
  }

  return R.ok()
    .merge({
      requestId,
      attempts: attemptsMade,
      body: body.body,
      base64Encoded: body.base64Encoded,
      size: originalSize,
      sizeKB: (originalSize / 1024).toFixed(2),
    })
    .json();
}
