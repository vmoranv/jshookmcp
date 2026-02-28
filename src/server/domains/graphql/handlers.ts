import type { Page } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '../../../modules/collector/CodeCollector.js';

type ScriptMatchType = 'exact' | 'contains' | 'regex';

interface ScriptReplaceRule {
  id: string;
  url: string;
  replacement: string;
  matchType: ScriptMatchType;
  createdAt: number;
  hits: number;
}

interface InterceptRequest {
  url(): string;
  resourceType(): string;
  continue(overrides?: Record<string, unknown>): Promise<void>;
  respond(response: {
    status: number;
    contentType?: string;
    headers?: Record<string, string>;
    body: string;
  }): Promise<void>;
  isInterceptResolutionHandled?: () => boolean;
}

interface PreviewPayload {
  preview: string;
  truncated: boolean;
  totalLength: number;
}

interface CallGraphNode {
  id: string;
  name: string;
  callCount: number;
}

interface CallGraphEdge {
  source: string;
  target: string;
  count: number;
}

interface BrowserFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  responseText: string;
  responseJson: unknown | null;
  responseHeaders?: Record<string, string>;
  error?: string;
}

interface ExtractedGraphQLQuery {
  source: string;
  url: string;
  method: string;
  operationName: string | null;
  query: string;
  variables: unknown;
  timestamp: number | null;
  contentType: string;
}

const INTROSPECTION_QUERY = `
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types { ...FullType }
    directives {
      name
      description
      locations
      args(includeDeprecated: true) { ...InputValue }
    }
  }
}
fragment FullType on __Type {
  kind
  name
  description
  fields(includeDeprecated: true) {
    name
    description
    args(includeDeprecated: true) { ...InputValue }
    type { ...TypeRef }
    isDeprecated
    deprecationReason
  }
  inputFields(includeDeprecated: true) { ...InputValue }
  interfaces { ...TypeRef }
  enumValues(includeDeprecated: true) {
    name
    description
    isDeprecated
    deprecationReason
  }
  possibleTypes { ...TypeRef }
}
fragment InputValue on __InputValue {
  name
  description
  type { ...TypeRef }
  defaultValue
  isDeprecated
  deprecationReason
}
fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType {
        kind
        name
        ofType {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
        }
      }
    }
  }
}
`.trim();

export class GraphQLToolHandlers {
  private static readonly MAX_PREVIEW_CHARS = 4000;
  private static readonly MAX_SCHEMA_CHARS = 120000;
  private static readonly MAX_QUERY_CHARS = 12000;
  private static readonly MAX_GRAPH_NODES = 2000;
  private static readonly MAX_GRAPH_EDGES = 5000;

  private readonly collector: CodeCollector;
  private readonly scriptReplaceRules: ScriptReplaceRule[] = [];
  private readonly interceptionInstalledPages: WeakSet<Page> = new WeakSet();

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  private toResponse(payload: unknown) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  private toError(error: unknown, context?: Record<string, unknown>) {
    const payload: Record<string, unknown> = {
      success: false,
      error: this.getErrorMessage(error),
    };
    if (context) {
      payload.context = context;
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(payload, null, 2),
        },
      ],
      isError: true,
    };
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private getStringArg(args: Record<string, unknown>, key: string): string | null {
    const value = args[key];
    return typeof value === 'string' ? value : null;
  }

  private getNumberArg(
    args: Record<string, unknown>,
    key: string,
    defaultValue: number,
    min: number,
    max: number
  ): number {
    const value = args[key];
    let parsed = defaultValue;

    if (typeof value === 'number' && Number.isFinite(value)) {
      parsed = value;
    } else if (typeof value === 'string') {
      const fromString = Number(value);
      if (Number.isFinite(fromString)) {
        parsed = fromString;
      }
    }

    if (parsed < min) {
      return min;
    }
    if (parsed > max) {
      return max;
    }
    return Math.trunc(parsed);
  }

  private getObjectArg(args: Record<string, unknown>, key: string): Record<string, unknown> | null {
    const value = args[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private normalizeHeaders(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype']);
    const headers = Object.create(null) as Record<string, string>;
    for (const [header, rawValue] of Object.entries(value)) {
      if (dangerousKeys.has(header)) continue;
      if (typeof rawValue === 'string') {
        headers[header] = rawValue;
      } else if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
        headers[header] = String(rawValue);
      }
    }
    return headers;
  }

  private createPreview(text: string, maxChars: number): PreviewPayload {
    if (text.length <= maxChars) {
      return {
        preview: text,
        truncated: false,
        totalLength: text.length,
      };
    }

    return {
      preview: `${text.slice(0, maxChars)}\n... (truncated)`,
      truncated: true,
      totalLength: text.length,
    };
  }

  private serializeForPreview(value: unknown, maxChars: number): PreviewPayload {
    let serialized: string;

    if (typeof value === 'string') {
      serialized = value;
    } else {
      try {
        serialized = JSON.stringify(value, null, 2);
      } catch {
        serialized = String(value);
      }
    }

    return this.createPreview(serialized, maxChars);
  }

  private parseMatchType(value: unknown): ScriptMatchType {
    if (value === 'exact' || value === 'contains' || value === 'regex') {
      return value;
    }
    return 'contains';
  }

  private generateRuleId(): string {
    return `script_rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private isRequestInterceptHandled(request: InterceptRequest): boolean {
    if (typeof request.isInterceptResolutionHandled !== 'function') {
      return false;
    }

    try {
      return request.isInterceptResolutionHandled();
    } catch {
      return false;
    }
  }

  private async continueRequest(request: InterceptRequest): Promise<void> {
    if (this.isRequestInterceptHandled(request)) {
      return;
    }

    try {
      await request.continue();
    } catch {
      // Ignore interception race conditions.
    }
  }

  private ruleMatchesUrl(rule: ScriptReplaceRule, targetUrl: string): boolean {
    if (rule.matchType === 'exact') {
      return targetUrl === rule.url;
    }

    if (rule.matchType === 'contains') {
      return targetUrl.includes(rule.url);
    }

    try {
      const regex = new RegExp(rule.url);
      return regex.test(targetUrl);
    } catch {
      return false;
    }
  }

  private findMatchingRule(url: string): ScriptReplaceRule | null {
    for (let index = this.scriptReplaceRules.length - 1; index >= 0; index -= 1) {
      const rule = this.scriptReplaceRules[index];
      if (rule && this.ruleMatchesUrl(rule, url)) {
        return rule;
      }
    }

    return null;
  }

  private async handleInterceptedRequest(request: InterceptRequest): Promise<void> {
    if (this.isRequestInterceptHandled(request)) {
      return;
    }

    const resourceType = request.resourceType();
    if (resourceType !== 'script') {
      await this.continueRequest(request);
      return;
    }

    const requestUrl = request.url();
    const matchedRule = this.findMatchingRule(requestUrl);

    if (!matchedRule) {
      await this.continueRequest(request);
      return;
    }

    matchedRule.hits += 1;

    try {
      await request.respond({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        headers: {
          'cache-control': 'no-store',
          'x-script-replaced-by': 'script_replace_persist',
        },
        body: matchedRule.replacement,
      });
    } catch {
      await this.continueRequest(request);
    }
  }

  private async ensureScriptInterception(page: Page): Promise<void> {
    if (this.interceptionInstalledPages.has(page)) {
      return;
    }

    await page.setRequestInterception(true);

    type RequestListener = (request: InterceptRequest) => void;

    const listener: RequestListener = (request) => {
      void this.handleInterceptedRequest(request);
    };

    const eventHost = page as unknown as {
      prependListener?: (event: 'request', listener: RequestListener) => void;
      on: (event: 'request', listener: RequestListener) => void;
    };

    if (typeof eventHost.prependListener === 'function') {
      eventHost.prependListener('request', listener);
    } else {
      eventHost.on('request', listener);
    }

    this.interceptionInstalledPages.add(page);
  }

  async handleCallGraphAnalyze(args: Record<string, unknown>) {
    try {
      const maxDepth = this.getNumberArg(args, 'maxDepth', 5, 1, 20);
      const filterPattern = this.getStringArg(args, 'filterPattern')?.trim() || '';

      if (filterPattern) {
        try {
          // Validate user regex early.
          new RegExp(filterPattern);
        } catch (error) {
          return this.toError('Invalid filterPattern regex', {
            filterPattern,
            reason: this.getErrorMessage(error),
          });
        }
      }

      const page = await this.collector.getActivePage();

      const rawResult = await page.evaluate(
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

          const nodes = Array.from(nodeMap.values()).sort((left, right) => right.callCount - left.callCount);
          const edges = Array.from(edgeMap.values()).sort((left, right) => right.count - left.count);

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

      const nodesTruncated = result.nodes.length > GraphQLToolHandlers.MAX_GRAPH_NODES;
      const edgesTruncated = result.edges.length > GraphQLToolHandlers.MAX_GRAPH_EDGES;

      return this.toResponse({
        success: true,
        nodes: result.nodes.slice(0, GraphQLToolHandlers.MAX_GRAPH_NODES),
        edges: result.edges.slice(0, GraphQLToolHandlers.MAX_GRAPH_EDGES),
        stats: {
          ...result.stats,
          nodesReturned: Math.min(result.nodes.length, GraphQLToolHandlers.MAX_GRAPH_NODES),
          edgesReturned: Math.min(result.edges.length, GraphQLToolHandlers.MAX_GRAPH_EDGES),
          nodesTruncated,
          edgesTruncated,
        },
      });
    } catch (error) {
      return this.toError(error);
    }
  }

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

      await page.evaluateOnNewDocument((payload) => {
        const runtimeWindow = window as unknown as Window & Record<string, unknown>;
        const key = '__scriptReplacePersistRules';

        const existing = Array.isArray(runtimeWindow[key])
          ? (runtimeWindow[key] as Array<Record<string, unknown>>)
          : [];

        const filtered = existing.filter((entry) => entry && entry.id !== payload.id);
        filtered.push(payload);

        runtimeWindow[key] = filtered;
      }, {
        id: rule.id,
        url: rule.url,
        matchType: rule.matchType,
        createdAt: rule.createdAt,
      });

      const replacementPreview = this.createPreview(
        replacement,
        GraphQLToolHandlers.MAX_PREVIEW_CHARS
      );

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

  async handleGraphqlIntrospect(args: Record<string, unknown>) {
    try {
      const endpoint = this.getStringArg(args, 'endpoint')?.trim();
      if (!endpoint) {
        return this.toError('Missing required argument: endpoint');
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
          responsePreview: this.createPreview(
            browserResult.responseText || '',
            GraphQLToolHandlers.MAX_PREVIEW_CHARS
          ),
        });
      }

      const jsonRecord =
        browserResult.responseJson && typeof browserResult.responseJson === 'object'
          ? (browserResult.responseJson as Record<string, unknown>)
          : null;

      const schemaPayload =
        jsonRecord && 'data' in jsonRecord ? jsonRecord.data : browserResult.responseJson ?? browserResult.responseText;

      const schemaPreview = this.serializeForPreview(schemaPayload, GraphQLToolHandlers.MAX_SCHEMA_CHARS);

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
        const queryPreview = this.createPreview(item.query, GraphQLToolHandlers.MAX_QUERY_CHARS);
        const variablesPreview = this.serializeForPreview(
          item.variables,
          GraphQLToolHandlers.MAX_PREVIEW_CHARS
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
        const responsePreview = this.serializeForPreview(
          browserResult.responseJson,
          GraphQLToolHandlers.MAX_SCHEMA_CHARS
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
          GraphQLToolHandlers.MAX_SCHEMA_CHARS
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
