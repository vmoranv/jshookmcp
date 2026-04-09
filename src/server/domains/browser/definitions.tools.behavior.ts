import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

/**
 * Human behavior simulation and captcha solving tools.
 * These tools enhance anti-detection capabilities.
 */
export const behaviorTools: Tool[] = [
  tool('human_mouse', (t) =>
    t
      .desc(`Move the mouse along a natural Bezier curve path with random jitter.

Simulates human-like mouse movement using cubic Bezier curves with:
- Non-linear speed (ease-in-out)
- Configurable jitter/noise
- Viewport-clamped trajectory

Use this before page_click for anti-bot bypass on browser-check or widget challenges.

Example:
  human_mouse({ toX: 500, toY: 300, durationMs: 800 })`)
      .number('fromX', 'Start X coordinate (default: current mouse position or 0)')
      .number('fromY', 'Start Y coordinate (default: current mouse position or 0)')
      .number('toX', 'Target X coordinate')
      .number('toY', 'Target Y coordinate')
      .string(
        'selector',
        'CSS selector to move to (alternative to toX/toY — auto-resolves element center)',
      )
      .number('durationMs', 'Movement duration in ms (default: 600)', { default: 600 })
      .number('steps', 'Number of intermediate points (default: 24)', { default: 24 })
      .number('jitterPx', 'Max random offset per step in pixels (default: 1.5)', { default: 1.5 })
      .enum('curve', ['ease', 'linear', 'ease-in', 'ease-out'], 'Speed curve (default: ease)', {
        default: 'ease',
      })
      .boolean('click', 'Click at destination after movement (default: false)', { default: false })
      .openWorld(),
  ),
  tool('human_scroll', (t) =>
    t
      .desc(`Scroll the page with human-like behavior: variable speed, micro-pauses, and deceleration.

Simulates natural scrolling patterns:
- Segmented scroll with random segment sizes
- Brief pauses between segments
- Velocity deceleration near the end

Example:
  human_scroll({ distance: 1000, direction: "down", durationMs: 2000 })`)
      .number('distance', 'Total scroll distance in pixels (default: 500)', { default: 500 })
      .enum('direction', ['up', 'down', 'left', 'right'], 'Scroll direction (default: down)', {
        default: 'down',
      })
      .number('durationMs', 'Total scroll duration in ms (default: 1500)', { default: 1500 })
      .number('segments', 'Number of scroll segments (default: 8)', { default: 8 })
      .number('pauseMs', 'Average pause between segments in ms (default: 80)', { default: 80 })
      .number('jitter', 'Random variation factor 0-1 (default: 0.3)', { default: 0.3 })
      .string('selector', 'CSS selector of scrollable container (default: window)')
      .openWorld(),
  ),
  tool('human_typing', (t) =>
    t
      .desc(`Type text with human-like patterns: variable speed, occasional typos, and natural corrections.

Features:
- Per-character random delay based on WPM
- Configurable typo rate with auto-correction (backspace + retype)
- Word boundary pauses
- Shift key simulation for uppercase

Use this instead of page_type for anti-bot bypass.

Example:
  human_typing({ selector: "#email", text: "user@example.com", wpm: 80 })`)
      .string('selector', 'CSS selector of the input field')
      .string('text', 'Text to type')
      .number('wpm', 'Words per minute (default: 90)', { default: 90 })
      .number('errorRate', 'Probability of typo per character 0-0.2 (default: 0.02)', {
        default: 0.02,
      })
      .number('correctDelayMs', 'Delay before correcting a typo in ms (default: 200)', {
        default: 200,
      })
      .boolean('clearFirst', 'Clear existing value before typing (default: false)', {
        default: false,
      })
      .requiredOpenWorld('selector', 'text'),
  ),
  tool('captcha_vision_solve', (t) =>
    t
      .desc(`Attempt to solve a CAPTCHA using an external solving service or AI vision.

Public contract:
- \`mode: "external_service"\` routes to the configured solver backend
- \`mode: "manual"\` waits for the user to solve manually

Automatically detects the challenge class (\`image\` or \`widget\`) if \`challengeType\` is omitted.

Example:
  captcha_vision_solve({ mode: "external_service", apiKey: "..." })`)
      .enum(
        'mode',
        ['external_service', 'manual'],
        'Solver mode (default: from config or "manual")',
      )
      .string('provider', 'Deprecated legacy external-service override; avoid in new callers')
      .string('apiKey', 'External solver API key (default: from CAPTCHA_API_KEY env)')
      .enum(
        'challengeType',
        ['image', 'widget', 'browser_check', 'auto'],
        'Generic challenge type hint (default: auto-detect)',
        { default: 'auto' },
      )
      .string('typeHint', 'Deprecated legacy alias for challengeType; avoid in new callers')
      .string('siteKey', 'Widget site key (auto-extracted if omitted)')
      .string('pageUrl', 'Page URL for context (auto-detected if omitted)')
      .number('timeoutMs', 'Max solve time in ms (default: 180000)', { default: 180000 })
      .number('maxRetries', 'Max retry attempts (default: 2)', { default: 2 })
      .openWorld(),
  ),
  tool('widget_challenge_solve', (t) =>
    t
      .desc(`Solve an embedded widget challenge.

Strategy:
1. Detect the widget and extract siteKey
2. Send to the configured external solver service (or hook the page callback to extract token)
3. Inject the solved token back into the page
4. Trigger callback to proceed

Requires either external solver credentials or uses the built-in hook approach.

Example:
  widget_challenge_solve({ mode: "external_service" })`)
      .string('siteKey', 'Widget site key (auto-detected if omitted)')
      .string('pageUrl', 'Page URL (auto-detected if omitted)')
      .enum(
        'mode',
        ['external_service', 'hook', 'manual'],
        'Solving mode (default: from config or "manual")',
      )
      .string('provider', 'Deprecated legacy external-service override; avoid in new callers')
      .string('apiKey', 'External solver API key')
      .number('timeoutMs', 'Max solve time in ms (default: 120000)', { default: 120000 })
      .boolean('injectToken', 'Auto-inject solved token into page (default: true)', {
        default: true,
      })
      .openWorld(),
  ),
];
