/**
 * GraphQL query extraction handler.
 *
 * Extracts GraphQL queries/mutations from captured network traces in the page.
 */

import type { CodeCollector } from '@server/domains/shared/modules';
import {
  toResponse,
  toError,
  createPreview,
  serializeForPreview,
  parseClampedNumber,
} from '@server/domains/graphql/handlers/shared';
import {
  GRAPHQL_MAX_PREVIEW_CHARS,
  GRAPHQL_MAX_QUERY_CHARS,
} from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import type { ExtractedGraphQLQuery } from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import { evaluateWithTimeout } from '@modules/collector/PageController';

type GraphQLConsoleMonitorLike = {
  getFetchRequests?: () => Promise<unknown[]>;
  getXHRRequests?: () => Promise<unknown[]>;
  getNetworkRequests?: (filter?: { url?: string; method?: string; limit?: number }) => unknown[];
};

export interface GraphQLExtractDependencies {
  collector: CodeCollector;
  consoleMonitor?: GraphQLConsoleMonitorLike | null;
}

interface ExtractionAccumulator {
  scannedRecords: number;
  extracted: ExtractedGraphQLQuery[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function appendGraphQLPayload(
  extracted: ExtractedGraphQLQuery[],
  payload: Record<string, unknown> | null,
  metadata: {
    source: string;
    url: string;
    method: string;
    timestamp: number | null;
    contentType: string;
  },
): void {
  if (!payload) return;

  const queryRaw = payload.query;
  if (typeof queryRaw !== 'string' || queryRaw.trim().length === 0) return;

  const operationNameRaw = payload.operationName;
  const operationName =
    typeof operationNameRaw === 'string' && operationNameRaw.trim().length > 0
      ? operationNameRaw
      : (queryRaw.match(/^\s*(query|mutation|subscription)\s+([A-Za-z0-9_]+)/)?.[2] ?? null);

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
}

function parseBodyStringToPayload(rawBody: string): Record<string, unknown> | null {
  const trimmed = rawBody.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // Not JSON.
  }

  if (trimmed.includes('query=')) {
    try {
      const params = new URLSearchParams(trimmed);
      const query = params.get('query');
      if (query) {
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
        return { query, operationName, variables };
      }
    } catch {
      // Not URL-encoded.
    }
  }

  if (
    trimmed.startsWith('query ') ||
    trimmed.startsWith('mutation ') ||
    trimmed.startsWith('subscription ')
  ) {
    return { query: trimmed };
  }

  return null;
}

function getRequestHeaders(record: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(record.headers)) {
    return record.headers;
  }
  if (isRecord(record.requestHeaders)) {
    return record.requestHeaders;
  }
  return {};
}

function getContentType(record: Record<string, unknown>): string {
  const headers = getRequestHeaders(record);
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'content-type') {
      return typeof value === 'string' ? value.toLowerCase() : String(value).toLowerCase();
    }
  }
  return '';
}

function getBodyCandidates(record: Record<string, unknown>): unknown[] {
  const candidates: unknown[] = [record.body, record.postData];
  if (isRecord(record.options)) {
    candidates.push(record.options.body);
  }
  if (isRecord(record.request)) {
    candidates.push(record.request.postData);
  }
  return candidates;
}

function extractQueriesFromRecords(records: unknown, source: string): ExtractionAccumulator {
  const state: ExtractionAccumulator = {
    scannedRecords: 0,
    extracted: [],
  };

  if (!Array.isArray(records)) {
    return state;
  }

  for (const item of records) {
    if (!isRecord(item)) continue;
    state.scannedRecords += 1;

    const url = typeof item.url === 'string' ? item.url : '';
    const method = typeof item.method === 'string' ? item.method : 'POST';
    const timestamp = typeof item.timestamp === 'number' ? item.timestamp : null;
    const contentType = getContentType(item);

    for (const bodyCandidate of getBodyCandidates(item)) {
      let payload: Record<string, unknown> | null = null;

      if (isRecord(bodyCandidate)) {
        payload = bodyCandidate;
      } else if (typeof bodyCandidate === 'string') {
        payload = parseBodyStringToPayload(bodyCandidate);
      }

      appendGraphQLPayload(state.extracted, payload, {
        source,
        url,
        method,
        timestamp,
        contentType,
      });
    }

    if (contentType.includes('application/graphql') && typeof item.body === 'string') {
      appendGraphQLPayload(
        state.extracted,
        { query: item.body, variables: null, operationName: null },
        {
          source,
          url,
          method,
          timestamp,
          contentType,
        },
      );
    }
  }

  return state;
}

function dedupeExtractedQueries(items: ExtractedGraphQLQuery[]): ExtractedGraphQLQuery[] {
  const sorted = items.toSorted((left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0));
  const deduped: ExtractedGraphQLQuery[] = [];
  const seen = new Set<string>();

  for (const item of sorted) {
    const key = `${item.url}|${item.operationName ?? ''}|${item.query}|${JSON.stringify(item.variables)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

export class ExtractHandlers {
  private readonly deps: GraphQLExtractDependencies;

  constructor(deps: CodeCollector | GraphQLExtractDependencies) {
    this.deps = 'collector' in deps ? deps : { collector: deps };
  }

  async handleGraphqlExtractQueries(args: Record<string, unknown>) {
    try {
      const limit = parseClampedNumber(args, 'limit', 50, 1, 200);
      const page = await this.deps.collector.getActivePage();

      const pageExtraction = (await evaluateWithTimeout(
        page,
        (maxItems: number) => {
          const globalScope = window as unknown as Window & Record<string, unknown>;

          const extracted: ExtractedGraphQLQuery[] = [];
          let scannedRecords = 0;

          const pushIfGraphQL = (
            payload: Record<string, unknown> | null,
            metadata: {
              source: string;
              url: string;
              method: string;
              timestamp: number | null;
              contentType: string;
            },
          ): void => {
            if (!payload) return;

            const queryRaw = payload.query;
            if (typeof queryRaw !== 'string' || queryRaw.trim().length === 0) return;

            const operationNameRaw = payload.operationName;
            const operationName =
              typeof operationNameRaw === 'string' && operationNameRaw.trim().length > 0
                ? operationNameRaw
                : (queryRaw.match(/^\s*(query|mutation|subscription)\s+([A-Za-z0-9_]+)/)?.[2] ??
                  null);

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

          // eslint-disable-next-line unicorn/consistent-function-scoping -- runs in browser context via evaluateWithTimeout
          const parseStringBody = (trimmed: string): Record<string, unknown> | null => {
            if (!trimmed) return null;

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
                if (query) {
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
                  return { query, operationName, variables };
                }
              } catch {
                // not URL-encoded
              }
            }

            if (
              trimmed.startsWith('query ') ||
              trimmed.startsWith('mutation ') ||
              trimmed.startsWith('subscription ')
            ) {
              return { query: trimmed };
            }

            return null;
          };

          const processRequestRecord = (record: Record<string, unknown>, source: string): void => {
            scannedRecords += 1;

            const url = typeof record.url === 'string' ? record.url : '';
            const method = typeof record.method === 'string' ? record.method : 'POST';
            const timestamp = typeof record.timestamp === 'number' ? record.timestamp : null;

            const headers =
              (record.headers &&
              typeof record.headers === 'object' &&
              !Array.isArray(record.headers)
                ? (record.headers as Record<string, unknown>)
                : null) ??
              (record.requestHeaders &&
              typeof record.requestHeaders === 'object' &&
              !Array.isArray(record.requestHeaders)
                ? (record.requestHeaders as Record<string, unknown>)
                : null) ??
              {};

            let contentType = '';
            for (const [key, value] of Object.entries(headers)) {
              if (key.toLowerCase() === 'content-type') {
                contentType = typeof value === 'string' ? value : String(value);
                break;
              }
            }
            contentType = contentType.toLowerCase();

            const bodyCandidates: unknown[] = [record.body, record.postData];
            if (
              record.options &&
              typeof record.options === 'object' &&
              !Array.isArray(record.options)
            ) {
              bodyCandidates.push((record.options as Record<string, unknown>).body);
            }

            for (const bodyCandidate of bodyCandidates) {
              let payload: Record<string, unknown> | null = null;

              if (
                bodyCandidate &&
                typeof bodyCandidate === 'object' &&
                !Array.isArray(bodyCandidate)
              ) {
                payload = bodyCandidate as Record<string, unknown>;
              } else if (typeof bodyCandidate === 'string') {
                payload = parseStringBody(bodyCandidate);
              }

              pushIfGraphQL(payload, { source, url, method, timestamp, contentType });
            }

            if (contentType.includes('application/graphql') && typeof record.body === 'string') {
              pushIfGraphQL(
                { query: record.body, variables: null, operationName: null },
                { source, url, method, timestamp, contentType },
              );
            }
          };

          const processArray = (value: unknown, source: string): void => {
            if (!Array.isArray(value)) return;
            for (const item of value) {
              if (item && typeof item === 'object') {
                processRequestRecord(item as Record<string, unknown>, source);
              }
            }
          };

          const fetchRequests = Array.isArray(globalScope.__fetchRequests)
            ? globalScope.__fetchRequests
            : typeof globalScope.__getFetchRequests === 'function'
              ? globalScope.__getFetchRequests()
              : undefined;
          const xhrRequests = Array.isArray(globalScope.__xhrRequests)
            ? globalScope.__xhrRequests
            : typeof globalScope.__getXHRRequests === 'function'
              ? globalScope.__getXHRRequests()
              : undefined;

          processArray(fetchRequests, 'window.__fetchRequests');
          processArray(xhrRequests, 'window.__xhrRequests');
          processArray(globalScope.__networkRequests, 'window.__networkRequests');

          const aiHooks = globalScope.__aiHooks;
          if (aiHooks && typeof aiHooks === 'object') {
            for (const [hookName, hookRecords] of Object.entries(aiHooks)) {
              if (!Array.isArray(hookRecords)) continue;
              for (const entry of hookRecords) {
                if (entry && typeof entry === 'object') {
                  processRequestRecord(
                    entry as Record<string, unknown>,
                    `window.__aiHooks.${hookName}`,
                  );
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
        limit,
      )) as {
        scannedRecords: number;
        totalExtracted: number;
        extracted: ExtractedGraphQLQuery[];
      };

      let scannedRecords = pageExtraction.scannedRecords;
      const combinedExtracted = [...pageExtraction.extracted];

      if (this.deps.consoleMonitor) {
        const fetchRequestsPromise =
          typeof this.deps.consoleMonitor.getFetchRequests === 'function'
            ? this.deps.consoleMonitor.getFetchRequests().catch(() => [])
            : Promise.resolve([]);
        const xhrRequestsPromise =
          typeof this.deps.consoleMonitor.getXHRRequests === 'function'
            ? this.deps.consoleMonitor.getXHRRequests().catch(() => [])
            : Promise.resolve([]);
        const [fetchRequests, xhrRequests] = await Promise.all([
          fetchRequestsPromise,
          xhrRequestsPromise,
        ]);
        let networkRequests: unknown[] = [];
        try {
          networkRequests =
            typeof this.deps.consoleMonitor.getNetworkRequests === 'function'
              ? this.deps.consoleMonitor.getNetworkRequests({ limit: 500 })
              : [];
        } catch {
          networkRequests = [];
        }

        const fallbackExtractions = [
          extractQueriesFromRecords(fetchRequests, 'consoleMonitor.fetchRequests'),
          extractQueriesFromRecords(xhrRequests, 'consoleMonitor.xhrRequests'),
          extractQueriesFromRecords(networkRequests, 'consoleMonitor.networkRequests'),
        ];

        for (const fallback of fallbackExtractions) {
          scannedRecords += fallback.scannedRecords;
          combinedExtracted.push(...fallback.extracted);
        }
      }

      const dedupedExtracted = dedupeExtractedQueries(combinedExtracted);
      const totalExtracted = Math.max(pageExtraction.totalExtracted, dedupedExtracted.length);
      const queries = dedupedExtracted.slice(0, limit).map((item, index) => {
        const queryPreview = createPreview(item.query, GRAPHQL_MAX_QUERY_CHARS);
        const variablesPreview = serializeForPreview(item.variables, GRAPHQL_MAX_PREVIEW_CHARS);

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

      return toResponse({
        success: true,
        limit,
        stats: {
          scannedRecords,
          totalExtracted,
          returned: queries.length,
        },
        queries,
      });
    } catch (error) {
      return toError(error);
    }
  }
}
