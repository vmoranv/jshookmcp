import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { networkAuthorizationSchema } from '@server/domains/network/authorization-schema';
import { tool } from '@server/registry/tool-builder';

export const analysisTools: Tool[] = [
  tool('network_extract_auth', (t) =>
    t
      .desc('Extract authentication data from captured network requests.')
      .number('minConfidence', 'Minimum confidence threshold 0-1', {
        default: 0.4,
        minimum: 0,
        maximum: 1,
      }),
  ),
  tool('network_export_har', (t) =>
    t
      .desc('Export captured network traffic as HAR.')
      .string('outputPath', 'File path to write the HAR file. If omitted, returns HAR as JSON.')
      .boolean(
        'includeBodies',
        'Include response bodies in the HAR (may be slow for large captures). Default: false',
        { default: false },
      )
      .openWorld(),
  ),
  tool('network_replay_request', (t) =>
    t
      .desc('Replay a captured network request with optional changes.')
      .string('requestId', 'Request ID from network_get_requests to replay')
      .object(
        'headerPatch',
        { additionalProperties: { type: 'string' } },
        'Headers to add or override (key-value pairs)',
      )
      .object(
        'sessionProfile',
        {
          cookies: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: { type: 'string' },
                domain: { type: 'string' },
                path: { type: 'string' },
                expires: { type: 'number' },
                httpOnly: { type: 'boolean' },
                secure: { type: 'boolean' },
                sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'] },
              },
              required: ['name', 'value'],
            },
          },
          userAgent: { type: 'string' },
          acceptLanguage: { type: 'string' },
          referer: { type: 'string' },
          clientHints: {
            type: 'object',
            properties: {
              'sec-ch-ua': { type: 'string' },
              'sec-ch-ua-mobile': { type: 'string' },
              'sec-ch-ua-platform': { type: 'string' },
              'sec-ch-ua-full-version-list': { type: 'string' },
            },
          },
          platform: { type: 'string' },
          origin: { type: 'string' },
          collectedAt: { type: 'number' },
          ttlSec: { type: 'number' },
        },
        'Inject browser cookies, User-Agent and Accept-Language from a captured session into the replay.',
      )
      .string('bodyPatch', 'Replace the entire request body with this string')
      .string('methodOverride', 'Override the HTTP method')
      .string('urlOverride', 'Override the request URL')
      .object(
        'authorization',
        networkAuthorizationSchema,
        'Request-scoped authorization policy for private-network or insecure-HTTP replay. Use exact hosts/CIDRs instead of process-wide bypasses.',
      )
      .string(
        'authorizationCapability',
        'Base64url-encoded JSON capability for request-scoped authorization. Payload fields mirror authorization and must include requestId.',
      )
      .number('timeoutMs', 'Request timeout in milliseconds', {
        default: 30000,
        minimum: 1000,
        maximum: 120000,
      })
      .boolean('dryRun', 'Preview the request without sending it', { default: true })
      .requiredOpenWorld('requestId'),
  ),
  tool('network_intercept', (t) =>
    t
      .desc('Manage network interception rules.')
      .enum('action', ['add', 'list', 'disable'], 'Intercept operation')
      .string('urlPattern', 'URL pattern to match')
      .enum('urlPatternType', ['glob', 'regex'], 'How to interpret urlPattern', { default: 'glob' })
      .enum(
        'stage',
        ['Request', 'Response'],
        'Intercept stage. Response (default) intercepts after server responds.',
        { default: 'Response' },
      )
      .number('responseCode', 'HTTP status code to return', {
        default: 200,
        minimum: 100,
        maximum: 599,
      })
      .object(
        'responseHeaders',
        { additionalProperties: { type: 'string' } },
        'Custom response headers as key-value pairs.',
      )
      .string('responseBody', 'Custom response body string.')
      .array(
        'rules',
        {
          type: 'object',
          properties: {
            urlPattern: { type: 'string' },
            urlPatternType: { type: 'string', enum: ['glob', 'regex'] },
            stage: { type: 'string', enum: ['Request', 'Response'] },
            responseCode: { type: 'number' },
            responseHeaders: { type: 'object', additionalProperties: { type: 'string' } },
            responseBody: { type: 'string' },
          },
          required: ['urlPattern'],
        },
        'Rule objects to add',
      )
      .string('ruleId', 'Rule ID to remove')
      .boolean('all', 'Remove all rules', {
        default: false,
      })
      .required('action'),
  ),
  tool('network_tls_fingerprint', (t) =>
    t
      .desc('Compute TLS/HTTP fingerprint hashes for bot detection.')
      .enum('mode', ['analyze_request', 'compute_tls', 'compute_http'], 'Fingerprint mode')
      .string('requestId', 'Request ID to analyze')
      .array('tlsVersions', { type: 'string' }, 'TLS version codes in order')
      .array('ciphers', { type: 'string' }, 'Cipher suite codes in order')
      .array('extensions', { type: 'string' }, 'Extension type codes in order')
      .array('signatureAlgorithms', { type: 'string' }, 'Signature algorithm codes in order')
      .enum('protocol', ['tls', 'quic', 'dtls'], 'Transport protocol type', { default: 'tls' })
      .boolean('sni', 'Whether SNI (Server Name Indication) extension is present', {
        default: true,
      })
      .string('alpn', 'ALPN value')
      .array('httpHeaders', { type: 'string' }, 'HTTP header names in order')
      .string('userAgent', 'User-Agent value')
      .string('httpMethod', 'HTTP method', { default: 'GET' })
      .string('httpVersion', 'HTTP version', {
        default: '1.1',
      })
      .string('cookieHeader', 'Cookie header value')
      .string('acceptLanguage', 'Accept-Language header value')
      .boolean('includeAnalysis', 'Include detailed fingerprint breakdown', { default: true })
      .required('mode'),
  ),
  tool('network_bot_detect_analyze', (t) =>
    t
      .desc('Analyze captured requests for bot-detection signals.')
      .number('limit', 'Maximum requests to analyze', { default: 50, minimum: 1, maximum: 500 })
      .boolean('includeDetails', 'Include per-request analysis details', { default: false })
      .query(),
  ),
];
