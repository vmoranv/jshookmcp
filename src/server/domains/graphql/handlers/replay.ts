/**
 * GraphQL replay handler.
 *
 * Replays a GraphQL operation with optional variables via in-browser fetch
 * by default so the current page session is preserved. Callers can opt into
 * Node-side Fetch with `useBrowser=false`.
 *
 * Supports:
 * - Single operation (default): `{ query, variables, operationName }`.
 * - Batch replay: `batch: [{ query, variables?, operationName? }, ...]` → the
 *   body becomes a JSON array and the server response is an array.
 * - Apollo persisted-query (APQ): `persistedQuery: { sha256Hash, version? }`
 *   adds `extensions.persistedQuery` to each operation body so traffic using
 *   APQ / Relay_preload is faithfully replayed.
 */

import type { CodeCollector } from '@server/domains/shared/modules/collector';
import {
  toResponse,
  toError,
  normalizeHeaders,
  validateBrowserEndpoint,
  validateExternalEndpoint,
  serializeForPreview,
} from '@server/domains/graphql/handlers/shared';
import { GRAPHQL_MAX_SCHEMA_CHARS } from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import type { BrowserFetchResult } from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import { argString, argObject, argBool, argArray } from '@server/domains/shared/parse-args';
import { GRAPHQL_REPLAY_FETCH_TIMEOUT_MS } from '@src/constants/analysis';
import { evaluateWithTimeout } from '@modules/collector/PageController';
import { fetchWithTimeout } from '@utils/network/fetch';

interface PersistedQuery {
  sha256Hash: string;
  version: number;
}

interface BatchOperation {
  query: string;
  variables: Record<string, unknown>;
  operationName: string | null;
}

interface ReplayMeta {
  mode: 'single' | 'batch';
  operationName: string | null;
  batchSize: number;
}

interface ReplayFetchInput {
  endpoint: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

/**
 * Self-contained GraphQL replay fetch pipeline: fetch POST with abort
 * timeout, JSON parse, raw-text retention for non-JSON replies, and header
 * collection. Deliberately references NO module scope so Playwright can
 * serialize the function itself — the same code runs in-page (browser path,
 * via evaluateWithTimeout) and in-process with the global fetch (Node path),
 * so both paths share one implementation.
 */
async function replayFetchPipeline(input: ReplayFetchInput): Promise<BrowserFetchResult> {
  const requestHeaders = { 'content-type': 'application/json', ...input.headers };
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), input.timeoutMs);
    let responseText;
    let response;
    try {
      response = await fetch(input.endpoint, {
        method: 'POST',
        headers: requestHeaders,
        body: input.body,
        signal: ac.signal,
      });
      responseText = await response.text();
    } finally {
      clearTimeout(t);
    }

    let responseJson = null;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }

    // Keep the raw text when the body was not JSON — it is the only
    // diagnostic for non-JSON replies (HTML error pages, plain-text errors).
    const rawText = responseJson === null ? responseText : '';
    responseText = '';

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      responseText: rawText,
      responseJson,
      responseHeaders,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: 'FETCH_ERROR',
      responseText: '',
      responseJson: null,
      responseHeaders: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Node-side replay fetch: the in-process equivalent of the in-page
 * `REPLAY_FETCH_PIPELINE` above, sharing the same `BrowserFetchResult` shape but
 * using the unified `fetchWithTimeout` helper for timeout + error normalization.
 */
async function replayFetchViaNode(input: ReplayFetchInput): Promise<BrowserFetchResult> {
  const requestHeaders = { 'content-type': 'application/json', ...input.headers };
  try {
    const response = await fetchWithTimeout(
      input.endpoint,
      {
        method: 'POST',
        headers: requestHeaders,
        body: input.body,
      },
      input.timeoutMs,
    );
    const responseText = await response.text();

    let responseJson: unknown = null;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }

    const rawText = responseJson === null ? responseText : '';
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      responseText: rawText,
      responseJson,
      responseHeaders,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: 'FETCH_ERROR',
      responseText: '',
      responseJson: null,
      responseHeaders: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizePersistedQuery(raw: Record<string, unknown> | undefined): PersistedQuery | null {
  if (!raw) return null;
  const hash = raw.sha256Hash;
  if (typeof hash !== 'string' || hash.trim().length === 0) return null;
  const versionRaw = raw.version;
  const version =
    typeof versionRaw === 'number' && Number.isFinite(versionRaw) ? Math.trunc(versionRaw) : 1;
  return { sha256Hash: hash, version: version < 1 ? 1 : version };
}

function normalizeBatch(
  raw: unknown[] | undefined,
): BatchOperation[] | { error: string } | undefined {
  if (!raw || raw.length === 0) return undefined;
  const ops: BatchOperation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { error: 'batch items must be objects' };
    }
    const rec = item as Record<string, unknown>;
    const q = rec.query;
    if (typeof q !== 'string' || q.trim().length === 0) {
      return { error: 'Each batch item requires a non-empty query string' };
    }
    const variablesRaw = rec.variables;
    const variables =
      variablesRaw && typeof variablesRaw === 'object' && !Array.isArray(variablesRaw)
        ? (variablesRaw as Record<string, unknown>)
        : {};
    const opNameRaw = rec.operationName;
    const operationName =
      typeof opNameRaw === 'string' && opNameRaw.trim().length > 0 ? opNameRaw.trim() : null;
    ops.push({ query: q, variables, operationName });
  }
  return ops;
}

/** Build the JSON request body string for single or batch mode, with optional APQ. */
function buildReplayBody(
  query: string | null,
  variables: Record<string, unknown>,
  operationName: string | null,
  batch: BatchOperation[] | undefined,
  persistedQuery: PersistedQuery | null,
): string {
  const apqExtension = persistedQuery
    ? {
        extensions: {
          persistedQuery: {
            sha256Hash: persistedQuery.sha256Hash,
            version: persistedQuery.version,
          },
        },
      }
    : {};

  if (batch && batch.length > 0) {
    return JSON.stringify(
      batch.map((op) => ({
        query: op.query,
        variables: op.variables,
        operationName: op.operationName,
        ...apqExtension,
      })),
    );
  }

  return JSON.stringify({
    query,
    variables,
    operationName,
    ...apqExtension,
  });
}

/** Extract a structured `errors[]` from a standard GraphQL single-op response. */
function extractGraphqlErrors(responseJson: unknown): {
  graphqlErrors: unknown[] | null;
  hasGraphqlErrors: boolean;
} {
  if (responseJson && typeof responseJson === 'object' && !Array.isArray(responseJson)) {
    const errors = (responseJson as Record<string, unknown>).errors;
    if (Array.isArray(errors)) {
      return { graphqlErrors: errors, hasGraphqlErrors: errors.length > 0 };
    }
  }
  return { graphqlErrors: null, hasGraphqlErrors: false };
}

export class ReplayHandlers {
  private collector: CodeCollector;
  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  async handleGraphqlReplay(args: Record<string, unknown>) {
    try {
      const endpoint = argString(args, 'endpoint')?.trim();

      if (!endpoint) {
        return toError('Missing required argument: endpoint');
      }

      const queryRaw = argString(args, 'query');
      const query = typeof queryRaw === 'string' ? queryRaw.trim() : '';
      const variables = argObject(args, 'variables') ?? {};
      const operationNameRaw = argString(args, 'operationName');
      const operationName =
        operationNameRaw && operationNameRaw.trim().length > 0 ? operationNameRaw.trim() : null;
      const headers = normalizeHeaders(args.headers);
      const useBrowser = argBool(args, 'useBrowser', true);

      const persistedQuery = normalizePersistedQuery(argObject(args, 'persistedQuery'));
      const batchResult = normalizeBatch(argArray(args, 'batch'));
      if (batchResult && !Array.isArray(batchResult)) {
        return toError((batchResult as { error: string }).error);
      }
      const batch = batchResult as BatchOperation[] | undefined;

      // query is required for single mode; batch mode supplies its own queries.
      if (!batch && query.length === 0) {
        return toError('Missing required argument: query (or provide a non-empty batch)');
      }

      const body = buildReplayBody(
        batch ? null : query,
        variables,
        operationName,
        batch,
        persistedQuery,
      );

      const meta: ReplayMeta = {
        mode: batch ? 'batch' : 'single',
        operationName: batch ? null : operationName,
        batchSize: batch?.length ?? 0,
      };

      if (useBrowser) {
        const page = await this.collector.getActivePage();
        const currentPageUrl = typeof page.url === 'function' ? page.url() : null;
        const endpointValidationError = await validateBrowserEndpoint(endpoint, currentPageUrl);
        if (endpointValidationError) {
          return toError(endpointValidationError);
        }

        return await this.replayViaBrowser(page, endpoint, body, headers, meta);
      }

      const endpointValidationError = await validateExternalEndpoint(endpoint);
      if (endpointValidationError) {
        return toError(endpointValidationError);
      }

      return await this.replayViaNode(endpoint, body, headers, meta);
    } catch (error) {
      return toError(error);
    }
  }

  private async replayViaNode(
    endpoint: string,
    body: string,
    headers: Record<string, string>,
    meta: ReplayMeta,
  ) {
    const result = await replayFetchViaNode({
      endpoint,
      body,
      headers,
      timeoutMs: GRAPHQL_REPLAY_FETCH_TIMEOUT_MS,
    });

    const payload: Record<string, unknown> = {
      ...buildReplayPayloadFromJson(
        result.responseJson ?? null,
        endpoint,
        result.ok,
        result.status,
        result.statusText,
        result.responseHeaders ?? {},
        meta,
        result.responseText ?? '',
      ),
    };
    if (result.error) {
      payload.error = result.error;
    }
    return toResponse(payload);
  }

  private async replayViaBrowser(
    page: Awaited<ReturnType<CodeCollector['getActivePage']>>,
    endpoint: string,
    body: string,
    headers: Record<string, string>,
    meta: ReplayMeta,
  ) {
    const browserResult = (await evaluateWithTimeout(page, replayFetchPipeline, {
      endpoint,
      body,
      headers,
      timeoutMs: GRAPHQL_REPLAY_FETCH_TIMEOUT_MS,
    })) as BrowserFetchResult;

    const payload: Record<string, unknown> = {
      success: browserResult.ok,
      endpoint,
      status: browserResult.status,
      statusText: browserResult.statusText,
      mode: meta.mode,
      responseHeaders: browserResult.responseHeaders ?? {},
    };

    if (meta.mode === 'single') {
      payload.operationName = meta.operationName;
    } else {
      payload.batchSize = meta.batchSize;
    }

    if (browserResult.responseJson !== null) {
      const responsePreview = serializeForPreview(
        browserResult.responseJson,
        GRAPHQL_MAX_SCHEMA_CHARS,
      );

      payload.responseLength = responsePreview.totalLength;
      payload.responsePreview = responsePreview.preview;
      payload.responseTruncated = responsePreview.truncated;

      if (!responsePreview.truncated) {
        payload.response = browserResult.responseJson;
      }

      // Structured GraphQL errors (single-mode responses only; batch responses
      // are arrays the caller inspects per-item).
      if (meta.mode === 'single') {
        const { graphqlErrors, hasGraphqlErrors } = extractGraphqlErrors(
          browserResult.responseJson,
        );
        if (graphqlErrors !== null) {
          payload.graphqlErrors = graphqlErrors;
          payload.hasGraphqlErrors = hasGraphqlErrors;
        }
      }
    } else if (browserResult.responseText) {
      const text = browserResult.responseText;
      payload.responseFormat = 'text';
      payload.responseLength = text.length;
      payload.responsePreview =
        text.length > GRAPHQL_MAX_SCHEMA_CHARS ? text.slice(0, GRAPHQL_MAX_SCHEMA_CHARS) : text;
      payload.responseTruncated = text.length > GRAPHQL_MAX_SCHEMA_CHARS;
    }

    if (browserResult.error) {
      payload.error = browserResult.error;
    }

    return toResponse(payload);
  }
}

function buildReplayPayloadFromJson(
  responseJson: unknown,
  endpoint: string,
  ok: boolean,
  status: number,
  statusText: string,
  responseHeaders: Record<string, string>,
  meta: ReplayMeta,
  rawText?: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    success: ok,
    endpoint,
    status,
    statusText,
    mode: meta.mode,
    responseHeaders,
  };

  if (meta.mode === 'single') {
    payload.operationName = meta.operationName;
  } else {
    payload.batchSize = meta.batchSize;
  }

  if (responseJson !== null) {
    const responsePreview = serializeForPreview(responseJson, GRAPHQL_MAX_SCHEMA_CHARS);

    payload.responseLength = responsePreview.totalLength;
    payload.responsePreview = responsePreview.preview;
    payload.responseTruncated = responsePreview.truncated;

    if (!responsePreview.truncated) {
      payload.response = responseJson;
    }

    if (meta.mode === 'single') {
      const { graphqlErrors, hasGraphqlErrors } = extractGraphqlErrors(responseJson);
      if (graphqlErrors !== null) {
        payload.graphqlErrors = graphqlErrors;
        payload.hasGraphqlErrors = hasGraphqlErrors;
      }
    }
  } else if (rawText) {
    // Non-JSON body: surface the raw text instead of dropping it (regression:
    // the Node path cleared responseText after a failed parse, losing the only
    // diagnostic content for non-JSON replies).
    payload.responseFormat = 'text';
    payload.responseLength = rawText.length;
    payload.responsePreview =
      rawText.length > GRAPHQL_MAX_SCHEMA_CHARS
        ? rawText.slice(0, GRAPHQL_MAX_SCHEMA_CHARS)
        : rawText;
    payload.responseTruncated = rawText.length > GRAPHQL_MAX_SCHEMA_CHARS;
  }

  return payload;
}
