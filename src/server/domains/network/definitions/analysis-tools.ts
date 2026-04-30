import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { networkAuthorizationSchema } from '@server/domains/network/authorization-schema';
import { tool } from '@server/registry/tool-builder';

export const analysisTools: Tool[] = [
  tool('network_extract_auth', (t) =>
    t
      .desc(
        'Scan all captured network requests and extract authentication credentials (tokens, cookies, API keys, signatures).\n\nReturns masked values (first 6 + last 4 chars) sorted by confidence.\nSources scanned: request headers, cookies, URL query params, JSON request body.\n\nUSE THIS after capturing traffic to automatically identify:\n- Bearer tokens / JWT tokens\n- Session cookies\n- Custom auth headers (X-Token, X-Signature, X-Api-Key)\n- Signing parameters in request body or query string',
      )
      .number('minConfidence', 'Minimum confidence threshold 0-1', {
        default: 0.4,
        minimum: 0,
        maximum: 1,
      }),
  ),
  tool('network_export_har', (t) =>
    t
      .desc(
        'Export all captured network traffic as a standard HAR 1.2 file.\n\nHAR (HTTP Archive) files can be opened in:\n- Chrome DevTools (Network tab → Import)\n- Fiddler, Charles Proxy, Wireshark\n- Online HAR viewers\n\nUSE THIS to:\n- Save a complete traffic snapshot for offline analysis\n- Share captured API calls with other tools\n- Reproduce a full session outside the browser',
      )
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
      .desc(
        'Replay a previously captured network request with optional modifications.\n\nUSE THIS to:\n- Re-send an API call with modified headers (e.g., different auth token)\n- Test how a server responds to altered request bodies\n- Verify that a captured signature is still valid\n- Reproduce a specific API call without navigating again\n\nSecurity: dryRun=true (default) previews what will be sent without actually sending.\nSet dryRun=false to execute the actual request.',
      )
      .string('requestId', 'Request ID from network_get_requests to replay')
      .object(
        'headerPatch',
        { additionalProperties: { type: 'string' } },
        'Headers to add or override (key-value pairs)',
      )
      .string('bodyPatch', 'Replace the entire request body with this string')
      .string('methodOverride', 'Override the HTTP method (e.g., change POST to GET)')
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
      .boolean(
        'dryRun',
        'If true (default), only preview the request without sending. Set false to execute.',
        { default: true },
      )
      .requiredOpenWorld('requestId'),
  ),
  tool('network_intercept', (t) =>
    t
      .desc(
        `Manage response interception rules using CDP Fetch domain. Actions: add (create rule), list (show active rules), disable (remove rules).

When adding rules, matched requests receive a custom response instead of the real server response.
URL patterns support glob (* for segment, ** for any) and regex.
When all rules are removed, the CDP Fetch domain is automatically disabled.`,
      )
      .enum('action', ['add', 'list', 'disable'], 'Intercept operation')
      .string(
        'urlPattern',
        'URL pattern to match (action=add). Supports glob (* = segment, ** = any) or regex.',
      )
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
        'Batch mode: array of rule objects (action=add)',
      )
      .string('ruleId', 'ID of the rule to remove (action=disable)')
      .boolean('all', 'Set to true to remove all rules and disable interception (action=disable)', {
        default: false,
      })
      .required('action'),
  ),
  tool('network_tls_fingerprint', (t) =>
    t
      .desc('Compute TLS/HTTP fingerprint hashes for bot detection.')
      .enum('mode', ['analyze_request', 'compute_tls', 'compute_http'], 'Fingerprint mode')
      .string('requestId', 'Request ID to analyze (mode=analyze_request)')
      .array(
        'tlsVersions',
        { type: 'string' },
        'Supported TLS version hex codes in order, e.g. ["0x0303","0x0304"] (mode=compute_tls)',
      )
      .array(
        'ciphers',
        { type: 'string' },
        'Cipher suite hex codes in original order, e.g. ["1301","1302","c02b"] (mode=compute_tls)',
      )
      .array(
        'extensions',
        { type: 'string' },
        'Extension type hex codes in original order (mode=compute_tls)',
      )
      .array(
        'signatureAlgorithms',
        { type: 'string' },
        'Signature algorithm hex codes in original order, e.g. ["0403","0804"] (mode=compute_tls)',
      )
      .enum('protocol', ['tls', 'quic', 'dtls'], 'Transport protocol type', { default: 'tls' })
      .boolean('sni', 'Whether SNI (Server Name Indication) extension is present', {
        default: true,
      })
      .string('alpn', 'First ALPN value string, e.g. "h2" or "http/1.1" (mode=compute_tls)')
      .array(
        'httpHeaders',
        { type: 'string' },
        'HTTP header names in original order (mode=compute_http)',
      )
      .string('userAgent', 'User-Agent string (mode=compute_http)')
      .string(
        'httpMethod',
        'HTTP method (mode=compute_http). Common values include GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS, but custom methods are also accepted.',
        { default: 'GET' },
      )
      .string('httpVersion', 'HTTP version: "1.0", "1.1", "2", "3" (mode=compute_http)', {
        default: '1.1',
      })
      .string('cookieHeader', 'Raw Cookie header value (mode=compute_http)')
      .string('acceptLanguage', 'Accept-Language header value (mode=compute_http)')
      .boolean('includeAnalysis', 'Include detailed fingerprint breakdown', { default: true })
      .required('mode'),
  ),
  tool('network_bot_detect_analyze', (t) =>
    t
      .desc(
        'Analyze captured requests for bot detection signals (TLS fingerprint, header ordering, timing).',
      )
      .number('limit', 'Maximum requests to analyze', { default: 50, minimum: 1, maximum: 500 })
      .boolean('includeDetails', 'Include per-request analysis details', { default: false })
      .query(),
  ),
];
