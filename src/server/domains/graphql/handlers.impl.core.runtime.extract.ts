import {
  GRAPHQL_MAX_PREVIEW_CHARS,
  GRAPHQL_MAX_QUERY_CHARS,
} from './handlers.impl.core.runtime.shared.js';
import type { ExtractedGraphQLQuery } from './handlers.impl.core.runtime.shared.js';
import { GraphQLToolHandlersIntrospection } from './handlers.impl.core.runtime.introspection.js';

export class GraphQLToolHandlersExtract extends GraphQLToolHandlersIntrospection {
  async handleGraphqlExtractQueries(args: Record<string, unknown>) {
    try {
      const limit = this.getNumberArg(args, 'limit', 50, 1, 200);
      const page = await this.collector.getActivePage();

      const extraction = (await page.evaluate(
        (maxItems: number) => {
          const globalScope = window as unknown as Window & Record<string, unknown>;

          const extracted: ExtractedGraphQLQuery[] = [];
          let scannedRecords = 0;

          const getHeader = (headers: unknown, name: string): string => {
            if (!headers || typeof headers !== 'object') {
              return '';
            }

            const headerEntries = Object.entries(headers as Record<string, unknown>);
            for (const [key, value] of headerEntries) {
              if (key.toLowerCase() === name.toLowerCase()) {
                return typeof value === 'string' ? value : String(value);
              }
            }

            return '';
          };

          const parseBodyToObject = (body: unknown): Record<string, unknown> | null => {
            if (!body) {
              return null;
            }

            if (typeof body === 'object' && !Array.isArray(body)) {
              return body as Record<string, unknown>;
            }

            if (typeof body !== 'string') {
              return null;
            }

            const trimmed = body.trim();
            if (!trimmed) {
              return null;
            }

            try {
              const parsed = JSON.parse(trimmed);
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
              }
            } catch {
              // not JSON
            }

            if (trimmed.includes('query=')) {
              try {
                const params = new URLSearchParams(trimmed);
                const query = params.get('query');
                if (!query) {
                  return null;
                }

                const operationName = params.get('operationName');
                const variablesRaw = params.get('variables');

                let variables: unknown = null;
                if (variablesRaw) {
                  try {
                    variables = JSON.parse(variablesRaw);
                  } catch {
                    variables = variablesRaw;
                  }
                }

                return {
                  query,
                  operationName,
                  variables,
                };
              } catch {
                return null;
              }
            }

            if (trimmed.startsWith('query ') || trimmed.startsWith('mutation ') || trimmed.startsWith('subscription ')) {
              return { query: trimmed };
            }

            return null;
          };

          const inferOperationName = (query: string): string | null => {
            const match = query.match(/^\s*(query|mutation|subscription)\s+([A-Za-z0-9_]+)/);
            return match?.[2] ?? null;
          };

          const pushIfGraphQL = (
            payload: Record<string, unknown> | null,
            metadata: {
              source: string;
              url: string;
              method: string;
              timestamp: number | null;
              contentType: string;
            }
          ): void => {
            if (!payload) {
              return;
            }

            const queryRaw = payload.query;
            if (typeof queryRaw !== 'string' || queryRaw.trim().length === 0) {
              return;
            }

            const operationNameRaw = payload.operationName;
            const operationName =
              typeof operationNameRaw === 'string' && operationNameRaw.trim().length > 0
                ? operationNameRaw
                : inferOperationName(queryRaw);

            extracted.push({
              source: metadata.source,
              url: metadata.url,
              method: metadata.method,
              operationName,
              query: queryRaw,
              variables: payload.variables ?? null,
              timestamp: metadata.timestamp,
              contentType: metadata.contentType,
            });
          };

          const processRequestRecord = (
            record: Record<string, unknown>,
            source: string
          ): void => {
            scannedRecords += 1;

            const url = typeof record.url === 'string' ? record.url : '';
            const method = typeof record.method === 'string' ? record.method : 'POST';
            const timestamp = typeof record.timestamp === 'number' ? record.timestamp : null;

            const headers =
              (record.headers && typeof record.headers === 'object' && !Array.isArray(record.headers)
                ? (record.headers as Record<string, unknown>)
                : null) ??
              (record.requestHeaders && typeof record.requestHeaders === 'object' && !Array.isArray(record.requestHeaders)
                ? (record.requestHeaders as Record<string, unknown>)
                : null) ??
              {};

            const contentType = getHeader(headers, 'content-type').toLowerCase();

            const bodyCandidates: unknown[] = [record.body, record.postData];
            if (record.options && typeof record.options === 'object' && !Array.isArray(record.options)) {
              const optionsRecord = record.options as Record<string, unknown>;
              bodyCandidates.push(optionsRecord.body);
            }

            for (const bodyCandidate of bodyCandidates) {
              const payload = parseBodyToObject(bodyCandidate);
              pushIfGraphQL(payload, {
                source,
                url,
                method,
                timestamp,
                contentType,
              });
            }

            if (contentType.includes('application/graphql') && typeof record.body === 'string') {
              pushIfGraphQL(
                { query: record.body, variables: null, operationName: null },
                {
                  source,
                  url,
                  method,
                  timestamp,
                  contentType,
                }
              );
            }
          };

          const processArray = (value: unknown, source: string): void => {
            if (!Array.isArray(value)) {
              return;
            }

            for (const item of value) {
              if (item && typeof item === 'object') {
                processRequestRecord(item as Record<string, unknown>, source);
              }
            }
          };

          processArray(globalScope.__fetchRequests, 'window.__fetchRequests');
          processArray(globalScope.__xhrRequests, 'window.__xhrRequests');
          processArray(globalScope.__networkRequests, 'window.__networkRequests');

          const aiHooks = globalScope.__aiHooks;
          if (aiHooks && typeof aiHooks === 'object') {
            for (const [hookName, hookRecords] of Object.entries(aiHooks)) {
              if (!Array.isArray(hookRecords)) {
                continue;
              }

              for (const entry of hookRecords) {
                if (entry && typeof entry === 'object') {
                  processRequestRecord(entry as Record<string, unknown>, `window.__aiHooks.${hookName}`);
                }
              }
            }
          }

          extracted.sort((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0));

          const deduped: ExtractedGraphQLQuery[] = [];
          const seen = new Set<string>();

          for (const item of extracted) {
            const key = `${item.url}|${item.operationName ?? ''}|${item.query}|${JSON.stringify(item.variables)}`;
            if (!seen.has(key)) {
              seen.add(key);
              deduped.push(item);
            }
          }

          return {
            scannedRecords,
            totalExtracted: deduped.length,
            extracted: deduped.slice(0, maxItems),
          };
        },
        limit
      )) as {
        scannedRecords: number;
        totalExtracted: number;
        extracted: ExtractedGraphQLQuery[];
      };

      const queries = extraction.extracted.map((item, index) => {
        const queryPreview = this.createPreview(item.query, GRAPHQL_MAX_QUERY_CHARS);
        const variablesPreview = this.serializeForPreview(item.variables, GRAPHQL_MAX_PREVIEW_CHARS);

        const normalized: Record<string, unknown> = {
          index,
          source: item.source,
          url: item.url,
          method: item.method,
          operationName: item.operationName,
          contentType: item.contentType,
          timestamp: item.timestamp,
          queryLength: item.query.length,
          queryPreview: queryPreview.preview,
          queryTruncated: queryPreview.truncated,
        };

        if (!queryPreview.truncated) {
          normalized.query = item.query;
        }

        if (!variablesPreview.truncated) {
          normalized.variables = item.variables;
        } else {
          normalized.variablesPreview = variablesPreview.preview;
          normalized.variablesTruncated = true;
        }

        return normalized;
      });

      return this.toResponse({
        success: true,
        limit,
        stats: {
          scannedRecords: extraction.scannedRecords,
          totalExtracted: extraction.totalExtracted,
          returned: queries.length,
        },
        queries,
      });
    } catch (error) {
      return this.toError(error);
    }
  }
}