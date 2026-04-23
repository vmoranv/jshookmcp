import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const browserRuntimeTools: Tool[] = [
  tool('get_detailed_data', (t) =>
    t
      .desc(`Retrieve large data using detailId token from previous tool response.`)
      .string('detailId', 'Detail ID token from previous tool response')
      .string('path', 'Optional: Path to specific data (e.g., "frontierSign" or "methods.0")')
      .required('detailId')
      .query(),
  ),
  tool('browser_launch', (t) =>
    t
      .desc(
        `Launch or connect to a browser. Drivers: chrome (full CDP) or camoufox (anti-detect Firefox).`,
      )
      .enum(
        'driver',
        ['chrome', 'camoufox'],
        'Browser driver. chrome = rebrowser-puppeteer-core (full CDP support). camoufox = Firefox anti-detect (requires: npx camoufox-js fetch).',
        { default: 'chrome' },
      )
      .boolean(
        'headless',
        'Run headless (default follows PUPPETEER_HEADLESS env; set false to show browser window for manual login)',
        { default: false },
      )
      .enum('os', ['windows', 'macos', 'linux'], 'OS fingerprint to spoof (camoufox only)', {
        default: 'windows',
      })
      .enum(
        'mode',
        ['launch', 'connect'],
        'Launch mode. launch = start local browser. connect = reuse existing browser (chrome: browserURL/wsEndpoint/autoConnect, camoufox: wsEndpoint).',
        { default: 'launch' },
      )
      .string(
        'browserURL',
        'HTTP URL of existing browser debug endpoint (chrome connect mode). Example: http://127.0.0.1:9222',
      )
      .string(
        'wsEndpoint',
        'WebSocket endpoint to connect to (chrome or camoufox connect mode). For camoufox, get this from camoufox_server_launch.',
      )
      .boolean(
        'autoConnect',
        'Chrome 144+ only. Auto-detect the local Chrome debugging WebSocket from DevToolsActivePort. Requires remote debugging to be enabled at chrome://inspect/#remote-debugging, and Chrome may prompt you to manually approve this client.',
        { default: false },
      )
      .enum(
        'channel',
        ['stable', 'beta', 'dev', 'canary'],
        'Chrome channel used for autoConnect when userDataDir is not provided.',
        { default: 'stable' },
      )
      .string(
        'userDataDir',
        'Optional Chrome profile directory for autoConnect. If omitted, the default profile path for the selected channel is used.',
      )
      // Camoufox-specific params (ignored for chrome driver)
      .boolean('geoip', 'Auto-resolve GeoIP for locale/timezone (camoufox)', { default: false })
      .boolean('humanize', 'Humanize cursor movements (camoufox)', { default: false })
      .string(
        'proxy',
        'Proxy URL, e.g. "http://user:pass@host:port" or "socks5://host:port" (camoufox)',
      )
      .boolean('blockImages', 'Block image loading for performance (camoufox)', { default: false })
      .boolean('blockWebrtc', 'Block WebRTC to prevent IP leaks (camoufox)', { default: false })
      .boolean('blockWebgl', 'Block WebGL entirely (camoufox)', { default: false })
      .string('locale', 'Firefox locale string, e.g. "en-US" or "zh-CN" (camoufox)')
      .array('addons', { type: 'string' }, 'Firefox addons to include (camoufox)')
      .array('fonts', { type: 'string' }, 'Custom fonts to load (camoufox)')
      .array('excludeAddons', { type: 'string' }, 'Default addons to exclude (camoufox)')
      .boolean('customFontsOnly', 'Use only the provided custom fonts (camoufox)', {
        default: false,
      })
      .object(
        'screen',
        { width: { type: 'number' }, height: { type: 'number' } },
        'Screen resolution override (camoufox)',
      )
      .object(
        'window',
        { width: { type: 'number' }, height: { type: 'number' } },
        'Window size override (camoufox)',
      )
      .prop('fingerprint', {
        type: 'object',
        description:
          'Pre-generated Camoufox fingerprint from stealth_generate_fingerprint(driver="camoufox").',
        additionalProperties: true,
      })
      .prop('webglConfig', {
        type: 'object',
        description: 'Camoufox WebGL configuration override.',
        additionalProperties: true,
      })
      .prop('firefoxUserPrefs', {
        type: 'object',
        description: 'Firefox about:config overrides for Camoufox.',
        additionalProperties: true,
      })
      .boolean('mainWorldEval', 'Evaluate scripts in the main world (camoufox)', {
        default: false,
      })
      .boolean('enableCache', 'Enable browser cache (camoufox, default: false)', {
        default: false,
      })
      .openWorld(),
  ),
  tool('camoufox_server', (t) =>
    t
      .desc(
        `Manage Camoufox WebSocket server. Launch server, then connect via browser_launch.

Actions:
- launch: Start server (returns wsEndpoint)
- close: Stop server, disconnect clients
- status: Check server status`,
      )
      .enum('action', ['launch', 'close', 'status'], 'Server action')
      .number('port', 'Port to listen on (action=launch, default: auto-assigned)')
      .string('ws_path', 'WebSocket path (action=launch, default: auto-generated)')
      .enum('os', ['windows', 'macos', 'linux'], 'OS fingerprint (action=launch)', {
        default: 'windows',
      })
      .boolean('headless', 'Run headless (action=launch, default: true)', { default: true })
      .boolean('geoip', 'Auto-resolve GeoIP (action=launch)', { default: false })
      .boolean('humanize', 'Humanize cursor movements (action=launch)', { default: false })
      .string('proxy', 'Proxy URL, e.g. "http://user:pass@host:port" (action=launch)')
      .boolean('blockImages', 'Block image loading (action=launch)', { default: false })
      .boolean('blockWebrtc', 'Block WebRTC (action=launch)', { default: false })
      .boolean('blockWebgl', 'Block WebGL (action=launch)', { default: false })
      .string('locale', 'Firefox locale, e.g. "en-US" (action=launch)')
      .array('addons', { type: 'string' }, 'Firefox addons (action=launch)')
      .array('fonts', { type: 'string' }, 'Custom fonts (action=launch)')
      .array('excludeAddons', { type: 'string' }, 'Default addons to exclude (action=launch)')
      .boolean('customFontsOnly', 'Use only the provided custom fonts (action=launch)', {
        default: false,
      })
      .object(
        'screen',
        { width: { type: 'number' }, height: { type: 'number' } },
        'Screen resolution override (action=launch)',
      )
      .object(
        'window',
        { width: { type: 'number' }, height: { type: 'number' } },
        'Window size override (action=launch)',
      )
      .prop('fingerprint', {
        type: 'object',
        description: 'Pre-generated Camoufox fingerprint (action=launch).',
        additionalProperties: true,
      })
      .prop('webglConfig', {
        type: 'object',
        description: 'Camoufox WebGL configuration override (action=launch).',
        additionalProperties: true,
      })
      .prop('firefoxUserPrefs', {
        type: 'object',
        description: 'Firefox about:config overrides (action=launch).',
        additionalProperties: true,
      })
      .boolean('mainWorldEval', 'Evaluate scripts in the main world (action=launch)', {
        default: false,
      })
      .boolean('enableCache', 'Enable browser cache (action=launch)', { default: false })
      .required('action')
      .destructive(),
  ),
  tool('browser_attach', (t) =>
    t
      .desc(
        `Attach to a running browser via CDP. Supports browserURL, wsEndpoint, and autoConnect.`,
      )
      .string(
        'browserURL',
        'HTTP URL of the remote debugging endpoint (e.g., http://127.0.0.1:9222)',
      )
      .string(
        'wsEndpoint',
        'WebSocket URL from /json/version (e.g., ws://127.0.0.1:9222/devtools/browser/xxx)',
      )
      .boolean(
        'autoConnect',
        'Chrome 144+ only. Auto-detect the local Chrome debugging WebSocket from DevToolsActivePort. Requires remote debugging to be enabled at chrome://inspect/#remote-debugging, and Chrome may prompt you to manually approve this client.',
        { default: false },
      )
      .enum(
        'channel',
        ['stable', 'beta', 'dev', 'canary'],
        'Chrome channel used for autoConnect when userDataDir is not provided.',
        { default: 'stable' },
      )
      .string(
        'userDataDir',
        'Optional Chrome profile directory for autoConnect. If omitted, the default profile path for the selected channel is used.',
      )
      .number('pageIndex', 'Index of the page/tab to activate (default: 0)', { default: 0 })
      .openWorld(),
  ),
  tool('browser_list_cdp_targets', (t) =>
    t
      .desc(`List all CDP targets (pages, workers, iframes). Can auto-connect first.`)
      .string('browserURL', 'Optional: connect to this browser URL before listing targets.')
      .string(
        'wsEndpoint',
        'Optional: connect to this browser WebSocket endpoint before listing targets.',
      )
      .boolean(
        'autoConnect',
        'Chrome 144+ only. Auto-detect the local Chrome debugging WebSocket from DevToolsActivePort.',
        { default: false },
      )
      .enum(
        'channel',
        ['stable', 'beta', 'dev', 'canary'],
        'Chrome channel used for autoConnect when userDataDir is not provided.',
        { default: 'stable' },
      )
      .string(
        'userDataDir',
        'Optional Chrome profile directory for autoConnect. If omitted, the default profile path for the selected channel is used.',
      )
      .string(
        'type',
        'Optional single target type filter, for example iframe, page, service_worker.',
      )
      .array('types', { type: 'string' }, 'Optional list of target types to include.')
      .string('targetId', 'Optional exact targetId filter.')
      .string('urlPattern', 'Optional substring filter for target URL.')
      .string('titlePattern', 'Optional substring filter for target title.')
      .boolean('attachedOnly', 'Only include targets already marked attached by CDP.', {
        default: false,
      })
      .boolean(
        'discoverOOPIF',
        'Enable auto-discovery of cross-origin iframes (OOPIFs) via Target.setAutoAttach. When true (default), OOPIFs will appear in results.',
        { default: true },
      )
      .query()
      .openWorld(),
  ),
  tool('browser_attach_cdp_target', (t) =>
    t
      .desc(`Attach to a specific CDP target by targetId. Network/hooks bind to this target.`)
      .string('targetId', 'Target ID returned by browser_list_cdp_targets.')
      .required('targetId'),
  ),
  tool('browser_detach_cdp_target', (t) =>
    t
      .desc(
        'Detach the currently attached low-level CDP target session and return network/hooks to normal page-based binding.',
      )
      .destructive(),
  ),
  tool('browser_evaluate_cdp_target', (t) =>
    t
      .desc(`Evaluate JS in the currently attached CDP target session (OOPIF/iframe/worker).`)
      .string('code', 'JavaScript expression or IIFE string to evaluate in the attached target.')
      .string('script', 'Alias of code.')
      .boolean('returnByValue', 'Return primitive/JSON-serializable result by value.', {
        default: true,
      })
      .boolean('awaitPromise', 'Await promise results before returning.', {
        default: true,
      })
      .boolean('autoSummarize', 'Summarize oversized results using detailed data manager.', {
        default: true,
      })
      .number('maxSize', 'Approximate max JSON payload before summarization.', { default: 51200 })
      .array(
        'fieldFilter',
        { type: 'string' },
        'Remove these field names recursively from the result.',
      )
      .boolean('stripBase64', 'Replace base64-like payloads with short placeholders.', {
        default: false,
      })
      .required('code'),
  ),
  tool('browser_close', (t) => t.desc('Close browser instance').destructive()),
  tool('browser_status', (t) =>
    t.desc('Get browser status (running, pages count, version)').query(),
  ),
];
