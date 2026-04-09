import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const browserSecurityStateTools: Tool[] = [
  tool('captcha_detect', (t) =>
    t
      .desc(`Detect CAPTCHA on the current page using AI vision analysis.

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
Use an external AI (GPT-4o, Claude 3) to analyze the saved screenshot if needed.`)
      .query(),
  ),
  tool('captcha_wait', (t) =>
    t
      .desc(`Wait for the user to manually solve a CAPTCHA.

Steps:
1. CAPTCHA is detected on the page
2. This tool polls the current page until the CAPTCHA is no longer detected
3. User solves the CAPTCHA manually in the active browser/page
4. Script resumes automatically after detection

Note: this tool does not switch browser modes on its own.

Timeout: default 300000ms (5 minutes)`)
      .number('timeout', 'Timeout in milliseconds (default: 300000 = 5 minutes)', {
        default: 300000,
      })
      .query()
      .openWorld(),
  ),
  tool('captcha_config', (t) =>
    t
      .desc(`Configure CAPTCHA detection behavior.

Parameters:
- autoDetectCaptcha: enable CAPTCHA auto-handling for browser-mode integrations that use these settings
- autoSwitchHeadless: allow supported integrations to switch to headed mode when CAPTCHA is detected
- captchaTimeout: timeout for waiting user to solve CAPTCHA in ms (default: 300000)`)
      .boolean('autoDetectCaptcha', 'Whether to automatically detect CAPTCHA after navigation')
      .boolean(
        'autoSwitchHeadless',
        'Whether to automatically switch to headed mode when CAPTCHA detected',
      )
      .number('captchaTimeout', 'Timeout for waiting user to complete CAPTCHA (milliseconds)')
      .idempotent(),
  ),
  tool('stealth_inject', (t) =>
    t
      .desc(`Inject modern stealth scripts to bypass bot detection.

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
Call after browser_launch for best results.`)
      .idempotent(),
  ),
  tool('stealth_set_user_agent', (t) =>
    t
      .desc(`Set a realistic User-Agent and browser fingerprint for the target platform.

Updates navigator.userAgent, navigator.platform, navigator.vendor,
navigator.hardwareConcurrency, and navigator.deviceMemory consistently
to avoid fingerprint inconsistencies.

UA strings are updated to Chrome 131 with platform-appropriate hardware profiles.`)
      .enum('platform', ['windows', 'mac', 'linux'], 'Target platform', { default: 'windows' })
      .idempotent(),
  ),
  tool('stealth_configure_jitter', (t) =>
    t
      .desc(`Configure CDP command timing jitter to mimic natural network latency.

Jitter adds random delays to CDP commands to prevent timing-based bot detection.
Default: 20-80ms uniform random delay on all CDP send() calls.

Parameters:
- enabled: turn jitter on/off
- minDelayMs: minimum delay in milliseconds
- maxDelayMs: maximum delay in milliseconds
- burstMode: skip jitter for time-critical operations (debugging, breakpoints)`)
      .boolean('enabled', 'Enable/disable jitter', { default: true })
      .number('minDelayMs', 'Minimum delay (ms)', { default: 20 })
      .number('maxDelayMs', 'Maximum delay (ms)', { default: 80 })
      .boolean('burstMode', 'Skip jitter for time-critical ops', { default: false })
      .idempotent(),
  ),
  tool('stealth_generate_fingerprint', (t) =>
    t
      .desc(`Generate a realistic browser fingerprint using real-world datasets.

Requires fingerprint-generator and fingerprint-injector packages (optional dependencies).
The generated fingerprint is cached per session and auto-applied on next stealth_inject.

Covers: screen resolution, WebGL params, fonts, codecs, AudioContext, navigator properties.
Falls back to built-in StealthScripts patches if packages are not installed.`)
      .enum('os', ['windows', 'macos', 'linux'], 'Target OS for fingerprint')
      .enum('browser', ['chrome', 'firefox'], 'Target browser', { default: 'chrome' })
      .string('locale', 'Locale string (e.g. en-US)', { default: 'en-US' }),
  ),
  tool('stealth_verify', (t) =>
    t
      .desc(`Run offline anti-detection checks on the current page.

Verifies that stealth patches are working correctly by checking:
- navigator.webdriver absence
- window.chrome object structure
- navigator.plugins list
- UA/platform consistency
- WebGL vendor/renderer
- Canvas noise injection
- cdc_ variable cleanup
- Hardware profile consistency

Returns a structured report with pass/fail for each check, an overall score (0-100),
and recommendations for improving detection evasion.

Best used after stealth_inject to verify patches are effective.`)
      .query(),
  ),
  tool('browser_list_tabs', (t) =>
    t
      .desc(`List all open tabs/pages in the connected browser.

Use this after browser_attach to see all available pages/tabs.
Returns index, URL, and title for each tab.

Workflow:
1. browser_attach(browserURL="http://127.0.0.1:9222") or browser_attach(autoConnect=true)
2. browser_list_tabs() -> see all tabs with their indexes
3. browser_select_tab(index=N) -> switch to desired tab

Can also connect and list in one call:
browser_list_tabs(browserURL="http://127.0.0.1:9222")
browser_list_tabs(autoConnect=true, channel="stable")`)
      .string(
        'browserURL',
        'Optional: connect to this browser URL before listing (e.g. http://127.0.0.1:9222)',
      )
      .string('wsEndpoint', 'Optional: connect to this browser WebSocket endpoint before listing.')
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
      .query()
      .openWorld(),
  ),
  tool('browser_select_tab', (t) =>
    t
      .desc(`Switch the active tab/page by index or URL/title pattern.

After browser_list_tabs, use this to activate a specific tab.
All subsequent page_* tools will operate on the selected tab.
Console/network monitoring is rebound lazily on the next console_* or network_* call, so tab switching itself stays side-effect free.

Response notes:
- contextSwitched: tab context switched successfully
- monitoringBindingDeferred: monitoring will auto-rebind later if needed

Examples:
- browser_select_tab(index=0) -> first tab
- browser_select_tab(urlPattern="qwen") -> tab whose URL contains "qwen"
- browser_select_tab(titlePattern="Mini Program") -> tab whose title contains "Mini Program"`)
      .number('index', 'Tab index from browser_list_tabs (0-based)')
      .string('urlPattern', 'Substring to match against tab URLs')
      .string('titlePattern', 'Substring to match against tab titles')
      .idempotent(),
  ),
  tool('framework_state_extract', (t) =>
    t
      .desc(
        'Extract component state from the live page. Supports React, Vue 2/3, Svelte 3/4/5, Solid.js, and Preact. Also detects Next.js/Nuxt meta-framework metadata (routes, build info, payload). Useful for debugging frontend applications, reverse-engineering SPA state, and finding hidden data.',
      )
      .enum(
        'framework',
        ['auto', 'react', 'vue2', 'vue3', 'svelte', 'solid', 'preact'],
        'Framework to target. auto = detect automatically.',
        { default: 'auto' },
      )
      .string(
        'selector',
        'CSS selector of root element to inspect (default: #root, #app, [data-reactroot], body)',
      )
      .number('maxDepth', 'Maximum component tree depth to traverse', { default: 5 })
      .query(),
  ),
  tool('indexeddb_dump', (t) =>
    t
      .desc(
        'Dump all IndexedDB databases and their contents. Useful for analyzing PWA data, stored tokens, or offline application state.',
      )
      .string('database', 'Specific database name to dump (default: all databases)')
      .string('store', 'Specific object store to dump (default: all stores)')
      .number('maxRecords', 'Maximum records per store to return', { default: 100 })
      .query(),
  ),
];
