import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const browserTools: Tool[] = [
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
  - chrome: connect via browserURL (http://host:port) or wsEndpoint
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
          description: 'Run headless (default follows PUPPETEER_HEADLESS env; set false to show browser window for manual login)',
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
            'Launch mode. launch = start local browser. connect = reuse existing browser (chrome: browserURL/wsEndpoint, camoufox: wsEndpoint).',
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
Supports both browserURL (http://host:port) and WebSocket endpoint (ws://...).

Example:
- browser_attach(browserURL="http://127.0.0.1:9222")
- browser_attach(wsEndpoint="ws://127.0.0.1:9222/devtools/browser/xxx")
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
          description: 'WebSocket URL from /json/version (e.g., ws://127.0.0.1:9222/devtools/browser/xxx)',
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

  {
    name: 'page_navigate',
    description: `Navigate to a URL

Features:
- Automatic CAPTCHA detection
- Optional network monitoring (set enableNetworkMonitoring=true to auto-enable)
- Waits for page load based on waitUntil strategy

Network Monitoring:
If you want to capture network requests, you have two options:
1. Call network_enable before page_navigate (recommended for full control)
2. Set enableNetworkMonitoring=true in page_navigate (convenient for quick capture)

Example with network monitoring:
page_navigate(url="https:
-> Network monitoring auto-enabled
-> Page loads
-> Use network_get_requests to see captured requests`,
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Target URL to navigate to',
        },
        waitUntil: {
          type: 'string',
          description: 'When to consider navigation succeeded',
          enum: ['load', 'domcontentloaded', 'networkidle', 'commit'],
          default: 'networkidle',
        },
        timeout: {
          type: 'number',
          description: 'Navigation timeout in milliseconds',
          default: 30000,
        },
        enableNetworkMonitoring: {
          type: 'boolean',
          description:
            ' Auto-enable network monitoring before navigation to capture all requests. If already enabled, this has no effect.',
          default: false,
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'page_reload',
    description: 'Reload current page',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'page_back',
    description: 'Navigate back in history',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'page_forward',
    description: 'Navigate forward in history',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'dom_query_selector',
    description:
      'Query single element (like document.querySelector). AI should use this BEFORE clicking to verify element exists.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector',
        },
        getAttributes: {
          type: 'boolean',
          description: 'Whether to get element attributes',
          default: true,
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'dom_query_all',
    description: 'Query all matching elements (like document.querySelectorAll)',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of elements to return',
          default: 100,
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'dom_get_structure',
    description: `Get page DOM structure (for AI to understand page layout).

IMPORTANT: Large DOM structures (>50KB) automatically return summary + detailId.

Best Practices:
1. Use maxDepth=2 for initial exploration (faster, smaller)
2. Use maxDepth=3 only when needed (may be large)
3. Set includeText=false to reduce size if text not needed

Example:
dom_get_structure(maxDepth=2, includeText=false)
-> Returns compact structure without text content`,
    inputSchema: {
      type: 'object',
      properties: {
        maxDepth: {
          type: 'number',
          description: 'Maximum depth of DOM tree (default: 3, recommend: 2 for large pages)',
          default: 3,
        },
        includeText: {
          type: 'boolean',
          description: 'Whether to include text content (set false to reduce size)',
          default: true,
        },
      },
    },
  },
  {
    name: 'dom_find_clickable',
    description:
      'Find all clickable elements (buttons, links). Use this to discover what can be clicked.',
    inputSchema: {
      type: 'object',
      properties: {
        filterText: {
          type: 'string',
          description: 'Filter by text content (optional)',
        },
      },
    },
  },

  {
    name: 'page_click',
    description: 'Click an element. Use dom_query_selector FIRST to verify element exists.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of element to click',
        },
        button: {
          type: 'string',
          description: 'Mouse button to click',
          enum: ['left', 'right', 'middle'],
          default: 'left',
        },
        clickCount: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          description: 'Number of clicks (numeric string is accepted and auto-normalized)',
          default: 1,
        },
        delay: {
          oneOf: [{ type: 'number' }, { type: 'string' }],
          description:
            'Delay between mousedown and mouseup in milliseconds (numeric string is accepted)',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'page_type',
    description: 'Type text into an input element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of input element',
        },
        text: {
          type: 'string',
          description: 'Text to type',
        },
        delay: {
          type: 'number',
          description: 'Delay between key presses in milliseconds',
        },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'page_select',
    description: 'Select option(s) in a <select> element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of select element',
        },
        values: {
          type: 'array',
          description: 'Values to select',
          items: {
            type: 'string',
          },
        },
      },
      required: ['selector', 'values'],
    },
  },
  {
    name: 'page_hover',
    description: 'Hover over an element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of element to hover',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'page_scroll',
    description: 'Scroll the page',
    inputSchema: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'Horizontal scroll position',
          default: 0,
        },
        y: {
          type: 'number',
          description: 'Vertical scroll position',
          default: 0,
        },
      },
    },
  },

  {
    name: 'page_wait_for_selector',
    description: 'Wait for an element to appear',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to wait for',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds',
          default: 30000,
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'page_evaluate',
    description: `Execute JavaScript code in page context and get result.

IMPORTANT: Large results (>50KB) automatically return summary + detailId to prevent context overflow.
Use get_detailed_data(detailId) to retrieve full data if needed.

Best Practices:
-  Query specific properties: { hasAcrawler: !!window.byted_acrawler }
-  Return only needed data: Object.keys(window.byted_acrawler)
-  Avoid returning entire objects: window (too large!)

Example:
page_evaluate("({ keys: Object.keys(window.byted_acrawler), type: typeof window.byted_acrawler })")
-> Returns small summary
-> If you need full object, use the returned detailId`,
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute',
        },
        autoSummarize: {
          type: 'boolean',
          description: 'Auto-summarize large results (default: true)',
          default: true,
        },
        maxSize: {
          type: 'number',
          description: 'Max result size in bytes before auto-summarizing (default: 50KB)',
          default: 51200,
        },
        fieldFilter: {
          type: 'array',
          items: { type: 'string' },
          description: 'Server-side field filter: remove keys matching these names from the result object (recursive). Useful to strip noise fields like "icon", "avatar", "base64Image".',
        },
        stripBase64: {
          type: 'boolean',
          description: 'Strip data URI and bare base64 strings from the result, replacing them with a size placeholder. Prevents context overflow from embedded images/fonts (default: false).',
          default: false,
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'page_screenshot',
    description: 'Take a screenshot of the page',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to save screenshot (optional)',
        },
        type: {
          type: 'string',
          description: 'Image format',
          enum: ['png', 'jpeg'],
          default: 'png',
        },
        quality: {
          type: 'number',
          description: 'Image quality (0-100, only for jpeg)',
        },
        fullPage: {
          type: 'boolean',
          description: 'Capture full scrollable page',
          default: false,
        },
      },
    },
  },

  {
    name: 'get_all_scripts',
    description: 'Get list of all loaded scripts on the page',
    inputSchema: {
      type: 'object',
      properties: {
        includeSource: {
          type: 'boolean',
          description: 'Whether to include script source code',
          default: false,
        },
      },
    },
  },
  {
    name: 'get_script_source',
    description: `Get source code of a specific script.

IMPORTANT: Large scripts (>50KB) automatically return summary + detailId.
Use preview mode first to check script size before fetching full source.

Best Practices:
1. Use preview=true first to see script overview
2. If script is large, use detailId to get full source
3. Or use startLine/endLine to get specific sections

Example:
get_script_source(scriptId="abc", preview=true)
-> Returns: { lines: 5000, size: "500KB", preview: "...", detailId: "..." }
-> Then: get_detailed_data(detailId) to get full source`,
    inputSchema: {
      type: 'object',
      properties: {
        scriptId: {
          type: 'string',
          description: 'Script ID from get_all_scripts',
        },
        url: {
          type: 'string',
          description: 'Script URL (supports wildcards like *.js)',
        },
        preview: {
          type: 'boolean',
          description: 'Return preview only (first 100 lines + metadata)',
          default: false,
        },
        maxLines: {
          type: 'number',
          description: 'Max lines to return in preview mode (default: 100)',
          default: 100,
        },
        startLine: {
          type: 'number',
          description: 'Start line number (1-based, for partial fetch)',
        },
        endLine: {
          type: 'number',
          description: 'End line number (1-based, for partial fetch)',
        },
      },
    },
  },

  {
    name: 'console_enable',
    description: 'Enable console monitoring to capture console.log, console.error, etc.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'console_get_logs',
    description: 'Get captured console logs',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Filter by log type',
          enum: ['log', 'warn', 'error', 'info', 'debug'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of logs to return',
        },
        since: {
          type: 'number',
          description: 'Only return logs after this timestamp',
        },
      },
    },
  },
  {
    name: 'console_execute',
    description: 'Execute JavaScript expression in console context',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'JavaScript expression to execute',
        },
      },
      required: ['expression'],
    },
  },

  {
    name: 'dom_get_computed_style',
    description: 'Get computed CSS styles of an element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'dom_find_by_text',
    description: 'Find elements by text content (useful for dynamic content)',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to search for',
        },
        tag: {
          type: 'string',
          description: 'Optional tag name to filter (e.g., "button", "a")',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'dom_get_xpath',
    description: 'Get XPath of an element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'dom_is_in_viewport',
    description: 'Check if element is visible in viewport',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector',
        },
      },
      required: ['selector'],
    },
  },

  {
    name: 'page_get_performance',
    description: 'Get page performance metrics (load time, network time, etc.)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'page_inject_script',
    description: 'Inject JavaScript code into page',
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'JavaScript code to inject',
        },
      },
      required: ['script'],
    },
  },
  {
    name: 'page_set_cookies',
    description: 'Set cookies for the page',
    inputSchema: {
      type: 'object',
      properties: {
        cookies: {
          type: 'array',
          description: 'Array of cookie objects',
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
      },
      required: ['cookies'],
    },
  },
  {
    name: 'page_get_cookies',
    description: 'Get all cookies for the page',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'page_clear_cookies',
    description: 'Clear all cookies',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'page_set_viewport',
    description: 'Set viewport size',
    inputSchema: {
      type: 'object',
      properties: {
        width: {
          type: 'number',
          description: 'Viewport width',
        },
        height: {
          type: 'number',
          description: 'Viewport height',
        },
      },
      required: ['width', 'height'],
    },
  },
  {
    name: 'page_emulate_device',
    description: 'Emulate mobile device (iPhone, iPad, Android)',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          description:
            'Device to emulate. Supports canonical values (iPhone, iPad, Android) and aliases like "iPhone 13" / "iPhone 14".',
        },
      },
      required: ['device'],
    },
  },
  {
    name: 'page_get_local_storage',
    description: 'Get all localStorage items',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'page_set_local_storage',
    description: 'Set localStorage item',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Storage key',
        },
        value: {
          type: 'string',
          description: 'Storage value',
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'page_press_key',
    description: 'Press a keyboard key (e.g., "Enter", "Escape", "ArrowDown")',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Key to press',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'page_get_all_links',
    description: 'Get all links on the page',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'captcha_detect',
    description: `Detect CAPTCHA on the current page using AI vision analysis.

Detection process:
1. Takes a screenshot and analyzes it with AI (Vision LLM)
2. Applies rule-based detection as fallback if AI unavailable
3. Returns detection result with confidence score

Supported CAPTCHA types:
- Slider CAPTCHA: drag-to-verify style challenges
- Image CAPTCHA: select-images challenges
- reCAPTCHA / hCaptcha
- Cloudflare Challenge
- Custom CAPTCHA implementations

Response fields:
- detected: whether CAPTCHA was found
- type: CAPTCHA type identifier
- vendor: vendor name if identified
- confidence: detection confidence (0-100)
- reasoning: AI analysis explanation
- screenshot: base64 screenshot (if MCP cannot view images, use external AI)
- suggestions: recommended next steps

Note:
When the MCP LLM cannot access Vision API directly, the screenshot is provided as base64.
Use an external AI (GPT-4o, Claude 3) to analyze the screenshot.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'captcha_wait',
    description: `Wait for the user to manually solve a CAPTCHA.

Steps:
1. CAPTCHA is detected on the page
2. Browser switches to headed (visible) mode
3. User solves the CAPTCHA manually
4. Script resumes automatically after detection

Timeout: default 300000ms (5 minutes)`,
    inputSchema: {
      type: 'object',
      properties: {
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 300000 = 5 minutes)',
          default: 300000,
        },
      },
    },
  },
  {
    name: 'captcha_config',
    description: `Configure CAPTCHA detection behavior.

Parameters:
- autoDetectCaptcha: auto-detect CAPTCHA after page_navigate (default: true)
- autoSwitchHeadless: auto-switch to headed mode when CAPTCHA detected (default: true)
- captchaTimeout: timeout for waiting user to solve CAPTCHA in ms (default: 300000)`,
    inputSchema: {
      type: 'object',
      properties: {
        autoDetectCaptcha: {
          type: 'boolean',
          description: 'Whether to automatically detect CAPTCHA after navigation',
        },
        autoSwitchHeadless: {
          type: 'boolean',
          description: 'Whether to automatically switch to headed mode when CAPTCHA detected',
        },
        captchaTimeout: {
          type: 'number',
          description: 'Timeout for waiting user to complete CAPTCHA (milliseconds)',
        },
      },
    },
  },

  {
    name: 'stealth_inject',
    description: `Inject modern stealth scripts to bypass bot detection.

Anti-detection patches:
1. Hide navigator.webdriver flag
2. Inject window.chrome object
3. Restore navigator.plugins
4. Fix Permissions API behavior
5. Patch Canvas fingerprinting
6. Patch WebGL fingerprinting
7. Restore hardware concurrency
8. Fix Battery API responses
9. Fix MediaDevices enumeration
10. Fix Notification API

Compatible with undetected-chromedriver, puppeteer-extra-plugin-stealth, playwright-stealth.
Call after browser_launch for best results.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'stealth_set_user_agent',
    description: `Set a realistic User-Agent and browser fingerprint for the target platform.

Updates navigator.userAgent, navigator.platform, navigator.vendor,
navigator.hardwareConcurrency, and navigator.deviceMemory consistently
to avoid fingerprint inconsistencies.`,
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          description: 'Target platform',
          enum: ['windows', 'mac', 'linux'],
          default: 'windows',
        },
      },
    },
  },

  {
    name: 'browser_list_tabs',
    description: `List all open tabs/pages in the connected browser.

Use this after browser_attach to see all available pages/tabs.
Returns index, URL, and title for each tab.

Workflow:
1. browser_attach(browserURL="http://127.0.0.1:9222")
2. browser_list_tabs() -> see all tabs with their indexes
3. browser_select_tab(index=N) -> switch to desired tab

Can also connect and list in one call:
browser_list_tabs(browserURL="http://127.0.0.1:9222")`,
    inputSchema: {
      type: 'object',
      properties: {
        browserURL: {
          type: 'string',
          description: 'Optional: connect to this browser URL before listing (e.g. http://127.0.0.1:9222)',
        },
      },
    },
  },
  {
    name: 'browser_select_tab',
    description: `Switch the active tab/page by index or URL/title pattern.

After browser_list_tabs, use this to activate a specific tab.
All subsequent page_* tools will operate on the selected tab.

Examples:
- browser_select_tab(index=0) -> first tab
- browser_select_tab(urlPattern="qwen") -> tab whose URL contains "qwen"
- browser_select_tab(titlePattern="Mini Program") -> tab whose title contains "Mini Program"`,
    inputSchema: {
      type: 'object',
      properties: {
        index: {
          type: 'number',
          description: 'Tab index from browser_list_tabs (0-based)',
        },
        urlPattern: {
          type: 'string',
          description: 'Substring to match against tab URLs',
        },
        titlePattern: {
          type: 'string',
          description: 'Substring to match against tab titles',
        },
      },
    },
  },
  // Reclassified reverse-engineering helpers
  {
    name: 'framework_state_extract',
    description: 'Extract React/Vue component state from the live page. Useful for debugging frontend applications and finding hidden state.',
    inputSchema: {
      type: 'object',
      properties: {
        framework: {
          type: 'string',
          description: 'Framework to target. auto = detect automatically.',
          enum: ['auto', 'react', 'vue2', 'vue3'],
          default: 'auto',
        },
        selector: {
          type: 'string',
          description: 'CSS selector of root element to inspect (default: #root, #app, [data-reactroot], body)',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum component tree depth to traverse',
          default: 5,
        },
      },
    },
  },
  {
    name: 'indexeddb_dump',
    description: 'Dump all IndexedDB databases and their contents. Useful for analyzing PWA data, stored tokens, or offline application state.',
    inputSchema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          description: 'Specific database name to dump (default: all databases)',
        },
        store: {
          type: 'string',
          description: 'Specific object store to dump (default: all stores)',
        },
        maxRecords: {
          type: 'number',
          description: 'Maximum records per store to return',
          default: 100,
        },
      },
    },
  },
];

// ── P2: Advanced browser reverse-engineering tools ────────────────────────

export const advancedBrowserToolDefinitions: import('@modelcontextprotocol/sdk/types.js').Tool[] = [
  {
    name: 'js_heap_search',
    description:
      'Search the browser JavaScript heap for string values matching a pattern. This is the CE (Cheat Engine) equivalent for web — scans the JS runtime memory to find tokens, API keys, signatures, or any string stored in JS objects.\n\nUSE THIS to:\n- Find auth tokens stored in memory but not in cookies/localStorage\n- Locate signing keys or secrets held in JS closures\n- Discover values that are only briefly held in memory during a request\n\nWARNING: Takes a full heap snapshot (can be 50-500MB for complex pages). Use specific patterns to reduce result noise.\nResults are paginated via DetailedDataManager when large.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'String pattern to search for in the JS heap',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of matches to return (default: 50)',
          default: 50,
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Case-sensitive search (default: false)',
          default: false,
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'tab_workflow',
    description:
      'Cross-tab coordination for multi-page automation flows.\n\nActions:\n- list: Show all aliases and shared context\n- alias_bind: Name an existing tab by index (e.g., alias="register" index=0)\n- alias_open: Open a URL in a new tab and name it\n- navigate: Navigate a named tab to a URL\n- wait_for: Wait for selector or text to appear in a named tab\n- context_set: Store a value in shared context (accessible across tabs)\n- context_get: Read a value from shared context\n- transfer: Evaluate JS in a named tab and store result in shared context\n\nUSE THIS for:\n- Registration page ↔ email verification page workflows\n- Any flow requiring coordination between multiple open tabs',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'alias_bind', 'alias_open', 'navigate', 'wait_for', 'context_set', 'context_get', 'transfer'],
          description: 'Tab workflow action to perform',
        },
        alias: {
          type: 'string',
          description: 'Tab alias name (used by alias_bind, alias_open, navigate, wait_for, transfer)',
        },
        fromAlias: {
          type: 'string',
          description: 'Source tab alias for transfer action',
        },
        index: {
          type: 'number',
          description: 'Tab index (0-based) for alias_bind',
        },
        url: {
          type: 'string',
          description: 'URL for alias_open or navigate',
        },
        selector: {
          type: 'string',
          description: 'CSS selector to wait for (wait_for action)',
        },
        waitForText: {
          type: 'string',
          description: 'Text string to wait for in page body (wait_for action)',
        },
        key: {
          type: 'string',
          description: 'Context key for context_set, context_get, transfer',
        },
        value: {
          description: 'Value to store (context_set action)',
        },
        expression: {
          type: 'string',
          description: 'JavaScript expression to evaluate in the source tab (transfer action)',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds for wait_for (default: 10000)',
          default: 10000,
        },
      },
      required: ['action'],
    },
  },
];
