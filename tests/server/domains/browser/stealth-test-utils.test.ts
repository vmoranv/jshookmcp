import { describe, expect, it } from 'vitest';

import { parseJson } from './stealth-test-utils';

describe('stealth-test-utils', () => {
  describe('parseJson', () => {
    it('parses JSON from the first content item', () => {
      const parsed = parseJson<{ success: boolean }>({
        content: [{ type: 'text', text: '{"success":true}' }],
      });

      expect(parsed).toEqual({ success: true });
    });

    it('throws a descriptive error when content text is missing', () => {
      expect(() =>
        parseJson({
          content: [{ type: 'text' } as any],
        })
      ).toThrow('Failed to parse JSON from response: content is empty or missing text.');
    });

    it('throws a descriptive error when content is empty', () => {
      expect(() =>
        parseJson({
          content: [],
        })
      ).toThrow('Failed to parse JSON from response: content is empty or missing text.');
    });
  });
});
