/**
 * GraphQL replay handler.
 *
 * Replays a GraphQL operation with optional variables via in-page fetch.
 */

import type { CodeCollector } from '@server/domains/shared/modules';
import {
  toResponse,
  toError,
  normalizeHeaders,
  validateExternalEndpoint,
  createPreview,
  serializeForPreview,
} from '@server/domains/graphql/handlers/shared';
import { GRAPHQL_MAX_SCHEMA_CHARS } from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import type { BrowserFetchResult } from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import { argString, argObject } from '@server/domains/shared/parse-args';
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

      const endpointValidationError = await validateExternalEndpoint(endpoint);
      if (endpointValidationError) {
        return toError(endpointValidationError);
      }

      const variables = argObject(args, 'variables') ?? {};
      const operationNameRaw = argString(args, 'operationName');
      const operationName =
        operationNameRaw && operationNameRaw.trim().length > 0 ? operationNameRaw.trim() : null;
      const headers = normalizeHeaders(args.headers);

      const page = await this.collector.getActivePage();

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

            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => {
              responseHeaders[key] = value;
            });

            return {
              ok: response.ok,
              status: response.status,
              statusText: response.statusText,
              responseText,
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

      const payload = buildReplayPayload(browserResult, endpoint, operationName);
      return toResponse(payload);
    } catch (error) {
      return toError(error);
    }
  }
}

function buildReplayPayload(
  browserResult: BrowserFetchResult,
  endpoint: string,
  operationName: string | null,
): Record<string, unknown> {
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
  } else {
    const textPreview = createPreview(browserResult.responseText ?? '', GRAPHQL_MAX_SCHEMA_CHARS);

    payload.responseLength = textPreview.totalLength;
    payload.responsePreview = textPreview.preview;
    payload.responseTruncated = textPreview.truncated;
    payload.responseFormat = 'text';
  }

  if (browserResult.error) {
    payload.error = browserResult.error;
  }

  return payload;
}
