import { expect } from 'vitest';

export type Driver = 'chrome' | 'camoufox';
export type Platform = 'windows' | 'mac' | 'linux';

export type TextResponse = {
  content: Array<{
    text: string;
    type?: string;
  }>;
};

export type StealthInjectResponse = {
  success: boolean;
  driver?: Driver;
  message: string;
  fingerprintApplied?: boolean;
  _nextStepHint?: string;
};

export type StealthSetUserAgentResponse = {
  success: boolean;
  platform: Platform;
  message: string;
  _nextStepHint?: string;
};

export function parseJson<T>(response: TextResponse): T {
  const text = response.content?.[0]?.text;
  if (!text) {
    throw new Error('Failed to parse JSON from response: content is empty or missing text.');
  }
  return JSON.parse(text) as T;
}

export function expectNextStepHint(
  body: { _nextStepHint?: string },
  expectedText: string
): void {
  expect(body._nextStepHint).toEqual(expect.any(String));
  expect(body._nextStepHint).toContain(expectedText);
}
