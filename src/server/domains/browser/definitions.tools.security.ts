import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const browserSecurityStateTools: Tool[] = [
  tool('captcha_detect', (t) => t.desc('Detect CAPTCHAs on the current page.').query()),
  tool('captcha_wait', (t) =>
    t
      .desc('Block until the user manually solves the CAPTCHA.')
      .number('timeout', 'Timeout in ms', { default: 300000 })
      .query()
      .openWorld(),
  ),
  tool('captcha_config', (t) =>
    t
      .desc('Configure CAPTCHA detection sensitivity and solver backend.')
      .boolean('autoDetectCaptcha', 'Auto-detect after navigation')
      .boolean('autoSwitchHeadless', 'Switch to headed on detection')
      .number('captchaTimeout', 'Wait timeout in ms')
      .idempotent(),
  ),
  tool('stealth_inject', (t) =>
    t.desc('Inject anti-detection scripts to reduce bot fingerprint exposure.').idempotent(),
  ),
  tool('stealth_set_user_agent', (t) =>
    t
      .desc('Set User-Agent and fingerprint.')
      .enum('platform', ['windows', 'mac', 'linux'], 'Platform', { default: 'windows' })
      .idempotent(),
  ),
  tool('stealth_configure_jitter', (t) =>
    t
      .desc('Configure CDP timing jitter.')
      .boolean('enabled', 'Enable', { default: true })
      .number('minDelayMs', 'Min delay ms', { default: 20 })
      .number('maxDelayMs', 'Max delay ms', { default: 80 })
      .boolean('burstMode', 'Skip jitter for time-critical ops', { default: false })
      .idempotent(),
  ),
  tool('stealth_generate_fingerprint', (t) =>
    t
      .desc('Generate a browser fingerprint.')
      .enum('os', ['windows', 'macos', 'linux'], 'Target OS')
      .enum('browser', ['chrome', 'firefox'], 'Target browser', { default: 'chrome' })
      .string('locale', 'Locale', { default: 'en-US' }),
  ),
  tool('stealth_verify', (t) => t.desc('Run anti-detection checks.').query()),
  tool('browser_font_fingerprint', (t) =>
    t
      .desc(
        'Enumerate locally-installed fonts for fingerprint analysis. Primary path is the ' +
          'Local Font Access API (queryLocalFonts, Chromium 103+); when unavailable or ' +
          'denied, falls back to a small document.fonts.check probe set. Returns the detected ' +
          'font set, a stable hash for comparison, and optionally spoofs the font fingerprint.',
      )
      .boolean('useLocalFontApi', 'Prefer queryLocalFonts() enumeration (richer)', {
        default: true,
      })
      .boolean('spoof', 'Override document.fonts.check to a spoofed result', { default: false })
      .number('maxFonts', 'Cap on enumerated local fonts', { default: 2000 })
      .query()
      .openWorld(),
  ),
  tool('browser_list_tabs', (t) =>
    t
      .desc('List open browser tabs with URLs and titles.')
      .string('browserURL', 'Browser URL')
      .string('wsEndpoint', 'WebSocket endpoint')
      .boolean('autoConnect', 'Auto-detect Chrome debug WebSocket', { default: false })
      .enum('channel', ['stable', 'beta', 'dev', 'canary'], 'Chrome channel', {
        default: 'stable',
      })
      .string('userDataDir', 'Chrome profile directory')
      .query()
      .openWorld(),
  ),
  tool('browser_select_tab', (t) =>
    t
      .desc('Switch active tab by index, URL pattern, or title pattern.')
      .number('index', 'Tab index')
      .string('urlPattern', 'URL substring match')
      .string('titlePattern', 'Title substring match')
      .idempotent(),
  ),
  tool('framework_state_extract', (t) =>
    t
      .desc('Extract React/Vue/Svelte/Solid component state and meta-framework info.')
      .enum(
        'framework',
        ['auto', 'react', 'vue2', 'vue3', 'svelte', 'solid', 'preact'],
        'Framework',
        { default: 'auto' },
      )
      .string('selector', 'Root element CSS selector')
      .number('maxDepth', 'Max traversal depth', { default: 5 })
      .query()
      .openWorld(),
  ),
  tool('indexeddb_dump', (t) =>
    t
      .desc('Export all IndexedDB databases and records for offline analysis.')
      .string('database', 'Database name')
      .string('store', 'Object store name')
      .number('maxRecords', 'Max records per store', { default: 100 })
      .query(),
  ),
  tool('camoufox_geolocation', (t) =>
    t
      .desc('Get geolocation for a locale.')
      .string('locale', 'Locale string')
      .string('proxy', 'Proxy URL for IP lookup')
      .required('locale')
      .query(),
  ),
  tool('browser_passkey_seed', (t) =>
    t
      .desc('Seed a WebAuthn/Passkey credential into the browser for test automation.')
      .string('relyingPartyId', 'Relying party ID (e.g. example.com)')
      .string('credentialId', 'Base64-encoded credential ID')
      .string('userHandle', 'Base64-encoded user handle')
      .string('privateKey', 'Base64-encoded PKCS#8 private key')
      .string('publicKey', 'Base64-encoded public key (optional but recommended)')
      .string('userDisplayName', 'Display name for the credential owner')
      .required('relyingPartyId', 'credentialId', 'userHandle', 'privateKey')
      .destructive()
      .idempotent(),
  ),
];
