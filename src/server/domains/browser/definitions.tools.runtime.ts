import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const browserRuntimeTools: Tool[] = [
  tool('get_detailed_data', (t) =>
    t
      .desc(` Retrieve detailed data using detailId token.

When tools return large data, they provide a detailId instead of full data to prevent context overflow.
Use this tool to retrieve the full data or specific parts.

Examples:
- get_detailed_data("detail_abc123") -> Get full data
- get_detailed_data("detail_abc123", path="frontierSign") -> Get specific property
- get_detailed_data("detail_abc123", path="methods.0") -> Get first method`)
      .string('detailId', 'Detail ID token from previous tool response')
      .string('path', 'Optional: Path to specific data (e.g., "frontierSign" or "methods.0")')
      .required('detailId')
      .query(),
  ),
  tool('browser_launch', (t) =>
    t
      .desc(`Launch browser instance.

Drivers:
- chrome (default): rebrowser-puppeteer-core, Chromium-based, full CDP support (debugger, network, stealth scripts, etc.)
- camoufox: Firefox-based anti-detect browser, C++ engine-level fingerprint spoofing.
  Requires binaries first: npx camoufox-js fetch
  Note: CDP tools (debugger, network monitor, etc.) are not available in camoufox mode.

Modes:
- launch (default): launch a local browser instance
- connect: reuse an existing browser instance
  - chrome: connect via browserURL (http://host:port), wsEndpoint, or Chrome 144+ autoConnect
  - camoufox: connect via wsEndpoint from camoufox_server_launch`)
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
      .openWorld(),
  ),
  tool('camoufox_server_launch', (t) =>
    t
      .desc(`Launch a Camoufox WebSocket server for multi-process / remote connections.

Use this when you need concurrent browser instances or want to manage the browser lifecycle separately from the automation client.

Steps:
1. Call camoufox_server_launch → get wsEndpoint
2. Call browser_launch(driver="camoufox", mode="connect", wsEndpoint=<endpoint>) from one or more sessions
3. Use page_navigate and other tools normally
4. Call camoufox_server_close when done

Requires binaries: npx camoufox-js fetch`)
      .number('port', 'Port to listen on (default: auto-assigned)')
      .string('ws_path', 'WebSocket path (default: auto-generated)')
      .enum('os', ['windows', 'macos', 'linux'], 'OS fingerprint to spoof', { default: 'windows' })
      .boolean('headless', 'Run headless (default: true)', { default: true })
      .openWorld(),
  ),
  tool('camoufox_server_close', (t) =>
    t
      .desc('Close the Camoufox WebSocket server. Connected clients are disconnected.')
      .destructive(),
  ),
  tool('camoufox_server_status', (t) =>
    t
      .desc('Get the current status of the Camoufox WebSocket server (running, wsEndpoint).')
      .query(),
  ),
  tool('browser_attach', (t) =>
    t
      .desc(`Attach to an existing browser instance via Chrome DevTools Protocol (CDP).

Use this when a browser is already running with remote debugging enabled.
Supports browserURL (http://host:port), WebSocket endpoint (ws://...), and Chrome 144+ autoConnect.
The selected tab becomes active immediately, while console/network monitoring rebinds lazily on the next console_* or network_* call.

Example:
- browser_attach(browserURL="http://127.0.0.1:9222")
- browser_attach(wsEndpoint="ws://127.0.0.1:9222/devtools/browser/xxx")
- browser_attach(autoConnect=true, channel="stable")
- browser_attach(browserURL="http://127.0.0.1:9222", pageIndex=0)

Response notes:
- contextSwitched: whether an active tab context was established during attach
- monitoringBindingDeferred: whether monitoring will auto-rebind later for the selected tab

After attaching, use page_navigate / page_screenshot / debugger_enable normally.`)
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
      .desc(`List all CDP targets visible from the connected browser target.

This is lower-level than browser_list_tabs and includes non-page targets such as iframe, service_worker, shared_worker, and browser targets when the browser exposes them.

Optional connect parameters behave like browser_attach when provided.`)
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
      .query()
      .openWorld(),
  ),
  tool('browser_attach_cdp_target', (t) =>
    t
      .desc(`Attach to a specific CDP target by targetId.

This creates an active target session distinct from the selected page/tab.
After attachment, network_* and ai_hook_* bind to this target session until browser_detach_cdp_target() is called or the page context is switched.`)
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
      .desc(`Evaluate JavaScript inside the currently attached CDP target session.

This is explicit target-context evaluation. It does not reuse page_evaluate because page_* tools are reserved for the active Puppeteer Page context.

Use this for OOPIF/iframe/service_worker/page targets that need direct target-session execution.`)
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
