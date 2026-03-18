import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const browserSecurityStateTools: Tool[] = [
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
- Widget CAPTCHA: embedded checkbox or iframe-based challenges
- Browser Check: interstitial or automatic integrity checks
- Custom CAPTCHA implementations

Response fields:
- detected: whether CAPTCHA was found
- type: CAPTCHA type identifier
- providerHint: broad provider category if identified
- confidence: detection confidence (0-100)
- reasoning: AI analysis explanation
- screenshotPath: saved screenshot path when a vision-capable model is unavailable
- suggestions: recommended next steps

Note:
When the configured MCP model cannot access vision directly, the detector saves a screenshot
to disk and returns screenshotPath together with prompt guidance in the reasoning field.
Use an external AI (GPT-4o, Claude 3) to analyze the saved screenshot if needed.`,
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
2. This tool polls the current page until the CAPTCHA is no longer detected
3. User solves the CAPTCHA manually in the active browser/page
4. Script resumes automatically after detection

Note: this tool does not switch browser modes on its own.

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
- autoDetectCaptcha: enable CAPTCHA auto-handling for browser-mode integrations that use these settings
- autoSwitchHeadless: allow supported integrations to switch to headed mode when CAPTCHA is detected
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
1. browser_attach(browserURL="http://127.0.0.1:9222") or browser_attach(autoConnect=true)
2. browser_list_tabs() -> see all tabs with their indexes
3. browser_select_tab(index=N) -> switch to desired tab

Can also connect and list in one call:
browser_list_tabs(browserURL="http://127.0.0.1:9222")
browser_list_tabs(autoConnect=true, channel="stable")`,
    inputSchema: {
      type: 'object',
      properties: {
        browserURL: {
          type: 'string',
          description:
            'Optional: connect to this browser URL before listing (e.g. http://127.0.0.1:9222)',
        },
        wsEndpoint: {
          type: 'string',
          description: 'Optional: connect to this browser WebSocket endpoint before listing.',
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
  // Reclassified analysis helpers
  {
    name: 'framework_state_extract',
    description:
      'Extract React/Vue component state from the live page. Useful for debugging frontend applications and finding hidden state.',
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
          description:
            'CSS selector of root element to inspect (default: #root, #app, [data-reactroot], body)',
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
    description:
      'Dump all IndexedDB databases and their contents. Useful for analyzing PWA data, stored tokens, or offline application state.',
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
