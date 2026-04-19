import { describe, expect, it } from 'vitest';
import { browserSecurityStateTools } from '@server/domains/browser/definitions.tools.security';

function getTool(name: string) {
  const tool = browserSecurityStateTools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe('browserSecurityStateTools', () => {
  it('describes captcha_detect as AI vision + rule-based analysis', () => {
    const tool = getTool('captcha_detect');

    expect(tool.description).toContain('AI vision');
    expect(tool.description).not.toContain('the screenshot is provided as base64');
    expect(tool.description).not.toContain('- screenshot: base64 screenshot');
  });

  it('describes captcha_wait as polling until CAPTCHA disappears', () => {
    const tool = getTool('captcha_wait');

    expect(tool.description).toContain('manual');
    expect(tool.description).not.toContain('Browser switches to headed (visible) mode');
  });

  it('describes captcha_config concisely', () => {
    const tool = getTool('captcha_config');

    expect(tool.description).toContain('CAPTCHA');
    expect(tool.description).not.toContain('auto-detect CAPTCHA after page_navigate');
  });
});
