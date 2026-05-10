import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

const workflowNetworkPolicySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allowPrivateNetwork: {
      type: 'boolean',
      description:
        'Allow access to private/reserved targets only when the request also matches allowedHosts or allowedCidrs.',
    },
    allowInsecureHttp: {
      type: 'boolean',
      description:
        'Allow non-loopback HTTP targets only when the request also matches allowedHosts or allowedCidrs.',
    },
    allowedHosts: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Exact hostname or host:port allowlist for the primary target (for example ["labs.example.com", ' +
        '"localhost:8080"]).',
    },
    allowedCidrs: {
      type: 'array',
      items: { type: 'string' },
      description:
        'CIDR allowlist applied after DNS resolution (for example ["10.10.0.0/16", "192.168.1.10/32"]).',
    },
    allowedRedirectHosts: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Optional hostname or host:port allowlist for redirect hops. When omitted, redirects inherit ' +
        'allowedHosts/allowedCidrs.',
    },
  },
  description:
    'Request-level network authorization policy. Use this instead of process-wide bypasses when you need to reach' +
    ' a real lab target, private address, or plain HTTP service.',
} as const;

export const workflowToolDefinitions: Tool[] = [
  tool('js_bundle_search', (t) =>
    t
      .desc(
        'Fetch a remote JS bundle and search it with named regex patterns, with caching and noise filtering.',
      )
      .string('url', 'Remote URL of the JavaScript bundle to analyze')
      .array(
        'patterns',
        {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Human-readable label for this pattern' },
            regex: { type: 'string', description: 'JavaScript regex string' },
            contextBefore: {
              type: 'number',
              description: 'Characters of context before match (default: 80)',
            },
            contextAfter: {
              type: 'number',
              description: 'Characters of context after match (default: 80)',
            },
          },
          required: ['name', 'regex'],
        },
        'Named regex patterns to search for',
      )
      .boolean('cacheBundle', 'Cache the bundle for 5 minutes to avoid re-downloads', {
        default: true,
      })
      .boolean('stripNoise', 'Skip matches inside SVG path data or base64 blobs', { default: true })
      .number('maxMatches', 'Maximum matches to return per pattern', {
        default: 10,
        minimum: 1,
        maximum: 1000,
      })
      .prop('networkPolicy', workflowNetworkPolicySchema)
      .requiredOpenWorld('url', 'patterns'),
  ),
  tool('page_script_register', (t) =>
    t
      .desc(
        'Register a named reusable JS snippet in the Script Library. Execute with page_script_run.',
      )
      .string('name', 'Unique script name (e.g. "my_extractor")')
      .string(
        'code',
        'JavaScript expression/IIFE to register. Use `typeof __params__ !== "undefined" ? __params__ : {}` to ' +
          'safely access runtime parameters.',
      )
      .string('description', 'Optional human-readable description of the script')
      .required('name', 'code'),
  ),
  tool('page_script_run', (t) =>
    t
      .desc(
        'Execute a named script from the Script Library with optional runtime params (__params__).',
      )
      .string('name', 'Script name to run (built-in or registered)')
      .prop('params', {
        type: 'object',
        additionalProperties: true,
        description: 'Optional parameters injected as __params__ (must be JSON-serializable)',
      })
      .requiredOpenWorld('name'),
  ),
  tool('api_probe_batch', (t) =>
    t
      .desc('Batch-probe API endpoints in browser context with auto token injection and HTML skip.')
      .string(
        'baseUrl',
        'Base URL prefix (e.g. "https://chat.qwen.ai") — trailing slash will be stripped',
      )
      .array(
        'paths',
        { type: 'string' },
        'Paths to probe (e.g. ["/api/v1/users", "/api/v1/chats"])',
      )
      .enum(
        'method',
        ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
        'HTTP method for all probes',
        { default: 'GET' },
      )
      .object(
        'headers',
        { additionalProperties: { type: 'string' } },
        'Additional HTTP headers to include in all requests',
      )
      .string('bodyTemplate', 'JSON body string to send for POST/PUT/PATCH requests (optional)')
      .array(
        'includeBodyStatuses',
        { type: 'number' },
        'Status codes for which to include response body snippet (default: [200, 201, 204])',
      )
      .number('maxBodySnippetLength', 'Max characters per response body snippet', {
        default: 500,
        minimum: 0,
        maximum: 10000,
      })
      .boolean(
        'autoInjectAuth',
        'Auto-inject Bearer token from localStorage (token / active_token / access_token).',
        { default: true },
      )
      .prop('networkPolicy', workflowNetworkPolicySchema)
      .requiredOpenWorld('baseUrl', 'paths'),
  ),
  tool('list_extension_workflows', (t) =>
    t
      .desc('List runtime-loaded extension workflows from plugins/ or workflows/ directories.')
      .query(),
  ),
  tool('run_extension_workflow', (t) =>
    t
      .desc(
        'Execute an extension workflow by workflowId with optional config and timeout overrides.',
      )
      .string('workflowId', 'Registered extension workflow id to execute')
      .string('profile', 'Optional profile label exposed to the workflow execution context')
      .prop('config', {
        type: 'object',
        additionalProperties: true,
        description: 'Optional config overrides read through ctx.getConfig(path, fallback)',
      })
      .prop('nodeInputOverrides', {
        type: 'object',
        additionalProperties: { type: 'object', additionalProperties: true },
        description: 'Optional shallow input overrides keyed by workflow node id',
      })
      .number('timeoutMs', 'Optional override for total workflow timeout in milliseconds')
      .requiredOpenWorld('workflowId'),
  ),
];
