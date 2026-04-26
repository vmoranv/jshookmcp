/**
 * GraphQL introspection handler.
 *
 * Runs a GraphQL introspection query against a target endpoint.
 * Defaults to in-page fetch so same-origin cookies / CSRF context are
 * preserved. Callers can opt into Node-side fetch with `useBrowser=false`
 * when they explicitly want to avoid routing through the browser session.
 */

import type { CodeCollector } from '@server/domains/shared/modules';
import {
  toResponse,
  toError,
  normalizeHeaders,
  validateBrowserEndpoint,
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
import { argString, argBool } from '@server/domains/shared/parse-args';
import { evaluateWithTimeout } from '@modules/collector/PageController';

export class IntrospectionHandlers {
  constructor(private collector: CodeCollector) {}

  async handleGraphqlIntrospect(args: Record<string, unknown>) {
    try {
      const endpoint = argString(args, 'endpoint')?.trim();
      if (!endpoint) {
        return toError('Missing required argument: endpoint');
      }

      const headers = normalizeHeaders(args.headers);
      const useBrowser = argBool(args, 'useBrowser', true);

      if (useBrowser) {
        const page = await this.collector.getActivePage();
        const currentPageUrl = typeof page.url === 'function' ? page.url() : null;
        const endpointValidationError = await validateBrowserEndpoint(endpoint, currentPageUrl);
        if (endpointValidationError) {
          return toError(endpointValidationError);
        }

        return await this.introspectViaBrowser(page, endpoint, headers);
      }

      const endpointValidationError = await validateExternalEndpoint(endpoint);
      if (endpointValidationError) {
        return toError(endpointValidationError);
      }

      return await this.introspectViaNode(endpoint, headers);
    } catch (error) {
      return toError(error);
    }
  }

  private async introspectViaNode(endpoint: string, headers: Record<string, string>) {
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
          body: JSON.stringify({
            query: INTROSPECTION_QUERY,
            operationName: 'IntrospectionQuery',
          }),
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
      });
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let json: unknown = null;
    try {
      json = JSON.parse(responseText);
    } catch {
      // not JSON
    }

    // Release raw text immediately after parsing
    responseText = '';

    if (!response.ok && !json) {
      return toResponse({
        success: false,
        endpoint,
        status: response.status,
        statusText: response.statusText,
        error: 'Introspection request failed',
      });
    }

    const jsonRecord = json && typeof json === 'object' ? (json as Record<string, unknown>) : null;

    const schemaPayload = jsonRecord && 'data' in jsonRecord ? jsonRecord.data : json;
    const schemaPreviewPayload =
      json !== null && json !== undefined && typeof schemaPayload !== 'undefined'
        ? serializeForPreview(schemaPayload, GRAPHQL_MAX_SCHEMA_CHARS)
        : { preview: '', truncated: false, totalLength: 0 };

    const payload: Record<string, unknown> = {
      success: response.ok,
      endpoint,
      status: response.status,
      statusText: response.statusText,
      schemaLength: schemaPreviewPayload.totalLength,
      schemaPreview: schemaPreviewPayload.preview,
      schemaTruncated: schemaPreviewPayload.truncated,
      responseHeaders,
    };

    if (!schemaPreviewPayload.truncated) {
      payload.schema = schemaPayload;
    }

    if (jsonRecord && Array.isArray(jsonRecord.errors)) {
      payload.errors = jsonRecord.errors;
    }

    return toResponse(payload);
  }

  private async introspectViaBrowser(
    page: Awaited<ReturnType<CodeCollector['getActivePage']>>,
    endpoint: string,
    headers: Record<string, string>,
  ) {
    const browserResult = (await evaluateWithTimeout(
      page,
      async (input: {
        endpoint: string;
        headers: Record<string, string>;
        query: string;
        maxSchemaChars: number;
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

          const responseHeaders: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
          });

          const totalLength = responseText.length;

          let json: unknown = null;
          try {
            json = JSON.parse(responseText);
          } catch {
            // not JSON — json stays null
          }

          const preview = json === null ? responseText : '';
          responseText = '';

          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            responseHeaders,
            totalLength,
            preview,
            truncated: false,
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

    const schemaPayload = jsonRecord && 'data' in jsonRecord ? jsonRecord.data : browserResult.json;
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
  }
}
