import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const workflowToolDefinitions: Tool[] = [
  tool('js_bundle_search', (t) =>
    t
      .desc(
        'Fetch a remote JavaScript bundle and search it with multiple named regex patterns in a single call.\n\nFeatures over bundle_search script:\n- Server-side fetch (no browser CORS constraints)\n- Bundle caching (5-min TTL, keyed by URL) — avoids re-downloading 1MB+ files\n- SVG/base64 false-positive filtering (`stripNoise: true` by default)\n- Per-pattern independent context window (`contextBefore`/`contextAfter`)\n- Up to `maxMatches` hits per pattern\n\nExample:\n  js_bundle_search({\n    url: "https://assets.example.com/main.js",\n    patterns: [\n      { name: "tier_values",   regex: "subscription.plus|user_tier" },\n      { name: "payment_apis",  regex: "/api/v1/payment/[a-z_]+" },\n      { name: "setSubscription", regex: "setSubscriptionPlus\\\\([^)]{0,80}\\\\)" }\n    ]\n  })',
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
      .number('maxMatches', 'Maximum matches to return per pattern', { default: 10 })
      .requiredOpenWorld('url', 'patterns'),
  ),
  tool('page_script_register', (t) =>
    t
      .desc(
        'Register a named reusable JavaScript snippet in the Script Library.\n\nCore ships built-in snippets such as `auth_extract`, `bundle_search`, `react_fill_form`, and `dom_find_upgrade_buttons`.\n\nRegistered scripts are executed with `page_script_run`. Scripts may reference `__params__` (set at call time via page_script_run params).',
      )
      .string('name', 'Unique script name (e.g. "my_extractor")')
      .string(
        'code',
        'JavaScript expression/IIFE to register. Use `typeof __params__ !== "undefined" ? __params__ : {}` to safely access runtime parameters.',
      )
      .string('description', 'Optional human-readable description of the script')
      .required('name', 'code'),
  ),
  tool('page_script_run', (t) =>
    t
      .desc(
        'Execute a named script from the Script Library in the current page context.\n\nOptionally inject runtime parameters accessible as `__params__` inside the script.\n\nExample:\n  page_script_run({ name: "bundle_search", params: { url: "https://cdn.main.js", patterns: ["tier", "subscription"] } })\n  page_script_run({ name: "auth_extract" })',
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
      .desc(
        'Probe multiple API endpoints in a single browser-context fetch burst.\n\nAuto-injects Bearer token from localStorage[token] / localStorage[active_token]. Returns status codes, content types, and response snippets for matching statuses. Skips HTML responses (login-redirect false-positives).\n\nReplaces 5–30 individual page_evaluate fetch calls with one tool call.\n\n**ALWAYS start with OpenAPI/Swagger discovery paths first** — a single 200 response gives you the full API schema:\n  "/docs", "/openapi.json", "/api/docs", "/swagger.json", "/api/v1/openapi.json", "/api/openapi.json"\n\nExample:\n  api_probe_batch({ baseUrl: "https://chat.qwen.ai", paths: ["/docs", "/openapi.json", "/api/v1/users/me", "/api/v1/chats/", "/api/admin/users"] })',
      )
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
      .number('maxBodySnippetLength', 'Max characters per response body snippet', { default: 500 })
      .boolean(
        'autoInjectAuth',
        'Auto-inject Bearer token from localStorage (token / active_token / access_token).',
        { default: true },
      )
      .requiredOpenWorld('baseUrl', 'paths'),
  ),
  tool('list_extension_workflows', (t) =>
    t
      .desc(
        'List runtime-loaded extension workflows discovered from plugins/ or workflows/ directories, including metadata needed before execution.',
      )
      .query(),
  ),
  tool('run_extension_workflow', (t) =>
    t
      .desc(
        'Execute a runtime-loaded extension workflow contract by workflowId. Supports config overrides, per-node input overrides, and an optional timeout override.',
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
