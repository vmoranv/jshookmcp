import { GRAPHQL_MAX_SCHEMA_CHARS } from './handlers.impl.core.runtime.shared.js';
import type { BrowserFetchResult } from './handlers.impl.core.runtime.shared.js';
import { GraphQLToolHandlersExtract } from './handlers.impl.core.runtime.extract.js';

export class GraphQLToolHandlersRuntime extends GraphQLToolHandlersExtract {
  async handleGraphqlReplay(args: Record<string, unknown>) {
    try {
      const endpoint = this.getStringArg(args, 'endpoint')?.trim();
      const query = this.getStringArg(args, 'query');

      if (!endpoint) {
        return this.toError('Missing required argument: endpoint');
      }

      if (typeof query !== 'string' || query.trim().length === 0) {
        return this.toError('Missing required argument: query');
      }
      const endpointValidationError = await this.validateExternalEndpoint(endpoint);
      if (endpointValidationError) {
        return this.toError(endpointValidationError);
      }

      const variables = this.getObjectArg(args, 'variables') ?? {};
      const operationNameRaw = this.getStringArg(args, 'operationName');
      const operationName =
        operationNameRaw && operationNameRaw.trim().length > 0 ? operationNameRaw.trim() : null;
      const headers = this.normalizeHeaders(args.headers);

      const page = await this.collector.getActivePage();

      const browserResult = (await page.evaluate(
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
            const response = await fetch(input.endpoint, {
              method: 'POST',
              headers: requestHeaders,
              body: JSON.stringify({
                query: input.query,
                variables: input.variables,
                operationName: input.operationName,
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
          query,
          variables,
          operationName,
          headers,
        }
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
        const responsePreview = this.serializeForPreview(browserResult.responseJson, GRAPHQL_MAX_SCHEMA_CHARS);

        payload.responseLength = responsePreview.totalLength;
        payload.responsePreview = responsePreview.preview;
        payload.responseTruncated = responsePreview.truncated;

        if (!responsePreview.truncated) {
          payload.response = browserResult.responseJson;
        }
      } else {
        const textPreview = this.createPreview(browserResult.responseText, GRAPHQL_MAX_SCHEMA_CHARS);

        payload.responseLength = textPreview.totalLength;
        payload.responsePreview = textPreview.preview;
        payload.responseTruncated = textPreview.truncated;
        payload.responseFormat = 'text';
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