import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const behaviorTools: Tool[] = [
  tool('human_mouse', (t) =>
    t
      .desc(
        `Move mouse along a natural Bezier curve with jitter. Use before page_click for anti-bot.`,
      )
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
      .desc(`Scroll with human-like behavior: variable speed, micro-pauses, deceleration.`)
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
      .desc(`Type text with human-like patterns: variable speed, occasional typos, corrections.`)
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
      .desc(`Solve CAPTCHA via external service or AI vision. Auto-detects challenge type.`)
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
      .desc(`Solve embedded widget challenge: detect, solve, inject token, trigger callback.`)
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
