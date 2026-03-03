import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Human behavior simulation and captcha solving tools.
 * These tools enhance anti-detection capabilities.
 */
export const behaviorTools: Tool[] = [
  {
    name: 'human_mouse',
    description:
      'Move the mouse along a natural Bezier curve path with random jitter.\n\n' +
      'Simulates human-like mouse movement using cubic Bezier curves with:\n' +
      '- Non-linear speed (ease-in-out)\n' +
      '- Configurable jitter/noise\n' +
      '- Viewport-clamped trajectory\n\n' +
      'Use this before page_click for anti-bot bypass (e.g. Cloudflare, Turnstile).\n\n' +
      'Example:\n' +
      '  human_mouse({ toX: 500, toY: 300, durationMs: 800 })',
    inputSchema: {
      type: 'object',
      properties: {
        fromX: { type: 'number', description: 'Start X coordinate (default: current mouse position or 0)' },
        fromY: { type: 'number', description: 'Start Y coordinate (default: current mouse position or 0)' },
        toX: { type: 'number', description: 'Target X coordinate' },
        toY: { type: 'number', description: 'Target Y coordinate' },
        selector: { type: 'string', description: 'CSS selector to move to (alternative to toX/toY — auto-resolves element center)' },
        durationMs: { type: 'number', description: 'Movement duration in ms (default: 600)', default: 600 },
        steps: { type: 'integer', description: 'Number of intermediate points (default: 24)', default: 24 },
        jitterPx: { type: 'number', description: 'Max random offset per step in pixels (default: 1.5)', default: 1.5 },
        curve: { type: 'string', enum: ['ease', 'linear', 'ease-in', 'ease-out'], description: 'Speed curve (default: ease)', default: 'ease' },
        click: { type: 'boolean', description: 'Click at destination after movement (default: false)', default: false },
      },
    },
  },

  {
    name: 'human_scroll',
    description:
      'Scroll the page with human-like behavior: variable speed, micro-pauses, and deceleration.\n\n' +
      'Simulates natural scrolling patterns:\n' +
      '- Segmented scroll with random segment sizes\n' +
      '- Brief pauses between segments\n' +
      '- Velocity deceleration near the end\n\n' +
      'Example:\n' +
      '  human_scroll({ distance: 1000, direction: "down", durationMs: 2000 })',
    inputSchema: {
      type: 'object',
      properties: {
        distance: { type: 'number', description: 'Total scroll distance in pixels (default: 500)', default: 500 },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction (default: down)', default: 'down' },
        durationMs: { type: 'number', description: 'Total scroll duration in ms (default: 1500)', default: 1500 },
        segments: { type: 'integer', description: 'Number of scroll segments (default: 8)', default: 8 },
        pauseMs: { type: 'number', description: 'Average pause between segments in ms (default: 80)', default: 80 },
        jitter: { type: 'number', description: 'Random variation factor 0-1 (default: 0.3)', default: 0.3 },
        selector: { type: 'string', description: 'CSS selector of scrollable container (default: window)' },
      },
    },
  },

  {
    name: 'human_typing',
    description:
      'Type text with human-like patterns: variable speed, occasional typos, and natural corrections.\n\n' +
      'Features:\n' +
      '- Per-character random delay based on WPM\n' +
      '- Configurable typo rate with auto-correction (backspace + retype)\n' +
      '- Word boundary pauses\n' +
      '- Shift key simulation for uppercase\n\n' +
      'Use this instead of page_type for anti-bot bypass.\n\n' +
      'Example:\n' +
      '  human_typing({ selector: "#email", text: "user@example.com", wpm: 80 })',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input field' },
        text: { type: 'string', description: 'Text to type' },
        wpm: { type: 'integer', description: 'Words per minute (default: 90)', default: 90 },
        errorRate: { type: 'number', description: 'Probability of typo per character 0-0.2 (default: 0.02)', default: 0.02 },
        correctDelayMs: { type: 'number', description: 'Delay before correcting a typo in ms (default: 200)', default: 200 },
        clearFirst: { type: 'boolean', description: 'Clear existing value before typing (default: false)', default: false },
      },
      required: ['selector', 'text'],
    },
  },

  {
    name: 'captcha_vision_solve',
    description:
      'Attempt to solve a CAPTCHA using an external solving service or AI vision.\n\n' +
      'Supports multiple providers through a provider-agnostic interface:\n' +
      '- `2captcha` / `anticaptcha` / `capsolver` — external solving services\n' +
      '- `manual` — wait for user to solve manually (fallback)\n\n' +
      'Automatically detects CAPTCHA type (image, reCAPTCHA, hCaptcha) if typeHint is not provided.\n\n' +
      'Example:\n' +
      '  captcha_vision_solve({ provider: "2captcha", apiKey: "..." })',
    inputSchema: {
      type: 'object',
      properties: {
        provider: {
          type: 'string',
          enum: ['2captcha', 'anticaptcha', 'capsolver', 'manual'],
          description: 'Solving service provider (default: from config or "manual")',
        },
        apiKey: { type: 'string', description: 'Provider API key (default: from CAPTCHA_API_KEY env)' },
        typeHint: {
          type: 'string',
          enum: ['image', 'recaptcha_v2', 'recaptcha_v3', 'hcaptcha', 'funcaptcha', 'turnstile', 'auto'],
          description: 'CAPTCHA type hint (default: auto-detect)',
          default: 'auto',
        },
        siteKey: { type: 'string', description: 'Site key for reCAPTCHA/hCaptcha/Turnstile (auto-extracted if omitted)' },
        pageUrl: { type: 'string', description: 'Page URL for context (auto-detected if omitted)' },
        timeoutMs: { type: 'number', description: 'Max solve time in ms (default: 180000)', default: 180000 },
        maxRetries: { type: 'integer', description: 'Max retry attempts (default: 2)', default: 2 },
      },
    },
  },

  {
    name: 'turnstile_solve',
    description:
      'Solve a Cloudflare Turnstile challenge specifically.\n\n' +
      'Strategy:\n' +
      '1. Detect Turnstile widget and extract siteKey\n' +
      '2. Send to solving service (or hook window.cf to extract token)\n' +
      '3. Inject solved token back into the page\n' +
      '4. Trigger callback to proceed\n\n' +
      'Requires either an external solver API key or uses the built-in hook approach.\n\n' +
      'Example:\n' +
      '  turnstile_solve({ provider: "capsolver" })',
    inputSchema: {
      type: 'object',
      properties: {
        siteKey: { type: 'string', description: 'Turnstile site key (auto-detected if omitted)' },
        pageUrl: { type: 'string', description: 'Page URL (auto-detected if omitted)' },
        provider: {
          type: 'string',
          enum: ['2captcha', 'anticaptcha', 'capsolver', 'hook', 'manual'],
          description: 'Solving method (default: from config or "manual")',
        },
        apiKey: { type: 'string', description: 'Provider API key' },
        timeoutMs: { type: 'number', description: 'Max solve time in ms (default: 120000)', default: 120000 },
        injectToken: { type: 'boolean', description: 'Auto-inject solved token into page (default: true)', default: true },
      },
    },
  },
];
