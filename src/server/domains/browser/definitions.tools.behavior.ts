import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { tool } from '@server/registry/tool-builder';

export const behaviorTools: Tool[] = [
  tool('human_mouse', (t) =>
    t
      .desc('Move mouse along a Bezier curve with jitter.')
      .number('fromX', 'Start X')
      .number('fromY', 'Start Y')
      .number('toX', 'Target X')
      .number('toY', 'Target Y')
      .string('selector', 'CSS selector (alternative to toX/toY)')
      .number('durationMs', 'Duration ms', { default: 600 })
      .number('steps', 'Intermediate points', { default: 24 })
      .number('jitterPx', 'Max jitter px', { default: 1.5 })
      .enum('curve', ['ease', 'linear', 'ease-in', 'ease-out'], 'Speed curve', {
        default: 'ease',
      })
      .boolean('click', 'Click at destination', { default: false })
      .openWorld(),
  ),
  tool('human_scroll', (t) =>
    t
      .desc('Scroll with human-like speed variation.')
      .number('distance', 'Distance px', { default: 500 })
      .enum('direction', ['up', 'down', 'left', 'right'], 'Direction', {
        default: 'down',
      })
      .number('durationMs', 'Duration ms', { default: 1500 })
      .number('segments', 'Segments', { default: 8 })
      .number('pauseMs', 'Pause between segments ms', { default: 80 })
      .number('jitter', 'Variation factor 0-1', { default: 0.3 })
      .string('selector', 'Scrollable container selector')
      .openWorld(),
  ),
  tool('human_typing', (t) =>
    t
      .desc('Type text with human-like speed and occasional typos.')
      .string('selector', 'CSS selector')
      .string('text', 'Text to type')
      .number('wpm', 'Words per minute', { default: 90 })
      .number('errorRate', 'Typo probability per char', {
        default: 0.02,
      })
      .number('correctDelayMs', 'Delay before correcting typo ms', {
        default: 200,
      })
      .boolean('clearFirst', 'Clear existing value first', {
        default: false,
      })
      .requiredOpenWorld('selector', 'text'),
  ),
  tool('captcha_vision_solve', (t) =>
    t
      .desc('Solve CAPTCHA via external service or AI vision.')
      .enum('mode', ['external_service', 'manual'], 'Solver mode')
      .string('provider', 'External solver provider')
      .string('apiKey', 'API key')
      .enum('challengeType', ['image', 'widget', 'browser_check', 'auto'], 'Challenge type', {
        default: 'auto',
      })
      .string('typeHint', 'Legacy alias for challengeType')
      .string('siteKey', 'Widget site key')
      .string('pageUrl', 'Page URL')
      .number('timeoutMs', 'Timeout ms', { default: 180000 })
      .number('maxRetries', 'Max retries', { default: 2 })
      .openWorld(),
  ),
  tool('widget_challenge_solve', (t) =>
    t
      .desc('Solve embedded widget challenge.')
      .string('siteKey', 'Widget site key')
      .string('pageUrl', 'Page URL')
      .enum('mode', ['external_service', 'hook', 'manual'], 'Solving mode')
      .string('provider', 'External solver provider')
      .string('apiKey', 'API key')
      .number('timeoutMs', 'Timeout ms', { default: 120000 })
      .boolean('injectToken', 'Auto-inject token', {
        default: true,
      })
      .openWorld(),
  ),
];
