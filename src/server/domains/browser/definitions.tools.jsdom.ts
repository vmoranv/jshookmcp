import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

/**
 * jsdom-backed headless DOM tools.
 *
 * Operate on an in-memory JSDOM session (no browser required). Each session
 * is referenced by `sessionId` returned from `browser_jsdom_parse`; sessions
 * auto-expire after 10 minutes of inactivity.
 */
export const browserJsdomToolDefinitions: Tool[] = [
  tool('browser_jsdom_parse', (t) =>
    t
      .desc(
        'Parse HTML into an in-memory JSDOM session (no browser needed). Returns a sessionId used by other browser_jsdom_* tools. Sessions auto-expire after 10 minutes.',
      )
      .string('html', 'HTML source to parse')
      .string(
        'url',
        'Document URL (used as base for relative links, cookies and scripts). Default: "about:blank"',
      )
      .string('contentType', 'Content-Type for the document. Default: "text/html"')
      .enum(
        'runScripts',
        ['none', 'outside-only', 'dangerously'],
        'Script execution mode. "none" disables all JS, "outside-only" gives a JS context without running embedded <script> tags, "dangerously" runs embedded scripts. Default: "none"',
        { default: 'none' },
      )
      .boolean(
        'includeNodeLocations',
        'Track source offsets so browser_jsdom_query can return { line, col } metadata. Default: false',
        { default: false },
      )
      .boolean(
        'pretendToBeVisual',
        'Expose requestAnimationFrame/matchMedia shims. Default: false',
        {
          default: false,
        },
      )
      .string('referrer', 'Referrer URL to expose on the document')
      .number(
        'storageQuotaBytes',
        'Storage quota in bytes for localStorage/sessionStorage. Default: 5000000',
        {
          default: 5_000_000,
        },
      )
      .required('html')
      .query(),
  ),

  tool('browser_jsdom_query', (t) =>
    t
      .desc(
        'Run a CSS selector against a JSDOM session and return matched elements with attributes, text and optional HTML or source location.',
      )
      .string('sessionId', 'Session ID returned from browser_jsdom_parse')
      .string('selector', 'CSS selector (e.g. "a[href]", ".item > span")')
      .number('maxResults', 'Maximum number of matches to return. Default: 50', { default: 50 })
      .array(
        'attributes',
        { type: 'string' },
        'Restrict returned attributes to this whitelist. Empty = return all attributes.',
      )
      .boolean('includeText', 'Include trimmed textContent in each result. Default: true', {
        default: true,
      })
      .boolean('includeHtml', 'Include outerHTML in each result. Default: false', {
        default: false,
      })
      .boolean(
        'includeLocation',
        'Include parser source offsets (requires the session to be parsed with includeNodeLocations=true). Default: false',
        { default: false },
      )
      .required('sessionId', 'selector')
      .query(),
  ),

  tool('browser_jsdom_execute', (t) =>
    t
      .desc(
        'Evaluate JavaScript inside a JSDOM session. Requires the session to be parsed with runScripts="outside-only" or "dangerously". Console output is captured and returned.',
      )
      .string('sessionId', 'Session ID returned from browser_jsdom_parse')
      .string('code', 'JavaScript expression or statements to evaluate in the window context')
      .number('timeoutMs', 'Advisory timeout hint in ms (reported in response). Default: 5000', {
        default: 5000,
      })
      .required('sessionId', 'code'),
  ),

  tool('browser_jsdom_serialize', (t) =>
    t
      .desc(
        'Serialize a JSDOM session back to HTML. Supports whole-document output or a CSS-selector fragment, with optional pretty-print.',
      )
      .string('sessionId', 'Session ID returned from browser_jsdom_parse')
      .string(
        'selector',
        "CSS selector to serialize only that element's outerHTML. Empty = full document.",
      )
      .boolean('pretty', 'Insert newlines between tag boundaries for readability. Default: false', {
        default: false,
      })
      .required('sessionId')
      .query(),
  ),

  tool('browser_jsdom_cookies', (t) =>
    t
      .desc(
        'Inspect or manage cookies on a JSDOM session\'s cookie jar. Actions: "get" (list), "set" (add), "clear" (remove all).',
      )
      .string('sessionId', 'Session ID returned from browser_jsdom_parse')
      .enum('action', ['get', 'set', 'clear'], 'Cookie operation', { default: 'get' })
      .string('url', 'URL scope for cookie operations. Default: session URL.')
      .object(
        'cookie',
        {
          name: { type: 'string', description: 'Cookie name' },
          value: { type: 'string', description: 'Cookie value' },
          domain: { type: 'string', description: 'Cookie domain' },
          path: { type: 'string', description: 'Cookie path' },
          expires: { type: 'string', description: 'Expiration as HTTP date string' },
          httpOnly: { type: 'boolean', description: 'HttpOnly flag' },
          secure: { type: 'boolean', description: 'Secure flag' },
          sameSite: { type: 'string', description: 'SameSite: Strict | Lax | None' },
          raw: {
            type: 'string',
            description: 'Raw Set-Cookie string (overrides other fields if present)',
          },
        },
        'Cookie definition for action="set"',
      )
      .requiredOpenWorld('sessionId'),
  ),
];
