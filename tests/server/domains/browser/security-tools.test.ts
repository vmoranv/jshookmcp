import { describe, expect, it } from 'vitest';
import { browserSecurityStateTools } from '@server/domains/browser/definitions.tools.security';

function getTool(name: string) {
  const tool = browserSecurityStateTools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe('browserSecurityStateTools', () => {
  it('describes captcha_detect using screenshotPath instead of base64 screenshots', () => {
    const tool = getTool('captcha_detect');

    expect(tool.description).toContain('screenshotPath');
    expect(tool.description).not.toContain('the screenshot is provided as base64');
    expect(tool.description).not.toContain('- screenshot: base64 screenshot');
  });

  it('does not claim captcha_wait switches browser modes automatically', () => {
    const tool = getTool('captcha_wait');

    expect(tool.description).toContain('does not switch browser modes on its own');
    expect(tool.description).not.toContain('Browser switches to headed (visible) mode');
  });

  it('does not promise automatic CAPTCHA detection after page_navigate in captcha_config', () => {
    const tool = getTool('captcha_config');

    expect(tool.description).not.toContain('auto-detect CAPTCHA after page_navigate');
    expect(tool.description).toContain('browser-mode integrations');
  });
});
