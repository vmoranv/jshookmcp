import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const PROXY_TOOLS: Tool[] = [
  tool('proxy_start', (t) =>
    t
      .desc(
        'Start the Mockttp local HTTP/HTTPS proxy server. Generates a local CA if one does not exist for TLS interception.',
      )
      .number('port', 'Port to listen on. Defaults to 8080.', { default: 8080 })
      .boolean('useHttps', 'Whether to enable full HTTPS decryption. Defaults to true.', {
        default: true,
      }),
  ),
  tool('proxy_stop', (t) => t.desc('Stop the running Mockttp proxy server.').destructive()),
  tool('proxy_status', (t) =>
    t.desc('Get the current status of the proxy server and the generated CA path.').query(),
  ),
  tool('proxy_export_ca', (t) =>
    t
      .desc(
        'Export the path or raw string of the local CA root certificate so the user can install and trust it on their target test devices.',
      )
      .query(),
  ),
  tool('proxy_add_rule', (t) =>
    t
      .desc('Add a new interception, forwarding, or mocking rule to the proxy.')
      .string('action', 'Action to perform when matched (forward, mock_response, block)')
      .string('method', 'HTTP method to match (e.g. GET, POST)', { default: 'GET' })
      .string('urlPattern', 'URL pattern to match (can be string or regex format like /api/.*)')
      .number('mockStatus', 'Status code to return if action is mock_response', { default: 200 })
      .string('mockBody', 'Body to return if action is mock_response')
      .required('action'),
  ),
  tool('proxy_get_requests', (t) =>
    t
      .desc(
        'Retrieve the captured HTTP/HTTPS requests from the proxy buffer. You can filter by URL.',
      )
      .string('urlFilter', 'Optional partial URL match filter.')
      .query(),
  ),
  tool('proxy_clear_logs', (t) =>
    t.desc('Clear the captured HTTP/HTTPS requests buffer.').resettable(),
  ),
  tool('proxy_setup_adb_device', (t) =>
    t
      .desc(
        'Configure an Android device via ADB to route traffic through this proxy and inject the CA certificate.',
      )
      .string('deviceSerial', 'ADB device serial (optional if only one device is connected).'),
  ),
];
