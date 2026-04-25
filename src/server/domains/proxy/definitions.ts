import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const PROXY_TOOLS: Tool[] = [
  tool('proxy_start', (t) =>
    t
      .desc('Start the local HTTP/HTTPS proxy.')
      .number('port', 'Listen port.', { default: 8080 })
      .boolean('useHttps', 'Enable HTTPS interception.', {
        default: true,
      }),
  ),
  tool('proxy_stop', (t) => t.desc('Stop the proxy.').destructive()),
  tool('proxy_status', (t) => t.desc('Read proxy status and CA path.').query()),
  tool('proxy_export_ca', (t) => t.desc('Read the proxy CA certificate.').query()),
  tool('proxy_add_rule', (t) =>
    t
      .desc('Add a proxy rule.')
      .string('action', 'Rule action: forward, mock_response, or block.')
      .string('method', 'HTTP method to match.', { default: 'GET' })
      .string('urlPattern', 'URL matcher string or regex literal.')
      .number('mockStatus', 'Response status for mock_response.', { default: 200 })
      .string('mockBody', 'Response body for mock_response.')
      .required('action'),
  ),
  tool('proxy_get_requests', (t) =>
    t.desc('Read captured proxy requests.').string('urlFilter', 'Optional URL filter.').query(),
  ),
  tool('proxy_clear_logs', (t) => t.desc('Clear captured proxy logs.').resettable()),
  tool('proxy_setup_adb_device', (t) =>
    t
      .desc('Configure an Android device to use the proxy.')
      .string('deviceSerial', 'ADB device serial.'),
  ),
];
