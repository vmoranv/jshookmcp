import type { Tool } from '@modelcontextprotocol/server';
import { tool } from '@server/registry/tool-builder';

export const PROXY_TOOLS: Tool[] = [
  tool('proxy_start', (t) =>
    t
      .desc('Start the local HTTP/HTTPS interception proxy with optional TLS.')
      .number('port', 'Listen port.', { default: 8080 })
      .boolean('useHttps', 'Enable HTTPS interception.', {
        default: true,
      })
      .boolean(
        'capture',
        'Capture request/response metadata and body previews. Set false to disable capture entirely.',
        { default: true },
      ),
  ),
  tool('proxy_stop', (t) => t.desc('Stop the proxy and release all active rules.').destructive()),
  tool('proxy_status', (t) =>
    t.desc('Report proxy status, listen port, and CA certificate path.').query(),
  ),
  tool('proxy_export_ca', (t) => t.desc('Read the proxy CA certificate.').query()),
  tool('proxy_add_rule', (t) =>
    t
      .desc('Add an interception rule: forward, mock_response, redirect, or block.')
      .string('action', 'Rule action: forward, mock_response, redirect, or block.')
      .string('method', 'HTTP method to match. Use ANY, ALL, or * to match every method.', {
        default: 'GET',
      })
      .string('urlPattern', 'URL matcher string or regex literal.')
      .string(
        'targetUrl',
        'Target upstream root URL for redirect (no path; the original request path is preserved). Required when action=redirect.',
      )
      .number('mockStatus', 'Response status for mock_response.', { default: 200 })
      .string('mockBody', 'Response body for mock_response.')
      .number(
        'delayMs',
        'Inject a delay (milliseconds) before the rule action fires. 0 = no delay.',
        {
          default: 0,
        },
      )
      .object(
        'forwardOptions',
        {
          transformRequest: {
            type: 'object',
            description:
              'Optional request rewrite applied on passthrough. Mutually exclusive with callback mode (not exposed).',
            properties: {
              replaceMethod: { type: 'string', description: 'Replacement HTTP method.' },
              updateHeaders: {
                type: 'object',
                description: 'Headers merged into the request; a null value removes the header.',
                additionalProperties: { type: ['string', 'null'] },
              },
              replaceHeaders: {
                type: 'object',
                description: 'Headers that completely replace the request headers.',
                additionalProperties: { type: 'string' },
              },
              replaceBody: {
                type: 'string',
                description: 'String that replaces the request body entirely.',
              },
              matchReplaceBody: {
                type: 'array',
                description:
                  'Match/replace pairs applied to the request body in order. Each entry is [match, replacement]; match is a plain string or a /pattern/flags regex literal, replacement supports $1-style placeholders.',
                items: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 2,
                  items: [
                    {
                      type: 'string',
                      description: 'Plain string or /pattern/flags regex literal.',
                    },
                    {
                      type: 'string',
                      description: 'Replacement string (supports $1, $2, ...).',
                    },
                  ],
                },
              },
              updateJsonBody: {
                type: 'object',
                description:
                  'Object recursively merged into a JSON request body; undefined values remove keys. Requests with invalid JSON fail.',
                additionalProperties: true,
              },
            },
          },
          transformResponse: {
            type: 'object',
            description: 'Optional response rewrite applied on passthrough.',
            properties: {
              replaceStatus: {
                type: 'integer',
                minimum: 100,
                maximum: 599,
                description: 'Replacement response status code (100-599).',
              },
              updateHeaders: {
                type: 'object',
                description: 'Headers merged into the response; a null value removes the header.',
                additionalProperties: { type: ['string', 'null'] },
              },
              replaceHeaders: {
                type: 'object',
                description: 'Headers that completely replace the response headers.',
                additionalProperties: { type: 'string' },
              },
              replaceBody: {
                type: 'string',
                description: 'String that replaces the response body entirely.',
              },
              matchReplaceBody: {
                type: 'array',
                description:
                  'Match/replace pairs applied to the response body in order. Each entry is [match, replacement]; match is a plain string or a /pattern/flags regex literal, replacement supports $1-style placeholders.',
                items: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 2,
                  items: [
                    {
                      type: 'string',
                      description: 'Plain string or /pattern/flags regex literal.',
                    },
                    {
                      type: 'string',
                      description: 'Replacement string (supports $1, $2, ...).',
                    },
                  ],
                },
              },
              updateJsonBody: {
                type: 'object',
                description:
                  'Object recursively merged into a JSON response body; undefined values remove keys. Responses with invalid JSON fail.',
                additionalProperties: true,
              },
            },
          },
        },
        'Forward-only rewrite options. Only honored when action=forward; ignored otherwise. Omit for plain passthrough.',
      )
      .object(
        'chainUpstream',
        {
          proxyUrl: {
            type: 'string',
            description:
              'Upstream proxy URL to forward traffic through (e.g., http://proxy:8080, socks5://proxy:1080).',
          },
          noProxy: {
            type: 'array',
            description:
              'Hostnames whose traffic should bypass the upstream proxy (e.g., localhost, *.internal).',
            items: { type: 'string' },
          },
          trustedCAs: {
            type: 'array',
            description: 'CA certificates trusted for TLS connections to the upstream proxy.',
            items: {
              type: 'object',
              properties: {
                cert: { type: 'string', description: 'PEM certificate string.' },
                certPath: { type: 'string', description: 'Path to a PEM certificate file.' },
              },
            },
          },
        },
        'Optional upstream proxy to chain through. Forward/reply traffic is routed via this proxy before reaching the target.',
      )
      .object(
        'callbackScript',
        {
          path: {
            type: 'string',
            description:
              'Path to a JS module exporting beforeRequest and/or beforeResponse functions.',
          },
        },
        'Path to a callback script module. The script must export beforeRequest(req) and/or beforeResponse(res, req) functions. Mutually exclusive with transformRequest/transformResponse.',
      )
      .required('action'),
  ),
  tool('proxy_remove_rule', (t) =>
    t
      .desc(
        'Remove a single proxy interception rule by endpointId. Returns the removed rule record.',
      )
      .string('endpointId', 'The endpointId returned when the rule was added.')
      .required('endpointId'),
  ),
  tool('proxy_list_rules', (t) =>
    t.desc('List active proxy interception rules tracked by this handler.').query(),
  ),
  tool('proxy_clear_rules', (t) =>
    t.desc('Clear active proxy interception rules while keeping the proxy running.').resettable(),
  ),
  tool('proxy_get_requests', (t) =>
    t
      .desc('Read captured proxy request/response metadata, body previews, and timing.')
      .string('urlFilter', 'Optional URL filter.')
      .query(),
  ),
  tool('proxy_clear_logs', (t) =>
    t.desc('Clear all captured proxy request/response logs.').resettable(),
  ),
  tool('proxy_setup_adb_device', (t) =>
    t
      .desc('Configure an Android device to use the proxy.')
      .string('deviceSerial', 'ADB device serial.'),
  ),
];
