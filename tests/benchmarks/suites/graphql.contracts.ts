/**
 * graphql domain contract cases — the 7 tools that need a live page (query
 * extraction / call graph / replay / subscribe / script persistence) or an
 * external endpoint (introspection / schema enumeration).
 *
 * Ground truth on any machine:
 *  - a page-bound tool with no browser reports the PREREQUISITE failure with a
 *    named reason, never a fabricated GraphQL document set
 *  - an SSRF gate refuses private/reserved endpoints by name
 *  - required endpoint/url arguments are rejected by name before any network
 *    or page access
 */
import { PrerequisiteError } from '@errors/PrerequisiteError';
import { GraphQLToolHandlers } from '@server/domains/graphql/handlers.impl';
import { body } from '../harness';

/** Public-looking endpoint that never gets contacted: the page gate fires first. */
const FAR_ENDPOINT = 'https://graphql.example.test/graphql';

/**
 * Handlers whose page lookup fails the way the real server does when no browser
 * is attached: `getActivePage()` raises a PrerequisiteError, which the handlers
 * surface as `{success:false, code:'PREREQUISITE'}`.
 */
function handlersWithoutBrowser(): GraphQLToolHandlers {
  return new GraphQLToolHandlers({
    getActivePage: async () => {
      throw new PrerequisiteError('Browser not available: no browser launched');
    },
  } as never);
}

const text = (v: unknown): Record<string, unknown> => body(v) as Record<string, unknown>;

/** Assert a response is the named PREREQUISITE refusal (or a named alternative). */
function prerequisiteRefusal(v: unknown, alternates: RegExp[] = []): true | string {
  const b = text(v);
  const message = String(b['error'] ?? b['message'] ?? b['raw'] ?? '');
  if (b['success'] !== false) return `expected success=false: ${JSON.stringify(b).slice(0, 160)}`;
  if (message.length === 0) return `failure without a named reason`;
  if (b['code'] === 'PREREQUISITE') return true;
  if (/browser not available|no browser/i.test(message)) return true;
  return alternates.some((re) => re.test(message))
    ? true
    : `unexpected refusal: ${message.slice(0, 180)}`;
}

export const graphqlContractCases = [
  {
    name: 'graphql_extract_queries/requires-page',
    tool: 'graphql_extract_queries',
    origin: 'homemade' as const,
    reference:
      'admission contract: query extraction reads in-page GraphQL documents, so with no browser it fails with a named PREREQUISITE reason and returns no queries',
    run: () => handlersWithoutBrowser().handleGraphqlExtractQueriesTool({}),
    validate: (v: unknown) => {
      const result = prerequisiteRefusal(v);
      if (result !== true) return result;
      const b = text(v);
      return b['queries'] === undefined || (b['queries'] as unknown[]).length === 0
        ? true
        : `must not invent extracted queries`;
    },
  },
  {
    name: 'call_graph_analyze/requires-page',
    tool: 'call_graph_analyze',
    origin: 'homemade' as const,
    reference:
      'admission contract: the call graph is built from in-page trace buffers, so with no browser it fails with a named PREREQUISITE reason and no nodes/edges',
    run: () => handlersWithoutBrowser().handleCallGraphAnalyzeTool({}),
    validate: (v: unknown) => {
      const result = prerequisiteRefusal(v);
      if (result !== true) return result;
      const b = text(v);
      const nodes = b['nodes'];
      const edges = b['edges'];
      if (Array.isArray(nodes) && nodes.length > 0) return `must not invent graph nodes`;
      if (Array.isArray(edges) && edges.length > 0) return `must not invent graph edges`;
      return true;
    },
  },
  {
    name: 'graphql_introspect/requires-endpoint',
    tool: 'graphql_introspect',
    origin: 'homemade' as const,
    reference:
      'argument contract: introspection needs the endpoint URL and names it when absent (checked before the page gate on this path)',
    run: () => handlersWithoutBrowser().handleGraphqlIntrospectTool({}),
    validate: (v: unknown) => {
      const b = text(v);
      const message = String(b['error'] ?? b['message'] ?? '');
      if (b['success'] !== false) return `expected success=false`;
      return /endpoint/i.test(message)
        ? true
        : `expected an endpoint error: ${message.slice(0, 160)}`;
    },
  },
  {
    name: 'graphql_introspect/requires-page-before-network',
    tool: 'graphql_introspect',
    origin: 'homemade' as const,
    reference:
      'admission contract: with a valid endpoint but no browser the tool stops at the page prerequisite — it never contacts the endpoint or fabricates a schema',
    run: () => handlersWithoutBrowser().handleGraphqlIntrospectTool({ endpoint: FAR_ENDPOINT }),
    validate: (v: unknown) => {
      const result = prerequisiteRefusal(v, [/endpoint/i]);
      if (result !== true) return result;
      const b = text(v);
      return b['schema'] === undefined ? true : `must not return a schema without a page`;
    },
  },
  {
    name: 'graphql_replay/requires-endpoint',
    tool: 'graphql_replay',
    origin: 'homemade' as const,
    reference: 'argument contract: replay needs the endpoint it should replay against',
    run: () => handlersWithoutBrowser().handleGraphqlReplayTool({}),
    validate: (v: unknown) => {
      const b = text(v);
      const message = String(b['error'] ?? b['message'] ?? '');
      return b['success'] === false && /endpoint/i.test(message)
        ? true
        : `expected an endpoint error: ${message.slice(0, 160)}`;
    },
  },
  {
    name: 'graphql_replay/requires-page-before-network',
    tool: 'graphql_replay',
    origin: 'homemade' as const,
    reference:
      'admission contract: replay is issued from the page context, so with no browser it fails the prerequisite without sending the request',
    run: () =>
      handlersWithoutBrowser().handleGraphqlReplayTool({
        endpoint: FAR_ENDPOINT,
        query: '{ __typename }',
      }),
    validate: (v: unknown) => {
      const result = prerequisiteRefusal(v, [/endpoint/i]);
      if (result !== true) return result;
      const b = text(v);
      return b['response'] === undefined ? true : `must not report a response`;
    },
  },
  {
    name: 'graphql_subscribe/requires-endpoint',
    tool: 'graphql_subscribe',
    origin: 'homemade' as const,
    reference: 'argument contract: subscription setup needs the endpoint URL',
    run: () => handlersWithoutBrowser().handleGraphqlSubscribeTool({}),
    validate: (v: unknown) => {
      const b = text(v);
      const message = String(b['error'] ?? b['message'] ?? '');
      return b['success'] === false && /endpoint/i.test(message)
        ? true
        : `expected an endpoint error: ${message.slice(0, 160)}`;
    },
  },
  {
    name: 'graphql_subscribe/requires-page-before-network',
    tool: 'graphql_subscribe',
    origin: 'homemade' as const,
    reference:
      'admission contract: the subscription socket lives in the page, so with no browser the tool refuses without opening a stream',
    run: () =>
      handlersWithoutBrowser().handleGraphqlSubscribeTool({
        endpoint: FAR_ENDPOINT,
        query: 'subscription { ticks }',
      }),
    validate: (v: unknown) => {
      const result = prerequisiteRefusal(v, [/endpoint/i]);
      if (result !== true) return result;
      const b = text(v);
      return b['events'] === undefined || (b['events'] as unknown[]).length === 0
        ? true
        : `must not invent subscription events`;
    },
  },
  {
    name: 'graphql_enum_schema/refuses-private-endpoint',
    tool: 'graphql_enum_schema',
    origin: 'homemade' as const,
    reference:
      'SSRF gate: the schema enumerator validates the endpoint before contacting it, and loopback/private targets are refused by name',
    run: () =>
      handlersWithoutBrowser().handleGraphqlEnumSchemaTool({
        endpoint: 'http://127.0.0.1:1/graphql',
      }),
    validate: (v: unknown) => {
      const b = text(v);
      if (b['success'] !== false) return `expected a refusal: ${JSON.stringify(b).slice(0, 160)}`;
      return /Blocked: endpoint .* private\/reserved/i.test(String(b['error'] ?? ''))
        ? true
        : `expected the SSRF refusal text: ${String(b['error']).slice(0, 180)}`;
    },
  },
  {
    name: 'graphql_enum_schema/requires-endpoint',
    tool: 'graphql_enum_schema',
    origin: 'homemade' as const,
    reference: 'argument contract: schema enumeration needs the endpoint URL',
    run: () => handlersWithoutBrowser().handleGraphqlEnumSchemaTool({}),
    validate: (v: unknown) => {
      const b = text(v);
      const message = String(b['error'] ?? b['message'] ?? '');
      return b['success'] === false && /endpoint/i.test(message)
        ? true
        : `expected an endpoint error: ${message.slice(0, 160)}`;
    },
  },
  {
    name: 'script_replace_persist/requires-url',
    tool: 'script_replace_persist',
    origin: 'homemade' as const,
    reference: 'argument contract: persisting a replacement needs the script URL to match',
    run: () => handlersWithoutBrowser().handleScriptReplacePersistTool({}),
    validate: (v: unknown) => {
      const b = text(v);
      const message = String(b['error'] ?? b['message'] ?? '');
      return b['success'] === false && /url/i.test(message)
        ? true
        : `expected a url error: ${message.slice(0, 160)}`;
    },
  },
  {
    name: 'script_replace_persist/requires-replacement',
    tool: 'script_replace_persist',
    origin: 'homemade' as const,
    reference:
      'argument contract: a URL alone is not enough — the replacement body is required, and the refusal names it',
    run: () =>
      handlersWithoutBrowser().handleScriptReplacePersistTool({
        url: 'https://app.example.test/main.js',
      }),
    validate: (v: unknown) => {
      const b = text(v);
      const message = String(b['error'] ?? b['message'] ?? '');
      return b['success'] === false && /replacement/i.test(message)
        ? true
        : `expected a replacement error: ${message.slice(0, 160)}`;
    },
  },
  {
    name: 'script_replace_persist/requires-page',
    tool: 'script_replace_persist',
    origin: 'homemade' as const,
    reference:
      'admission contract: persisting a replacement registers a page-level script, so with no browser it fails the prerequisite without claiming persistence',
    run: () =>
      handlersWithoutBrowser().handleScriptReplacePersistTool({
        url: 'https://app.example.test/main.js',
        replacement: 'console.log(1)',
      }),
    validate: (v: unknown) => {
      const result = prerequisiteRefusal(v);
      if (result !== true) return result;
      const b = text(v);
      return b['persisted'] === true ? `must not claim persistence` : true;
    },
  },
];
