import { describe, expect, it } from 'vitest';
import { browserSecurityStateTools } from '@server/domains/browser/definitions.tools.security';

function getTool(name: string) {
  const tool = browserSecurityStateTools.find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe('browserSecurityStateTools', () => {
  it('captcha_detect description is concise', async () => {
    const tool = getTool('captcha_detect');

    expect(tool.description).toContain('CAPTCHA');
    expect(tool.description!.length).toBeLessThan(50);
  });

  it('captcha_wait mentions manual solve', async () => {
    const tool = getTool('captcha_wait');

    expect(tool.description).toContain('manual');
  });

  it('captcha_config mentions CAPTCHA', async () => {
    const tool = getTool('captcha_config');

    expect(tool.description).toContain('CAPTCHA');
  });
});
