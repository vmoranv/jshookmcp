/**
 * GraphQL replay handler.
 *
 * Replays a GraphQL operation with optional variables via in-browser fetch
 * by default so the current page session is preserved. Callers can opt into
 * Node-side fetch with `useBrowser=false`.
 */

import type { CodeCollector } from '@server/domains/shared/modules';
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
import { argString, argObject, argBool } from '@server/domains/shared/parse-args';
import { evaluateWithTimeout } from '@modules/collector/PageController';

export class ReplayHandlers {
  constructor(private collector: CodeCollector) {}

  async handleGraphqlReplay(args: Record<string, unknown>) {
    try {
      const endpoint = argString(args, 'endpoint')?.trim();
      const query = argString(args, 'query');

      if (!endpoint) {
        return toError('Missing required argument: endpoint');
      }

      if (typeof query !== 'string' || query.trim().length === 0) {
        return toError('Missing required argument: query');
      }

      const variables = argObject(args, 'variables') ?? {};
      const operationNameRaw = argString(args, 'operationName');
      const operationName =
        operationNameRaw && operationNameRaw.trim().length > 0 ? operationNameRaw.trim() : null;
      const headers = normalizeHeaders(args.headers);
      const useBrowser = argBool(args, 'useBrowser', true);

      if (useBrowser) {
        const page = await this.collector.getActivePage();
        const currentPageUrl = typeof page.url === 'function' ? page.url() : null;
        const endpointValidationError = await validateBrowserEndpoint(endpoint, currentPageUrl);
        if (endpointValidationError) {
          return toError(endpointValidationError);
        }

        return await this.replayViaBrowser(
          page,
          endpoint,
          query,
          variables,
          operationName,
          headers,
        );
      }

      const endpointValidationError = await validateExternalEndpoint(endpoint);
      if (endpointValidationError) {
        return toError(endpointValidationError);
      }

      return await this.replayViaNode(endpoint, query, variables, operationName, headers);
    } catch (error) {
      return toError(error);
    }
  }

  private async replayViaNode(
    endpoint: string,
    query: string,
    variables: Record<string, unknown>,
    operationName: string | null,
    headers: Record<string, string>,
  ) {
    const requestHeaders: Record<string, string> = {
      'content-type': 'application/json',
      ...headers,
    };

    let response: Response;
    let responseText: string;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 10_000);
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify({ query, variables, operationName }),
          signal: ac.signal,
        });
        responseText = await response.text();
      } finally {
        clearTimeout(t);
      }
    } catch (error) {
      return toResponse({
        success: false,
        endpoint,
        status: 0,
        statusText: 'FETCH_ERROR',
        error: error instanceof Error ? error.message : String(error),
        operationName,
      });
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let responseJson: unknown = null;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }

    // Release raw text after parsing
    responseText = '';

    return toResponse(
      buildReplayPayloadFromJson(
        responseJson,
        endpoint,
        operationName,
        response.ok,
        response.status,
        response.statusText,
        responseHeaders,
      ),
    );
  }

  private async replayViaBrowser(
    page: Awaited<ReturnType<CodeCollector['getActivePage']>>,
    endpoint: string,
    query: string,
    variables: Record<string, unknown>,
    operationName: string | null,
    headers: Record<string, string>,
  ) {
    const browserResult = (await evaluateWithTimeout(
      page,
      async (input: {
        endpoint: string;
        query: string;
        variables: Record<string, unknown>;
        operationName: string | null;
        headers: Record<string, string>;
      }): Promise<BrowserFetchResult> => {
        const requestHeaders: Record<string, string> = {
          'content-type': 'application/json',
          ...input.headers,
        };

        try {
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 10000);
          let responseText: string;
          let response: Response;
          try {
            response = await fetch(input.endpoint, {
              method: 'POST',
              headers: requestHeaders,
              body: JSON.stringify({
                query: input.query,
                variables: input.variables,
                operationName: input.operationName,
              }),
              signal: ac.signal,
            });
            responseText = await response.text();
          } finally {
            clearTimeout(t);
          }

          let responseJson: unknown = null;
          try {
            responseJson = JSON.parse(responseText);
          } catch {
            responseJson = null;
          }

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
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      { endpoint, query, variables, operationName, headers },
    )) as BrowserFetchResult;

    const payload: Record<string, unknown> = {
      success: browserResult.ok,
      endpoint,
      status: browserResult.status,
      statusText: browserResult.statusText,
      operationName,
      responseHeaders: browserResult.responseHeaders ?? {},
    };

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
  operationName: string | null,
  ok: boolean,
  status: number,
  statusText: string,
  responseHeaders: Record<string, string>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    success: ok,
    endpoint,
    status,
    statusText,
    operationName,
    responseHeaders,
  };

  if (responseJson !== null) {
    const responsePreview = serializeForPreview(responseJson, GRAPHQL_MAX_SCHEMA_CHARS);

    payload.responseLength = responsePreview.totalLength;
    payload.responsePreview = responsePreview.preview;
    payload.responseTruncated = responsePreview.truncated;

    if (!responsePreview.truncated) {
      payload.response = responseJson;
    }
  }

  return payload;
}
