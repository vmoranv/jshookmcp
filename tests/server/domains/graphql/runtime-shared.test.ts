import { describe, expect, it } from 'vitest';

import {
  GRAPHQL_MAX_PREVIEW_CHARS,
  GRAPHQL_MAX_SCHEMA_CHARS,
  GRAPHQL_MAX_QUERY_CHARS,
  GRAPHQL_MAX_GRAPH_NODES,
  GRAPHQL_MAX_GRAPH_EDGES,
  INTROSPECTION_QUERY,
} from '@server/domains/graphql/handlers.impl.core.runtime.shared';

import type {
  ScriptMatchType,
  ScriptReplaceRule,
  InterceptRequest,
  PreviewPayload,
  CallGraphNode,
  CallGraphEdge,
  BrowserFetchResult,
  ExtractedGraphQLQuery,
} from '@server/domains/graphql/handlers.impl.core.runtime.shared';

describe('GraphQL runtime shared constants', () => {
  it('GRAPHQL_MAX_PREVIEW_CHARS is a positive number', () => {
    expect(GRAPHQL_MAX_PREVIEW_CHARS).toBeGreaterThan(0);
    expect(typeof GRAPHQL_MAX_PREVIEW_CHARS).toBe('number');
  });

  it('GRAPHQL_MAX_SCHEMA_CHARS is a positive number', () => {
    expect(GRAPHQL_MAX_SCHEMA_CHARS).toBeGreaterThan(0);
  });

  it('GRAPHQL_MAX_QUERY_CHARS is a positive number', () => {
    expect(GRAPHQL_MAX_QUERY_CHARS).toBeGreaterThan(0);
  });

  it('GRAPHQL_MAX_GRAPH_NODES is a positive number', () => {
    expect(GRAPHQL_MAX_GRAPH_NODES).toBeGreaterThan(0);
  });

  it('GRAPHQL_MAX_GRAPH_EDGES is a positive number', () => {
    expect(GRAPHQL_MAX_GRAPH_EDGES).toBeGreaterThan(0);
  });

  it('schema chars limit is larger than preview chars limit', () => {
    expect(GRAPHQL_MAX_SCHEMA_CHARS).toBeGreaterThan(GRAPHQL_MAX_PREVIEW_CHARS);
  });

  it('query chars limit is larger than preview chars limit', () => {
    expect(GRAPHQL_MAX_QUERY_CHARS).toBeGreaterThan(GRAPHQL_MAX_PREVIEW_CHARS);
  });
});

describe('INTROSPECTION_QUERY', () => {
  it('is a non-empty string', () => {
    expect(typeof INTROSPECTION_QUERY).toBe('string');
    expect(INTROSPECTION_QUERY.length).toBeGreaterThan(0);
  });

  it('starts with query IntrospectionQuery', () => {
    expect(INTROSPECTION_QUERY).toMatch(/^query IntrospectionQuery/);
  });

  it('contains __schema root', () => {
    expect(INTROSPECTION_QUERY).toContain('__schema');
  });

  it('contains queryType, mutationType, and subscriptionType', () => {
    expect(INTROSPECTION_QUERY).toContain('queryType');
    expect(INTROSPECTION_QUERY).toContain('mutationType');
    expect(INTROSPECTION_QUERY).toContain('subscriptionType');
  });

  it('contains fragment definitions', () => {
    expect(INTROSPECTION_QUERY).toContain('fragment FullType');
    expect(INTROSPECTION_QUERY).toContain('fragment InputValue');
    expect(INTROSPECTION_QUERY).toContain('fragment TypeRef');
  });

  it('references types and directives', () => {
    expect(INTROSPECTION_QUERY).toContain('types { ...FullType }');
    expect(INTROSPECTION_QUERY).toContain('directives');
  });

  it('includes nested ofType for deep type references', () => {
    const ofTypeCount = (INTROSPECTION_QUERY.match(/ofType/g) ?? []).length;
    expect(ofTypeCount).toBeGreaterThanOrEqual(7);
  });

  it('is trimmed (no leading/trailing whitespace)', () => {
    expect(INTROSPECTION_QUERY).toBe(INTROSPECTION_QUERY.trim());
  });
});

describe('shared type interfaces', () => {
  it('ScriptMatchType accepts valid values', () => {
    const valid: ScriptMatchType[] = ['exact', 'contains', 'regex'];
    expect(valid).toHaveLength(3);
  });

  it('ScriptReplaceRule has required fields', () => {
    const rule: ScriptReplaceRule = {
      id: 'test-id',
      url: 'https://example.com/script.js',
      replacement: 'console.log("replaced")',
      matchType: 'contains',
      createdAt: Date.now(),
      hits: 0,
    };
    expect(rule.id).toBe('test-id');
    expect(rule.hits).toBe(0);
  });

  it('InterceptRequest shape is correct', () => {
    const request: InterceptRequest = {
      url: () => 'https://example.com/script.js',
      resourceType: () => 'script',
      continue: async () => {},
      respond: async () => {},
    };
    expect(request.url()).toBe('https://example.com/script.js');
    expect(request.resourceType()).toBe('script');
  });

  it('InterceptRequest with optional isInterceptResolutionHandled', () => {
    const request: InterceptRequest = {
      url: () => '',
      resourceType: () => 'script',
      continue: async () => {},
      respond: async () => {},
      isInterceptResolutionHandled: () => true,
    };
    expect(request.isInterceptResolutionHandled?.()).toBe(true);
  });

  it('PreviewPayload has required fields', () => {
    const payload: PreviewPayload = {
      preview: 'text...',
      truncated: true,
      totalLength: 1000,
    };
    expect(payload.truncated).toBe(true);
    expect(payload.totalLength).toBe(1000);
  });

  it('CallGraphNode has required fields', () => {
    const node: CallGraphNode = {
      id: 'fn1',
      name: 'doSomething',
      callCount: 5,
    };
    expect(node.callCount).toBe(5);
  });

  it('CallGraphEdge has required fields', () => {
    const edge: CallGraphEdge = {
      source: 'fn1',
      target: 'fn2',
      count: 3,
    };
    expect(edge.count).toBe(3);
  });

  it('BrowserFetchResult has required fields', () => {
    const result: BrowserFetchResult = {
      ok: true,
      status: 200,
      statusText: 'OK',
      responseText: '{}',
      responseJson: {},
    };
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.responseHeaders).toBeUndefined();
  });

  it('BrowserFetchResult with optional fields', () => {
    const result: BrowserFetchResult = {
      ok: false,
      status: 500,
      statusText: 'Error',
      responseText: '',
      responseJson: null,
      responseHeaders: { 'x-err': 'yes' },
      error: 'server error',
    };
    expect(result.error).toBe('server error');
    expect(result.responseHeaders).toEqual({ 'x-err': 'yes' });
  });

  it('ExtractedGraphQLQuery has required fields', () => {
    const query: ExtractedGraphQLQuery = {
      source: 'window.__fetchRequests',
      url: 'https://example.com/graphql',
      method: 'POST',
      operationName: 'GetUser',
      query: 'query GetUser { user { name } }',
      variables: { id: '1' },
      timestamp: Date.now(),
      contentType: 'application/json',
    };
    expect(query.operationName).toBe('GetUser');
  });

  it('ExtractedGraphQLQuery allows null operationName and timestamp', () => {
    const query: ExtractedGraphQLQuery = {
      source: 'window.__xhrRequests',
      url: 'https://example.com/graphql',
      method: 'POST',
      operationName: null,
      query: '{ viewer { id } }',
      variables: null,
      timestamp: null,
      contentType: 'application/json',
    };
    expect(query.operationName).toBeNull();
    expect(query.timestamp).toBeNull();
  });
});
