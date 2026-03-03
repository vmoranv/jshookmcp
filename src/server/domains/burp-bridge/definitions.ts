import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const burpBridgeTools: Tool[] = [
  {
    name: 'burp_proxy_status',
    description:
      'Check the status of the Burp Suite proxy adapter.\n\n' +
      'Returns connection health, Burp version, and available features.\n' +
      'The adapter must be running as a local HTTP service (default: http://127.0.0.1:18443).\n\n' +
      'Use this before other burp_* tools to verify connectivity.',
    inputSchema: {
      type: 'object',
      properties: {
        endpoint: {
          type: 'string',
          description: 'Burp adapter endpoint URL (default: from config or http://127.0.0.1:18443)',
        },
      },
    },
  },

  {
    name: 'intercept_and_replay_to_burp',
    description:
      'Send a captured network request to Burp Suite for further analysis.\n\n' +
      'Takes a request captured by network_get_requests (by requestId) and replays it ' +
      'through the Burp adapter. Supports sending to Proxy history or Repeater.\n\n' +
      'Optionally patch headers or body before sending.\n\n' +
      'Example:\n' +
      '  intercept_and_replay_to_burp({ requestId: "req-123", target: "repeater" })',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: {
          type: 'string',
          description: 'Request ID from network_get_requests',
        },
        target: {
          type: 'string',
          enum: ['proxy', 'repeater'],
          description: 'Where to send in Burp (default: proxy)',
          default: 'proxy',
        },
        headerPatch: {
          type: 'object',
          description: 'Headers to add/override before sending',
          additionalProperties: { type: 'string' },
        },
        bodyPatch: {
          type: 'string',
          description: 'Replace request body before sending',
        },
        endpoint: {
          type: 'string',
          description: 'Burp adapter endpoint URL',
        },
      },
      required: ['requestId'],
    },
  },

  {
    name: 'import_har_from_burp',
    description:
      'Import a HAR file exported from Burp Suite into the jshookmcp network store.\n\n' +
      'After import, captured requests become available to network_get_requests, ' +
      'network_extract_auth, and other network tools.\n\n' +
      'Optionally filter by URL pattern, method, or status code during import.',
    inputSchema: {
      type: 'object',
      properties: {
        harPath: {
          type: 'string',
          description: 'Path to the HAR file exported from Burp',
        },
        urlFilter: {
          type: 'string',
          description: 'Regex pattern to filter requests by URL',
        },
        methodFilter: {
          type: 'array',
          items: { type: 'string' },
          description: 'Only import requests with these HTTP methods',
        },
        statusFilter: {
          type: 'array',
          items: { type: 'number' },
          description: 'Only import requests with these status codes',
        },
      },
      required: ['harPath'],
    },
  },

  {
    name: 'diff_har',
    description:
      'Compare two HAR files and identify differences in requests/responses.\n\n' +
      'Useful for comparing a successful vs. failed registration flow, ' +
      'before/after patching, or detecting anti-bot parameter changes.\n\n' +
      'Returns structured diff: added/removed/modified requests, ' +
      'header differences, body hash differences, timing changes.\n\n' +
      'Example:\n' +
      '  diff_har({ baseHarPath: "success.har", targetHarPath: "failure.har" })',
    inputSchema: {
      type: 'object',
      properties: {
        baseHarPath: {
          type: 'string',
          description: 'Path to the baseline HAR file',
        },
        targetHarPath: {
          type: 'string',
          description: 'Path to the target HAR file to compare against',
        },
        compareFields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fields to compare (default: ["url","method","status","headers","bodyHash"])',
          default: ['url', 'method', 'status', 'headers', 'bodyHash'],
        },
        ignoreHeaders: {
          type: 'array',
          items: { type: 'string' },
          description: 'Header names to exclude from comparison (e.g. ["date","x-request-id"])',
        },
        urlFilter: {
          type: 'string',
          description: 'Only compare requests matching this URL regex pattern',
        },
      },
      required: ['baseHarPath', 'targetHarPath'],
    },
  },

  {
    name: 'burp_send_to_repeater',
    description:
      'Construct and send a raw HTTP request to Burp Repeater.\n\n' +
      'Unlike intercept_and_replay_to_burp (which replays captured requests), ' +
      'this tool lets you craft a request from scratch.\n\n' +
      'Useful for testing modified payloads, authentication bypass, or parameter tampering.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full URL to send',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
          description: 'HTTP method (default: GET)',
          default: 'GET',
        },
        headers: {
          type: 'object',
          description: 'Request headers',
          additionalProperties: { type: 'string' },
        },
        body: {
          type: 'string',
          description: 'Request body',
        },
        endpoint: {
          type: 'string',
          description: 'Burp adapter endpoint URL',
        },
      },
      required: ['url'],
    },
  },
];
