import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const browserSecurityStateTools: Tool[] = [
  tool('captcha_detect', (t) =>
    t.desc(`Detect CAPTCHA on the current page via AI vision + rule-based analysis.`).query(),
  ),
  tool('captcha_wait', (t) =>
    t
      .desc(`Wait for manual CAPTCHA solve. Polls until CAPTCHA disappears.`)
      .number('timeout', 'Timeout in milliseconds (default: 300000 = 5 minutes)', {
        default: 300000,
      })
      .query()
      .openWorld(),
  ),
  tool('captcha_config', (t) =>
    t
      .desc(`Configure CAPTCHA detection and auto-handling behavior.`)
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
      .desc(
        `Inject stealth scripts: webdriver, chrome, plugins, canvas, WebGL, permissions patches.`,
      )
      .idempotent(),
  ),
  tool('stealth_set_user_agent', (t) =>
    t
      .desc(`Set realistic User-Agent and fingerprint for target platform.`)
      .enum('platform', ['windows', 'mac', 'linux'], 'Target platform', { default: 'windows' })
      .idempotent(),
  ),
  tool('stealth_configure_jitter', (t) =>
    t
      .desc(`Configure CDP command timing jitter to mimic natural network latency.`)
      .boolean('enabled', 'Enable/disable jitter', { default: true })
      .number('minDelayMs', 'Minimum delay (ms)', { default: 20 })
      .number('maxDelayMs', 'Maximum delay (ms)', { default: 80 })
      .boolean('burstMode', 'Skip jitter for time-critical ops', { default: false })
      .idempotent(),
  ),
  tool('stealth_generate_fingerprint', (t) =>
    t
      .desc(
        `Generate browser fingerprint. Chrome: fingerprint-generator. Camoufox: native C++ engine.`,
      )
      .enum('os', ['windows', 'macos', 'linux'], 'Target OS for fingerprint')
      .enum('browser', ['chrome', 'firefox'], 'Target browser', { default: 'chrome' })
      .string('locale', 'Locale string (e.g. en-US)', { default: 'en-US' }),
  ),
  tool('stealth_verify', (t) =>
    t
      .desc(`Run anti-detection checks. Returns pass/fail per check + overall score (0-100).`)
      .query(),
  ),
  tool('browser_list_tabs', (t) =>
    t
      .desc(`List all open tabs/pages. Can auto-connect via browserURL/wsEndpoint/autoConnect.`)
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
      .desc(`Switch active tab by index or URL/title pattern. Console/network rebind lazily.`)
      .number('index', 'Tab index from browser_list_tabs (0-based)')
      .string('urlPattern', 'Substring to match against tab URLs')
      .string('titlePattern', 'Substring to match against tab titles')
      .idempotent(),
  ),
  tool('framework_state_extract', (t) =>
    t
      .desc('Extract component state from the live page (React, Vue, Svelte, Solid, Preact).')
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
      .query()
      .openWorld(),
  ),
  tool('indexeddb_dump', (t) =>
    t
      .desc('Dump IndexedDB databases and their contents.')
      .string('database', 'Specific database name to dump (default: all databases)')
      .string('store', 'Specific object store to dump (default: all stores)')
      .number('maxRecords', 'Maximum records per store to return', { default: 100 })
      .query(),
  ),
  tool('camoufox_geolocation', (t) =>
    t
      .desc(`Get geolocation data for a locale using camoufox IP database. Requires camoufox-js.`)
      .string('locale', 'Locale string, e.g. "en-US" or "zh-CN"')
      .string('proxy', 'Optional proxy URL for IP-based geolocation')
      .required('locale')
      .query(),
  ),
];
