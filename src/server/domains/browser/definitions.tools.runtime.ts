import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const browserRuntimeTools: Tool[] = [
  tool('get_detailed_data', (t) =>
    t
      .desc('Retrieve large data by detailId.')
      .string('detailId', 'Detail ID from previous response')
      .string('path', 'Path to specific nested data')
      .required('detailId')
      .query(),
  ),
  tool('browser_launch', (t) =>
    t
      .desc('Launch or connect to a browser.')
      .enum('driver', ['chrome', 'camoufox'], 'Browser driver', { default: 'chrome' })
      .boolean('headless', 'Run headless', { default: false })
      .enum('os', ['windows', 'macos', 'linux'], 'OS fingerprint (camoufox)', {
        default: 'windows',
      })
      .enum('mode', ['launch', 'connect'], 'Launch or connect', { default: 'launch' })
      .string('browserURL', 'Browser debug endpoint URL')
      .string('wsEndpoint', 'WebSocket endpoint')
      .boolean('autoConnect', 'Auto-detect local Chrome debug WebSocket', { default: false })
      .enum('channel', ['stable', 'beta', 'dev', 'canary'], 'Chrome channel', {
        default: 'stable',
      })
      .string('userDataDir', 'Chrome profile directory')
      .array('args', { type: 'string' }, 'Extra Chrome launch args')
      .boolean('enableV8NativesSyntax', 'Enable V8 native syntax for launched Chrome', {
        default: false,
      })
      .boolean('geoip', 'Auto-resolve GeoIP (camoufox)', { default: false })
      .boolean('humanize', 'Humanize cursor (camoufox)', { default: false })
      .string('proxy', 'Proxy URL (camoufox)')
      .boolean('blockImages', 'Block images (camoufox)', { default: false })
      .boolean('blockWebrtc', 'Block WebRTC (camoufox)', { default: false })
      .boolean('blockWebgl', 'Block WebGL (camoufox)', { default: false })
      .string('locale', 'Firefox locale (camoufox)')
      .array('addons', { type: 'string' }, 'Firefox addons (camoufox)')
      .array('fonts', { type: 'string' }, 'Custom fonts (camoufox)')
      .array('excludeAddons', { type: 'string' }, 'Addons to exclude (camoufox)')
      .boolean('customFontsOnly', 'Only use custom fonts (camoufox)', { default: false })
      .object(
        'screen',
        { width: { type: 'number' }, height: { type: 'number' } },
        'Screen resolution (camoufox)',
      )
      .object(
        'window',
        { width: { type: 'number' }, height: { type: 'number' } },
        'Window size (camoufox)',
      )
      .prop('fingerprint', {
        type: 'object',
        description: 'Pre-generated fingerprint (camoufox)',
        additionalProperties: true,
      })
      .prop('webglConfig', {
        type: 'object',
        description: 'WebGL config (camoufox)',
        additionalProperties: true,
      })
      .prop('firefoxUserPrefs', {
        type: 'object',
        description: 'Firefox about:config overrides (camoufox)',
        additionalProperties: true,
      })
      .boolean('mainWorldEval', 'Main world eval (camoufox)', { default: false })
      .boolean('enableCache', 'Enable cache (camoufox)', { default: false })
      .openWorld(),
  ),
  tool('camoufox_server', (t) =>
    t
      .desc('Manage Camoufox WebSocket server.')
      .enum('action', ['launch', 'close', 'status'], 'Action')
      .number('port', 'Listen port (launch)')
      .string('ws_path', 'WebSocket path (launch)')
      .enum('os', ['windows', 'macos', 'linux'], 'OS fingerprint (launch)', {
        default: 'windows',
      })
      .boolean('headless', 'Headless (launch)', { default: true })
      .boolean('geoip', 'GeoIP (launch)', { default: false })
      .boolean('humanize', 'Humanize cursor (launch)', { default: false })
      .string('proxy', 'Proxy URL (launch)')
      .boolean('blockImages', 'Block images (launch)', { default: false })
      .boolean('blockWebrtc', 'Block WebRTC (launch)', { default: false })
      .boolean('blockWebgl', 'Block WebGL (launch)', { default: false })
      .string('locale', 'Firefox locale (launch)')
      .array('addons', { type: 'string' }, 'Addons (launch)')
      .array('fonts', { type: 'string' }, 'Fonts (launch)')
      .array('excludeAddons', { type: 'string' }, 'Excluded addons (launch)')
      .boolean('customFontsOnly', 'Only custom fonts (launch)', { default: false })
      .object(
        'screen',
        { width: { type: 'number' }, height: { type: 'number' } },
        'Screen resolution (launch)',
      )
      .object(
        'window',
        { width: { type: 'number' }, height: { type: 'number' } },
        'Window size (launch)',
      )
      .prop('fingerprint', {
        type: 'object',
        description: 'Pre-generated fingerprint (launch)',
        additionalProperties: true,
      })
      .prop('webglConfig', {
        type: 'object',
        description: 'WebGL config (launch)',
        additionalProperties: true,
      })
      .prop('firefoxUserPrefs', {
        type: 'object',
        description: 'Firefox about:config overrides (launch)',
        additionalProperties: true,
      })
      .boolean('mainWorldEval', 'Main world eval (launch)', { default: false })
      .boolean('enableCache', 'Enable cache (launch)', { default: false })
      .required('action')
      .destructive(),
  ),
  tool('browser_attach', (t) =>
    t
      .desc('Attach to a running browser via CDP.')
      .string('browserURL', 'Debug endpoint URL')
      .string('wsEndpoint', 'WebSocket URL')
      .boolean('autoConnect', 'Auto-detect local Chrome debug WebSocket', { default: false })
      .enum('channel', ['stable', 'beta', 'dev', 'canary'], 'Chrome channel', {
        default: 'stable',
      })
      .string('userDataDir', 'Chrome profile directory')
      .number('pageIndex', 'Tab index to activate', { default: 0 })
      .openWorld(),
  ),
  tool('browser_list_cdp_targets', (t) =>
    t
      .desc('List CDP targets.')
      .string('browserURL', 'Browser URL')
      .string('wsEndpoint', 'WebSocket endpoint')
      .boolean('autoConnect', 'Auto-detect local Chrome debug WebSocket', { default: false })
      .enum('channel', ['stable', 'beta', 'dev', 'canary'], 'Chrome channel', {
        default: 'stable',
      })
      .string('userDataDir', 'Chrome profile directory')
      .string('type', 'Target type filter')
      .array('types', { type: 'string' }, 'Target types to include')
      .string('targetId', 'Exact targetId filter')
      .string('urlPattern', 'URL substring filter')
      .string('titlePattern', 'Title substring filter')
      .boolean('attachedOnly', 'Only attached targets', { default: false })
      .boolean('discoverOOPIF', 'Auto-discover cross-origin iframes', { default: true })
      .query()
      .openWorld(),
  ),
  tool('browser_attach_cdp_target', (t) =>
    t
      .desc('Attach to a CDP target by targetId.')
      .string('targetId', 'Target ID')
      .required('targetId'),
  ),
  tool('browser_detach_cdp_target', (t) =>
    t.desc('Detach the current CDP target session.').destructive(),
  ),
  tool('browser_evaluate_cdp_target', (t) =>
    t
      .desc('Evaluate JS in the attached CDP target.')
      .string('code', 'JavaScript code')
      .string('script', 'Alias of code')
      .boolean('returnByValue', 'Return by value', { default: true })
      .boolean('awaitPromise', 'Await promises', { default: true })
      .boolean('autoSummarize', 'Summarize large results', { default: true })
      .number('maxSize', 'Max size before summarizing', { default: 51200 })
      .array('fieldFilter', { type: 'string' }, 'Field names to strip')
      .boolean('stripBase64', 'Strip base64 payloads', { default: false })
      .required('code'),
  ),
  tool('browser_close', (t) => t.desc('Close browser.').destructive()),
  tool('browser_status', (t) => t.desc('Browser status.').query()),
];
