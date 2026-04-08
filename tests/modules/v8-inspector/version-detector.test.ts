/* eslint-disable unicorn/consistent-function-scoping */
import { describe, expect, it, vi } from 'vitest';
import { VersionDetector } from '@modules/v8-inspector/VersionDetector';

function createDetector(
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
) {
  const session = {
    send: vi.fn(send),
    detach: vi.fn().mockResolvedValue(undefined),
  };
  const page = {
    createCDPSession: vi.fn().mockResolvedValue(session),
  };
  return { detector: new VersionDetector(() => Promise.resolve(page)), session };
}

describe('VersionDetector', () => {
  it('parses raw V8 version strings', () => {
    const detector = new VersionDetector();
    expect(detector.parseV8Version('12.0.226.10')).toMatchObject({
      major: 12,
      minor: 0,
      patch: 226,
      commit: '10',
    });
  });

  it('detects browser version via Browser.getVersion', async () => {
    const { detector } = createDetector(async (method) => {
      if (method === 'Browser.getVersion') {
        return { jsVersion: '12.0.226.10' };
      }
      return {};
    });
    const version = await detector.detectV8Version();
    expect(version).toMatchObject({ major: 12, minor: 0, patch: 226, commit: '10' });
  });

  it('returns false when natives syntax is unavailable', async () => {
    const { detector } = createDetector(async (method) => {
      if (method === 'Runtime.evaluate') {
        return { result: { value: false } };
      }
      return {};
    });
    await expect(detector.supportsNativesSyntax()).resolves.toBe(false);
  });

  it('returns true when Runtime.evaluate reports natives support', async () => {
    const { detector } = createDetector(async (method) => {
      if (method === 'Runtime.evaluate') {
        return { result: { value: true } };
      }
      return {};
    });
    await expect(detector.supportsNativesSyntax()).resolves.toBe(true);
  });
});
