import { describe, it, expect, vi, beforeEach } from 'vitest';

import { mergeUnique } from '@modules/captcha/rules/shared';

describe('captcha shared helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('deduplicates string values while preserving first-seen order', () => {
    expect(mergeUnique(['slider', 'widget', 'slider', 'text'])).toEqual([
      'slider',
      'widget',
      'text',
    ]);
  });
});
