import { describe, expect, it } from 'vitest';
import { behaviorTools } from '@server/domains/browser/definitions.tools.behavior';

function getTool(name: string) {
  const tool = behaviorTools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe('behaviorTools', () => {
  it('describes captcha_vision_solve with generic mode and challenge type fields', () => {
    const tool = getTool('captcha_vision_solve');
    const props = tool.inputSchema.properties as Record<string, { description?: string }>;

    expect(tool.description).toContain('mode: "external_service"');
    expect(tool.description).toContain('challenge class (`image` or `widget`)');
    expect(tool.description).not.toContain('2captcha');
    expect(tool.description).not.toContain('reCAPTCHA');
    expect(tool.description).not.toContain('hCaptcha');
    expect(props.mode).toBeDefined();
    expect(props.challengeType).toBeDefined();
  });

  it('exposes a generic widget_challenge_solve tool without product branding', () => {
    const tool = getTool('widget_challenge_solve');
    const props = tool.inputSchema.properties as Record<string, { description?: string }>;

    expect(tool.description).toContain('embedded widget challenge');
    expect(tool.description).not.toContain('Turnstile');
    expect(tool.description).not.toContain('Cloudflare');
    expect(tool.description).not.toContain('capsolver');
    expect(props.mode).toBeDefined();
    expect(props.provider).toBeDefined();
  });
});
