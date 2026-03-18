import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const browserRuntimeTools: Tool[] = [
  {
    name: 'get_detailed_data',
    description: ` Retrieve detailed data using detailId token.

When tools return large data, they provide a detailId instead of full data to prevent context overflow.
Use this tool to retrieve the full data or specific parts.

Examples:
- get_detailed_data("detail_abc123") -> Get full data
- get_detailed_data("detail_abc123", path="frontierSign") -> Get specific property
- get_detailed_data("detail_abc123", path="methods.0") -> Get first method`,
    inputSchema: {
      type: 'object',
      properties: {
        detailId: {
          type: 'string',
          description: 'Detail ID token from previous tool response',
        },
        path: {
          type: 'string',
          description: 'Optional: Path to specific data (e.g., "frontierSign" or "methods.0")',
        },
      },
      required: ['detailId'],
    },
  },

  {
    name: 'browser_launch',
    description: `Launch browser instance.

Drivers:
- chrome (default): rebrowser-puppeteer-core, Chromium-based, full CDP support (debugger, network, stealth scripts, etc.)
- camoufox: Firefox-based anti-detect browser, C++ engine-level fingerprint spoofing.
  Requires binaries first: npx camoufox-js fetch
  Note: CDP tools (debugger, network monitor, etc.) are not available in camoufox mode.

Modes:
- launch (default): launch a local browser instance
- connect: reuse an existing browser instance
  - chrome: connect via browserURL (http://host:port), wsEndpoint, or Chrome 144+ autoConnect
  - camoufox: connect via wsEndpoint from camoufox_server_launch`,
    inputSchema: {
      type: 'object',
      properties: {
        driver: {
          type: 'string',
          description:
            'Browser driver. chrome = rebrowser-puppeteer-core (full CDP support). camoufox = Firefox anti-detect (requires: npx camoufox-js fetch).',
          enum: ['chrome', 'camoufox'],
          default: 'chrome',
        },
        headless: {
          type: 'boolean',
          description:
            'Run headless (default follows PUPPETEER_HEADLESS env; set false to show browser window for manual login)',
          default: false,
        },
        os: {
          type: 'string',
          description: 'OS fingerprint to spoof (camoufox only)',
          enum: ['windows', 'macos', 'linux'],
          default: 'windows',
        },
        mode: {
          type: 'string',
          description:
            'Launch mode. launch = start local browser. connect = reuse existing browser (chrome: browserURL/wsEndpoint/autoConnect, camoufox: wsEndpoint).',
          enum: ['launch', 'connect'],
          default: 'launch',
        },
        browserURL: {
          type: 'string',
          description:
            'HTTP URL of existing browser debug endpoint (chrome connect mode). Example: http://127.0.0.1:9222',
        },
        wsEndpoint: {
          type: 'string',
          description:
            'WebSocket endpoint to connect to (chrome or camoufox connect mode). For camoufox, get this from camoufox_server_launch.',
        },
        autoConnect: {
          type: 'boolean',
          description:
            'Chrome 144+ only. Auto-detect the local Chrome debugging WebSocket from DevToolsActivePort. Requires remote debugging to be enabled at chrome://inspect/#remote-debugging, and Chrome may prompt you to manually approve this client.',
          default: false,
        },
        channel: {
          type: 'string',
          description: 'Chrome channel used for autoConnect when userDataDir is not provided.',
          enum: ['stable', 'beta', 'dev', 'canary'],
          default: 'stable',
        },
        userDataDir: {
          type: 'string',
          description:
            'Optional Chrome profile directory for autoConnect. If omitted, the default profile path for the selected channel is used.',
        },
      },
    },
  },
  {
    name: 'camoufox_server_launch',
    description: `Launch a Camoufox WebSocket server for multi-process / remote connections.

Use this when you need concurrent browser instances or want to manage the browser lifecycle separately from the automation client.

Steps:
1. Call camoufox_server_launch → get wsEndpoint
2. Call browser_launch(driver="camoufox", mode="connect", wsEndpoint=<endpoint>) from one or more sessions
3. Use page_navigate and other tools normally
4. Call camoufox_server_close when done

Requires binaries: npx camoufox-js fetch`,
    inputSchema: {
      type: 'object',
      properties: {
        port: {
          type: 'number',
          description: 'Port to listen on (default: auto-assigned)',
        },
        ws_path: {
          type: 'string',
          description: 'WebSocket path (default: auto-generated)',
        },
        os: {
          type: 'string',
          description: 'OS fingerprint to spoof',
          enum: ['windows', 'macos', 'linux'],
          default: 'windows',
        },
        headless: {
          type: 'boolean',
          description: 'Run headless (default: true)',
          default: true,
        },
      },
    },
  },
  {
    name: 'camoufox_server_close',
    description: 'Close the Camoufox WebSocket server. Connected clients are disconnected.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'camoufox_server_status',
    description: 'Get the current status of the Camoufox WebSocket server (running, wsEndpoint).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_attach',
    description: `Attach to an existing browser instance via Chrome DevTools Protocol (CDP).

Use this when a browser is already running with remote debugging enabled.
Supports browserURL (http://host:port), WebSocket endpoint (ws://...), and Chrome 144+ autoConnect.

Example:
- browser_attach(browserURL="http://127.0.0.1:9222")
- browser_attach(wsEndpoint="ws://127.0.0.1:9222/devtools/browser/xxx")
- browser_attach(autoConnect=true, channel="stable")
- browser_attach(browserURL="http://127.0.0.1:9222", pageIndex=0)

After attaching, use page_navigate / page_screenshot / debugger_enable normally.`,
    inputSchema: {
      type: 'object',
      properties: {
        browserURL: {
          type: 'string',
          description: 'HTTP URL of the remote debugging endpoint (e.g., http://127.0.0.1:9222)',
        },
        wsEndpoint: {
          type: 'string',
          description:
            'WebSocket URL from /json/version (e.g., ws://127.0.0.1:9222/devtools/browser/xxx)',
        },
        autoConnect: {
          type: 'boolean',
          description:
            'Chrome 144+ only. Auto-detect the local Chrome debugging WebSocket from DevToolsActivePort. Requires remote debugging to be enabled at chrome://inspect/#remote-debugging, and Chrome may prompt you to manually approve this client.',
          default: false,
        },
        channel: {
          type: 'string',
          description: 'Chrome channel used for autoConnect when userDataDir is not provided.',
          enum: ['stable', 'beta', 'dev', 'canary'],
          default: 'stable',
        },
        userDataDir: {
          type: 'string',
          description:
            'Optional Chrome profile directory for autoConnect. If omitted, the default profile path for the selected channel is used.',
        },
        pageIndex: {
          type: 'number',
          description: 'Index of the page/tab to activate (default: 0)',
          default: 0,
        },
      },
    },
  },
  {
    name: 'browser_close',
    description: 'Close browser instance',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser_status',
    description: 'Get browser status (running, pages count, version)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];
