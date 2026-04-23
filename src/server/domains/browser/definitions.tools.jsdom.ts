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
      .desc('Parse HTML into an in-memory JSDOM session. No browser needed.')
      .string('html', 'HTML source')
      .string('url', 'Document URL')
      .string('contentType', 'Content-Type')
      .enum('runScripts', ['none', 'outside-only', 'dangerously'], 'Script execution mode', {
        default: 'none',
      })
      .boolean('includeNodeLocations', 'Track source offsets', { default: false })
      .boolean('pretendToBeVisual', 'Expose rAF/matchMedia shims', { default: false })
      .string('referrer', 'Referrer URL')
      .number('storageQuotaBytes', 'Storage quota bytes', { default: 5_000_000 })
      .required('html')
      .query(),
  ),

  tool('browser_jsdom_query', (t) =>
    t
      .desc('Query a JSDOM session with a CSS selector.')
      .string('sessionId', 'Session ID')
      .string('selector', 'CSS selector')
      .number('maxResults', 'Max matches', { default: 50 })
      .array('attributes', { type: 'string' }, 'Attribute whitelist')
      .boolean('includeText', 'Include textContent', { default: true })
      .boolean('includeHtml', 'Include outerHTML', { default: false })
      .boolean('includeLocation', 'Include source offsets', { default: false })
      .required('sessionId', 'selector')
      .query(),
  ),

  tool('browser_jsdom_execute', (t) =>
    t
      .desc('Evaluate JS inside a JSDOM session.')
      .string('sessionId', 'Session ID')
      .string('code', 'JavaScript code')
      .number('timeoutMs', 'Timeout hint ms', { default: 5000 })
      .required('sessionId', 'code'),
  ),

  tool('browser_jsdom_serialize', (t) =>
    t
      .desc('Serialize a JSDOM session to HTML.')
      .string('sessionId', 'Session ID')
      .string('selector', 'CSS selector for a fragment')
      .boolean('pretty', 'Pretty-print', { default: false })
      .required('sessionId')
      .query(),
  ),

  tool('browser_jsdom_cookies', (t) =>
    t
      .desc('Manage cookies on a JSDOM session. Isolated from the attached browser.')
      .string('sessionId', 'Session ID')
      .enum('action', ['get', 'set', 'clear'], 'Action', { default: 'get' })
      .string('url', 'URL scope')
      .object(
        'cookie',
        {
          name: { type: 'string', description: 'Name' },
          value: { type: 'string', description: 'Value' },
          domain: { type: 'string', description: 'Domain' },
          path: { type: 'string', description: 'Path' },
          expires: { type: 'string', description: 'Expiration' },
          httpOnly: { type: 'boolean', description: 'HttpOnly' },
          secure: { type: 'boolean', description: 'Secure' },
          sameSite: { type: 'string', description: 'SameSite' },
          raw: { type: 'string', description: 'Raw Set-Cookie string' },
        },
        'Cookie (action=set)',
      )
      .destructive()
      .requiredOpenWorld('sessionId'),
  ),
];
