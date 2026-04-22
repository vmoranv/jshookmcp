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
          maxSchemaChars: number;
        }): Promise<{
          ok: boolean;
          status: number;
          statusText: string;
          responseHeaders: Record<string, string>;
          totalLength: number;
          preview: string;
          truncated: boolean;
          json: unknown;
          error?: string;
        }> => {
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

            const responseHeaders: Record<string, string> = {};
            response.headers.forEach((value, key) => {
              responseHeaders[key] = value;
            });

            const totalLength = responseText.length;
            const truncated = totalLength > input.maxSchemaChars;
            const preview = truncated
              ? `${responseText.slice(0, input.maxSchemaChars)}\n... (truncated)`
              : responseText;

            let json: unknown = null;
            try {
              json = JSON.parse(responseText);
            } catch {
              // not JSON — json stays null
            }

            return {
              ok: response.ok,
              status: response.status,
              statusText: response.statusText,
              responseHeaders,
              totalLength,
              preview,
              truncated,
              json,
            };
          } catch (error) {
            return {
              ok: false,
              status: 0,
              statusText: 'FETCH_ERROR',
              responseHeaders: {},
              totalLength: 0,
              preview: '',
              truncated: false,
              json: null,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
        { endpoint, headers, query: INTROSPECTION_QUERY, maxSchemaChars: GRAPHQL_MAX_SCHEMA_CHARS },
      )) as BrowserFetchResult;

      if (!browserResult.ok && !browserResult.json) {
        return toResponse({
          success: false,
          endpoint,
          status: browserResult.status,
          statusText: browserResult.statusText,
          error: browserResult.error ?? 'Introspection request failed',
          responsePreview: createPreview(browserResult.preview || '', GRAPHQL_MAX_PREVIEW_CHARS),
        });
      }

      const jsonRecord =
        browserResult.json && typeof browserResult.json === 'object'
          ? (browserResult.json as Record<string, unknown>)
          : null;

      const schemaPayload =
        jsonRecord && 'data' in jsonRecord ? jsonRecord.data : browserResult.json;
      const schemaPreviewPayload =
        browserResult.json !== null &&
        browserResult.json !== undefined &&
        typeof schemaPayload !== 'undefined'
          ? serializeForPreview(schemaPayload, GRAPHQL_MAX_SCHEMA_CHARS)
          : {
              preview: browserResult.preview ?? '',
              truncated: browserResult.truncated ?? false,
              totalLength: browserResult.totalLength ?? 0,
            };

      const payload: Record<string, unknown> = {
        success: browserResult.ok,
        endpoint,
        status: browserResult.status,
        statusText: browserResult.statusText,
        schemaLength: schemaPreviewPayload.totalLength,
        schemaPreview: schemaPreviewPayload.preview,
        schemaTruncated: schemaPreviewPayload.truncated,
        responseHeaders: browserResult.responseHeaders ?? {},
      };

      if (!schemaPreviewPayload.truncated) {
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
