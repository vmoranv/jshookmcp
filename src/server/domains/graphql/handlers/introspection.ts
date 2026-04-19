/**
 * GraphQL introspection handler.
 *
 * Runs a GraphQL introspection query against a target endpoint.
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
import {
  GRAPHQL_MAX_PREVIEW_CHARS,
  GRAPHQL_MAX_SCHEMA_CHARS,
  INTROSPECTION_QUERY,
} from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import type { BrowserFetchResult } from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import { argString } from '@server/domains/shared/parse-args';
import { evaluateWithTimeout } from '@modules/collector/PageController';

export class IntrospectionHandlers {
  constructor(private collector: CodeCollector) {}

  async handleGraphqlIntrospect(args: Record<string, unknown>) {
    try {
      const endpoint = argString(args, 'endpoint')?.trim();
      if (!endpoint) {
        return toError('Missing required argument: endpoint');
      }

      const endpointValidationError = await validateExternalEndpoint(endpoint);
      if (endpointValidationError) {
        return toError(endpointValidationError);
      }

      const headers = normalizeHeaders(args.headers);

      const page = await this.collector.getActivePage();

      const browserResult = (await evaluateWithTimeout(
        page,
        async (input: {
          endpoint: string;
          headers: Record<string, string>;
          query: string;
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
                  operationName: 'IntrospectionQuery',
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
        { endpoint, headers, query: INTROSPECTION_QUERY },
      )) as BrowserFetchResult;

      if (!browserResult.ok && !browserResult.responseJson) {
        return toResponse({
          success: false,
          endpoint,
          status: browserResult.status,
          statusText: browserResult.statusText,
          error: browserResult.error ?? 'Introspection request failed',
          responsePreview: createPreview(
            browserResult.responseText || '',
            GRAPHQL_MAX_PREVIEW_CHARS,
          ),
        });
      }

      const jsonRecord =
        browserResult.responseJson && typeof browserResult.responseJson === 'object'
          ? (browserResult.responseJson as Record<string, unknown>)
          : null;

      const schemaPayload =
        jsonRecord && 'data' in jsonRecord
          ? jsonRecord.data
          : (browserResult.responseJson ?? browserResult.responseText);

      const schemaPreview = serializeForPreview(schemaPayload, GRAPHQL_MAX_SCHEMA_CHARS);

      const payload: Record<string, unknown> = {
        success: browserResult.ok,
        endpoint,
        status: browserResult.status,
        statusText: browserResult.statusText,
        schemaLength: schemaPreview.totalLength,
        schemaPreview: schemaPreview.preview,
        schemaTruncated: schemaPreview.truncated,
        responseHeaders: browserResult.responseHeaders ?? {},
      };

      if (!schemaPreview.truncated) {
        payload.schema = schemaPayload;
      }

      if (jsonRecord && Array.isArray(jsonRecord.errors)) {
        payload.errors = jsonRecord.errors;
      }

      if (browserResult.error) {
        payload.error = browserResult.error;
      }

      return toResponse(payload);
    } catch (error) {
      return toError(error);
    }
  }
}
