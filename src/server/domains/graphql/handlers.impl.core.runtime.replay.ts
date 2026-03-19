import {
  GRAPHQL_MAX_PREVIEW_CHARS,
  GRAPHQL_MAX_SCHEMA_CHARS,
  GRAPHQL_MAX_QUERY_CHARS,
  GRAPHQL_MAX_GRAPH_NODES,
  GRAPHQL_MAX_GRAPH_EDGES,
  INTROSPECTION_QUERY,
} from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import type {
  BrowserFetchResult,
  CallGraphEdge,
  CallGraphNode,
  ExtractedGraphQLQuery,
  ScriptReplaceRule,
} from '@server/domains/graphql/handlers.impl.core.runtime.shared';
import { GraphQLHandlersBase } from '@server/domains/graphql/handlers.base';
import { evaluateWithTimeout } from '@modules/collector/PageController';

export class GraphQLToolHandlersRuntime extends GraphQLHandlersBase {
  // ── CallGraph handler ──
  async handleCallGraphAnalyze(args: Record<string, unknown>) {
    try {
      const maxDepth = this.getNumberArg(args, 'maxDepth', 5, 1, 20);
      const filterPattern = this.getStringArg(args, 'filterPattern')?.trim() || '';

      if (filterPattern) {
        try {
          new RegExp(filterPattern);
        } catch (error) {
          return this.toError('Invalid filterPattern regex', {
            filterPattern,
            reason: this.getErrorMessage(error),
          });
        }
      }

      const page = await this.collector.getActivePage();

      const rawResult = await evaluateWithTimeout(
        page,
        ({ maxDepth: depth, filterPattern: filter }) => {
          const globalScope = window as unknown as Window & Record<string, unknown>;
          const edgeMap = new Map<string, { source: string; target: string; count: number }>();
          const nodeMap = new Map<string, { id: string; name: string; callCount: number }>();

          let scannedRecords = 0;
          let acceptedRecords = 0;

          const filterRegex = filter ? new RegExp(filter) : null;

          const normalizeName = (value: unknown, fallback = 'anonymous'): string => {
            if (typeof value === 'string') {
              const normalized = value.trim();
              return normalized.length > 0 ? normalized : fallback;
            }
            return fallback;
          };

          const matchesFilter = (name: string): boolean => {
            if (!filterRegex) {
              return true;
            }
            filterRegex.lastIndex = 0;
            return filterRegex.test(name);
          };

          const includeEdge = (source: string, target: string): boolean => {
            if (!filterRegex) {
              return true;
            }
            return matchesFilter(source) || matchesFilter(target);
          };

          const incrementNode = (name: string, by = 1): void => {
            const existing = nodeMap.get(name);
            if (existing) {
              existing.callCount += by;
              return;
            }
            nodeMap.set(name, { id: name, name, callCount: by });
          };

          const addEdge = (sourceRaw: unknown, targetRaw: unknown): void => {
            const source = normalizeName(sourceRaw, '');
            const target = normalizeName(targetRaw, '');

            if (!source || !target || source === target) {
              return;
            }

            if (!includeEdge(source, target)) {
              return;
            }

            const key = `${source}__->__${target}`;
            const existing = edgeMap.get(key);
            if (existing) {
              existing.count += 1;
            } else {
              edgeMap.set(key, { source, target, count: 1 });
            }

            incrementNode(source, 1);
            incrementNode(target, 1);
          };

          const parseStackFrames = (stackValue: unknown): string[] => {
            if (typeof stackValue !== 'string' || stackValue.trim().length === 0) {
              return [];
            }

            return stackValue
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
              .map((line) => {
                const atMatch = line.match(/at\s+([^(<\s]+)/);
                if (atMatch && atMatch[1]) {
                  return atMatch[1];
                }
                const atFileMatch = line.match(/^([^(<\s]+)@/);
                if (atFileMatch && atFileMatch[1]) {
                  return atFileMatch[1];
                }
                return '';
              })
              .filter((name) => name.length > 0);
          };

          const processRecord = (record: Record<string, unknown>, fallbackName: string): void => {
            scannedRecords += 1;

            const callee = normalizeName(
              record.callee ??
                record.functionName ??
                record.fn ??
                record.name ??
                record.method ??
                record.target ??
                fallbackName,
              fallbackName
            );

            const caller = normalizeName(record.caller ?? record.parent ?? record.from ?? '', '');

            let used = false;

            if (caller && callee) {
              addEdge(caller, callee);
              used = true;
            }

            const frames = parseStackFrames(record.stack ?? record.stackTrace ?? record.trace);
            if (frames.length > 1) {
              const depthLimit = Math.min(depth, frames.length - 1);
              for (let index = 0; index < depthLimit; index += 1) {
                addEdge(frames[index + 1], frames[index]);
              }
              used = true;
            } else if (frames.length === 1 && callee && frames[0] !== callee) {
              addEdge(frames[0], callee);
              used = true;
            }

            if (used) {
              acceptedRecords += 1;
            }
          };

          const aiHooks = globalScope.__aiHooks;
          if (aiHooks && typeof aiHooks === 'object') {
            for (const [hookName, hookRecords] of Object.entries(aiHooks)) {
              if (!Array.isArray(hookRecords)) {
                continue;
              }

              for (const entry of hookRecords) {
                if (entry && typeof entry === 'object') {
                  processRecord(entry as Record<string, unknown>, hookName);
                }
              }
            }
          }

          const tracerKeys = [
            '__functionTraceRecords',
            '__functionTracerRecords',
            '__functionCalls',
            '__callTrace',
            '__traceCalls',
          ];

          for (const key of tracerKeys) {
            const records = globalScope[key];
            if (!Array.isArray(records)) {
              continue;
            }

            for (const entry of records) {
              if (entry && typeof entry === 'object') {
                processRecord(entry as Record<string, unknown>, key);
              }
            }
          }

          const functionTracer = globalScope.__functionTracer;
          if (functionTracer && typeof functionTracer === 'object') {
            const records = (functionTracer as Record<string, unknown>).records;
            if (Array.isArray(records)) {
              for (const entry of records) {
                if (entry && typeof entry === 'object') {
                  processRecord(entry as Record<string, unknown>, 'functionTracer.records');
                }
              }
            }
          }

          const nodes = Array.from(nodeMap.values()).sort(
            (left, right) => right.callCount - left.callCount
          );
          const edges = Array.from(edgeMap.values()).sort(
            (left, right) => right.count - left.count
          );

          return {
            nodes,
            edges,
            stats: {
              scannedRecords,
              acceptedRecords,
              nodeCount: nodes.length,
              edgeCount: edges.length,
              maxDepth: depth,
              filterPattern: filter || null,
            },
          };
        },
        {
          maxDepth,
          filterPattern,
        }
      );

      const result = rawResult as {
        nodes: CallGraphNode[];
        edges: CallGraphEdge[];
        stats: Record<string, unknown>;
      };

      const nodesTruncated = result.nodes.length > GRAPHQL_MAX_GRAPH_NODES;
      const edgesTruncated = result.edges.length > GRAPHQL_MAX_GRAPH_EDGES;

      return this.toResponse({
        success: true,
        nodes: result.nodes.slice(0, GRAPHQL_MAX_GRAPH_NODES),
        edges: result.edges.slice(0, GRAPHQL_MAX_GRAPH_EDGES),
        stats: {
          ...result.stats,
          nodesReturned: Math.min(result.nodes.length, GRAPHQL_MAX_GRAPH_NODES),
          edgesReturned: Math.min(result.edges.length, GRAPHQL_MAX_GRAPH_EDGES),
          nodesTruncated,
          edgesTruncated,
        },
      });
    } catch (error) {
      return this.toError(error);
    }
  }

  // ── ScriptReplace handler ──
  async handleScriptReplacePersist(args: Record<string, unknown>) {
    try {
      const url = this.getStringArg(args, 'url')?.trim();
      const replacement = this.getStringArg(args, 'replacement');
      const matchType = this.parseMatchType(args.matchType);

      if (!url) {
        return this.toError('Missing required argument: url');
      }

      if (typeof replacement !== 'string' || replacement.length === 0) {
        return this.toError('Missing required argument: replacement');
      }

      if (matchType === 'regex') {
        try {
          new RegExp(url);
        } catch (error) {
          return this.toError('Invalid regex in url for matchType=regex', {
            url,
            reason: this.getErrorMessage(error),
          });
        }
      }

      const page = await this.collector.getActivePage();

      const rule: ScriptReplaceRule = {
        id: this.generateRuleId(),
        url,
        replacement,
        matchType,
        createdAt: Date.now(),
        hits: 0,
      };

      this.scriptReplaceRules.push(rule);

      await this.ensureScriptInterception(page);

      await page.evaluateOnNewDocument(
        (payload) => {
          const runtimeWindow = window as unknown as Window & Record<string, unknown>;
          const key = '__scriptReplacePersistRules';

          const existing = Array.isArray(runtimeWindow[key])
            ? (runtimeWindow[key] as Array<Record<string, unknown>>)
            : [];

          const filtered = existing.filter((entry) => entry && entry.id !== payload.id);
          filtered.push(payload);

          runtimeWindow[key] = filtered;
        },
        {
          id: rule.id,
          url: rule.url,
          matchType: rule.matchType,
          createdAt: rule.createdAt,
        }
      );

      const replacementPreview = this.createPreview(replacement, GRAPHQL_MAX_PREVIEW_CHARS);

      return this.toResponse({
        success: true,
        message: 'Script replacement rule registered and interception enabled',
        rule: {
          id: rule.id,
          url: rule.url,
          matchType: rule.matchType,
          createdAt: rule.createdAt,
        },
        replacement: {
          length: replacement.length,
          preview: replacementPreview.preview,
          truncated: replacementPreview.truncated,
        },
        activeRuleCount: this.scriptReplaceRules.length,
      });
    } catch (error) {
      return this.toError(error);
    }
  }

  // ── Introspection handler ──
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
          responsePreview: this.createPreview(
            browserResult.responseText || '',
            GRAPHQL_MAX_PREVIEW_CHARS
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

  // ── Extract handler ──
  async handleGraphqlExtractQueries(args: Record<string, unknown>) {
    try {
      const limit = this.getNumberArg(args, 'limit', 50, 1, 200);
      const page = await this.collector.getActivePage();

      const extraction = (await evaluateWithTimeout(
        page,
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

            if (
              trimmed.startsWith('query ') ||
              trimmed.startsWith('mutation ') ||
              trimmed.startsWith('subscription ')
            ) {
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

            const contentType = getHeader(headers, 'content-type').toLowerCase();

            const bodyCandidates: unknown[] = [record.body, record.postData];
            if (
              record.options &&
              typeof record.options === 'object' &&
              !Array.isArray(record.options)
            ) {
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
                  processRequestRecord(
                    entry as Record<string, unknown>,
                    `window.__aiHooks.${hookName}`
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
        limit
      )) as {
        scannedRecords: number;
        totalExtracted: number;
        extracted: ExtractedGraphQLQuery[];
      };

      const queries = extraction.extracted.map((item, index) => {
        const queryPreview = this.createPreview(item.query, GRAPHQL_MAX_QUERY_CHARS);
        const variablesPreview = this.serializeForPreview(
          item.variables,
          GRAPHQL_MAX_PREVIEW_CHARS
        );

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

  // ── Replay handler ──
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
        const responsePreview = this.serializeForPreview(
          browserResult.responseJson,
          GRAPHQL_MAX_SCHEMA_CHARS
        );

        payload.responseLength = responsePreview.totalLength;
        payload.responsePreview = responsePreview.preview;
        payload.responseTruncated = responsePreview.truncated;

        if (!responsePreview.truncated) {
          payload.response = browserResult.responseJson;
        }
      } else {
        const textPreview = this.createPreview(
          browserResult.responseText,
          GRAPHQL_MAX_SCHEMA_CHARS
        );

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

// Backward compatibility: re-export old class names as aliases for tests
export {
  GraphQLToolHandlersRuntime as GraphQLToolHandlersCallGraph,
  GraphQLToolHandlersRuntime as GraphQLToolHandlersScriptReplace,
  GraphQLToolHandlersRuntime as GraphQLToolHandlersIntrospection,
  GraphQLToolHandlersRuntime as GraphQLToolHandlersExtract,
};
