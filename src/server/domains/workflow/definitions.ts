import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const workflowToolDefinitions: Tool[] = [
  {
    name: 'web_api_capture_session',
    description:
      'Full-chain web API capture workflow: navigate → inject interceptors → perform actions → collect requests → extract auth → optionally export HAR.\n\nThis is a composite tool that replaces the following manual sequence:\n1. network_enable\n2. console_inject_fetch_interceptor + console_inject_xhr_interceptor\n3. page_navigate\n4. (perform actions)\n5. network_get_requests\n6. network_extract_auth\n7. network_export_har (optional)\n\n**Captured fetch requests are auto-persisted to localStorage.__capturedAPIs** — survives context compression.\n**Set exportHar: true to persist all traffic to disk** before context is compressed.\n\nUSE THIS when you need to capture the complete API surface of a page in one step.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to navigate to',
        },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle', 'networkidle2'],
          description: 'Navigation wait condition (default: domcontentloaded)',
          default: 'domcontentloaded',
        },
        actions: {
          type: 'array',
          description: 'Optional sequence of actions to perform after navigation (click, type, wait)',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['click', 'type', 'wait', 'evaluate'] },
              selector: { type: 'string' },
              text: { type: 'string' },
              expression: { type: 'string' },
              delayMs: { type: 'number' },
            },
            required: ['type'],
          },
        },
        exportHar: {
          type: 'boolean',
          description: 'Export captured traffic as HAR after collection (default: true — always persists to disk to survive context compression)',
          default: true,
        },
        harOutputPath: {
          type: 'string',
          description: 'File path for HAR export (default: auto-generated timestamped path artifacts/har/jshhook-capture-<ts>.har)',
        },
        waitAfterActionsMs: {
          type: 'number',
          description: 'Milliseconds to wait after all actions before collecting (default: 1500)',
          default: 1500,
        },
      },
      required: ['url'],
    },
  },

  {
    name: 'js_bundle_search',
    description:
      'Fetch a remote JavaScript bundle and search it with multiple named regex patterns in a single call.\n\nFeatures over bundle_search script:\n- Server-side fetch (no browser CORS constraints)\n- Bundle caching (5-min TTL, keyed by URL) — avoids re-downloading 1MB+ files\n- SVG/base64 false-positive filtering (`stripNoise: true` by default)\n- Per-pattern independent context window (`contextBefore`/`contextAfter`)\n- Up to `maxMatches` hits per pattern\n\nExample:\n  js_bundle_search({\n    url: "https://assets.alicdn.com/.../main.js",\n    patterns: [\n      { name: "tier_values",   regex: "subscription.plus|user_tier" },\n      { name: "payment_apis",  regex: "/api/v1/payment/[a-z_]+" },\n      { name: "setSubscription", regex: "setSubscriptionPlus\\\\([^)]{0,80}\\\\)" }\n    ]\n  })',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Remote URL of the JavaScript bundle to analyze',
        },
        patterns: {
          type: 'array',
          description: 'Named regex patterns to search for',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Human-readable label for this pattern' },
              regex: { type: 'string', description: 'JavaScript regex string (no /.../ delimiters)' },
              contextBefore: { type: 'number', description: 'Characters of context before match (default: 80)' },
              contextAfter: { type: 'number', description: 'Characters of context after match (default: 80)' },
            },
            required: ['name', 'regex'],
          },
        },
        cacheBundle: {
          type: 'boolean',
          description: 'Cache the bundle for 5 minutes to avoid re-downloads (default: true)',
          default: true,
        },
        stripNoise: {
          type: 'boolean',
          description: 'Skip matches inside SVG path data or base64 blobs (default: true)',
          default: true,
        },
        maxMatches: {
          type: 'number',
          description: 'Maximum matches to return per pattern (default: 10)',
          default: 10,
        },
      },
      required: ['url', 'patterns'],
    },
  },

  {
    name: 'page_script_register',
    description:
      'Register a named reusable JavaScript snippet in the Script Library.\n\nBuilt-in snippets available without registration:\n- `auth_extract`  — pull JWT/tokens from localStorage and cookies\n- `bundle_search` — fetch a CDN JS bundle and search it with regexes (params: { url, patterns })\n- `react_fill_form` — fill React controlled inputs (params: { fields: { selector: value } })\n- `dom_find_upgrade_buttons` — scan for upgrade/subscription UI elements\n\nRegistered scripts are executed with `page_script_run`. Scripts may reference `__params__` (set at call time via page_script_run params).',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Unique script name (e.g. "my_extractor")',
        },
        code: {
          type: 'string',
          description:
            'JavaScript expression/IIFE to register. Use `typeof __params__ !== "undefined" ? __params__ : {}` to safely access runtime parameters.',
        },
        description: {
          type: 'string',
          description: 'Optional human-readable description of the script',
        },
      },
      required: ['name', 'code'],
    },
  },

  {
    name: 'page_script_run',
    description:
      'Execute a named script from the Script Library in the current page context.\n\nOptionally inject runtime parameters accessible as `__params__` inside the script.\n\nExample:\n  page_script_run({ name: "bundle_search", params: { url: "https://cdn.../main.js", patterns: ["tier", "subscription"] } })\n  page_script_run({ name: "auth_extract" })',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Script name to run (built-in or registered)',
        },
        params: {
          type: 'object',
          description: 'Optional parameters injected as __params__ (must be JSON-serializable)',
          additionalProperties: true,
        },
      },
      required: ['name'],
    },
  },

  {
    name: 'api_probe_batch',
    description:
      'Probe multiple API endpoints in a single browser-context fetch burst.\n\nAuto-injects Bearer token from localStorage[token] / localStorage[active_token]. Returns status codes, content types, and response snippets for matching statuses. Skips HTML responses (login-redirect false-positives).\n\nReplaces 5–30 individual page_evaluate fetch calls with one tool call.\n\n**ALWAYS start with OpenAPI/Swagger discovery paths first** — a single 200 response gives you the full API schema:\n  "/docs", "/openapi.json", "/api/docs", "/swagger.json", "/api/v1/openapi.json", "/api/openapi.json"\n\nExample:\n  api_probe_batch({ baseUrl: "https://chat.qwen.ai", paths: ["/docs", "/openapi.json", "/api/v1/users/me", "/api/v1/chats/", "/api/admin/users"] })',
    inputSchema: {
      type: 'object',
      properties: {
        baseUrl: {
          type: 'string',
          description: 'Base URL prefix (e.g. "https://chat.qwen.ai") — trailing slash will be stripped',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths to probe (e.g. ["/api/v1/users", "/api/v1/chats"])',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
          description: 'HTTP method for all probes (default: GET)',
          default: 'GET',
        },
        headers: {
          type: 'object',
          description: 'Additional HTTP headers to include in all requests',
          additionalProperties: { type: 'string' },
        },
        bodyTemplate: {
          type: 'string',
          description: 'JSON body string to send for POST/PUT/PATCH requests (optional)',
        },
        includeBodyStatuses: {
          type: 'array',
          items: { type: 'number' },
          description: 'Status codes for which to include response body snippet (default: [200, 201, 204])',
        },
        maxBodySnippetLength: {
          type: 'number',
          description: 'Max characters per response body snippet (default: 500)',
          default: 500,
        },
        autoInjectAuth: {
          type: 'boolean',
          description:
            'Auto-inject Bearer token from localStorage (token / active_token / access_token). Default: true.',
          default: true,
        },
      },
      required: ['baseUrl', 'paths'],
    },
  },

  {
    name: 'register_account_flow',
    description:
      'Automated account registration flow with email verification.\n\nHandles the full flow:\n1. Navigate to registration page\n2. Fill in account fields (username, email, password, etc.)\n3. Submit registration form\n4. Open temporary email provider in a new tab\n5. Wait for and extract verification link/code\n6. Navigate to verification URL or fill in the code\n7. Return complete flow result\n\nUSE THIS instead of manually coordinating page_type + page_click + tab_workflow + dom_find_by_text for registration flows.',
    inputSchema: {
      type: 'object',
      properties: {
        registerUrl: {
          type: 'string',
          description: 'URL of the registration page',
        },
        fields: {
          type: 'object',
          description: 'Form field values keyed by input name attribute (e.g. {"email": "...", "password": "..."})',
          additionalProperties: { type: 'string' },
        },
        submitSelector: {
          type: 'string',
          description: 'CSS selector for the submit button (default: "button[type=\'submit\']")',
          default: "button[type='submit']",
        },
        emailProviderUrl: {
          type: 'string',
          description: 'URL of the temporary email provider page (e.g. https://www.linshiyouxiang.net)',
        },
        emailSelector: {
          type: 'string',
          description: 'CSS selector for the current email address element in the provider page',
        },
        verificationLinkPattern: {
          type: 'string',
          description: 'URL pattern to identify the verification link in emails (e.g. "/auth/activate", "/verify")',
        },
        checkboxSelectors: {
          type: 'array',
          items: { type: 'string' },
          description: 'CSS selectors for checkboxes to click before submitting (terms of service, etc.)',
        },
        timeoutMs: {
          type: 'number',
          description: 'Total timeout for the entire flow in milliseconds (default: 60000)',
          default: 60000,
        },
      },
      required: ['registerUrl', 'fields'],
    },
  },
];
