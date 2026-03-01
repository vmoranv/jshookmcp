import {
  GRAPHQL_MAX_PREVIEW_CHARS,
  GRAPHQL_MAX_SCHEMA_CHARS,
  INTROSPECTION_QUERY,
} from './handlers.impl.core.runtime.shared.js';
import type { BrowserFetchResult } from './handlers.impl.core.runtime.shared.js';
import { GraphQLToolHandlersScriptReplace } from './handlers.impl.core.runtime.script-replace.js';

export class GraphQLToolHandlersIntrospection extends GraphQLToolHandlersScriptReplace {
  async handleGraphqlIntrospect(args: Record<string, unknown>) {
    try {
      const endpoint = this.getStringArg(args, 'endpoint')?.trim();
      if (!endpoint) {
        return this.toError('Missing required argument: endpoint');
      }
      const endpointValidationError = await this.validateExternalEndpoint(endpoint);
      if (endpointValidationError) {
        return this.toError(endpointValidationError);
      }

      const headers = this.normalizeHeaders(args.headers);

      const page = await this.collector.getActivePage();

      const browserResult = (await page.evaluate(
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
            const response = await fetch(input.endpoint, {
              method: 'POST',
              headers: requestHeaders,
              body: JSON.stringify({
                query: input.query,
                operationName: 'IntrospectionQuery',
              }),
            });

            const responseText = await response.text();

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
        {
          endpoint,
          headers,
          query: INTROSPECTION_QUERY,
        }
      )) as BrowserFetchResult;

      if (!browserResult.ok && !browserResult.responseJson) {
        return this.toResponse({
          success: false,
          endpoint,
          status: browserResult.status,
          statusText: browserResult.statusText,
          error: browserResult.error ?? 'Introspection request failed',
          responsePreview: this.createPreview(browserResult.responseText || '', GRAPHQL_MAX_PREVIEW_CHARS),
        });
      }

      const jsonRecord =
        browserResult.responseJson && typeof browserResult.responseJson === 'object'
          ? (browserResult.responseJson as Record<string, unknown>)
          : null;

      const schemaPayload =
        jsonRecord && 'data' in jsonRecord ? jsonRecord.data : browserResult.responseJson ?? browserResult.responseText;

      const schemaPreview = this.serializeForPreview(schemaPayload, GRAPHQL_MAX_SCHEMA_CHARS);

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

      return this.toResponse(payload);
    } catch (error) {
      return this.toError(error);
    }
  }
}