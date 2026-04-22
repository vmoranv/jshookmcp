export type ScriptMatchType = 'exact' | 'contains' | 'regex';

export interface ScriptReplaceRule {
  id: string;
  url: string;
  replacement: string;
  matchType: ScriptMatchType;
  createdAt: number;
  hits: number;
}

export interface InterceptRequest {
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

export interface PreviewPayload {
  preview: string;
  truncated: boolean;
  totalLength: number;
}

export interface CallGraphNode {
  id: string;
  name: string;
  callCount: number;
}

export interface CallGraphEdge {
  source: string;
  target: string;
  count: number;
}

export interface BrowserFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  responseText?: string;
  responseJson?: unknown | null;
  responseHeaders?: Record<string, string>;
  totalLength?: number;
  preview?: string;
  truncated?: boolean;
  json?: unknown | null;
  error?: string;
}

export interface ExtractedGraphQLQuery {
  source: string;
  url: string;
  method: string;
  operationName: string | null;
  query: string;
  variables: unknown;
  timestamp: number | null;
  contentType: string;
}

export {
  GRAPHQL_MAX_PREVIEW_CHARS,
  GRAPHQL_MAX_SCHEMA_CHARS,
  GRAPHQL_MAX_QUERY_CHARS,
  GRAPHQL_MAX_GRAPH_NODES,
  GRAPHQL_MAX_GRAPH_EDGES,
} from '@src/constants';

export const INTROSPECTION_QUERY = `
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
