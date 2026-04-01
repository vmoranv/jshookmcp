import { mkdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

mkdirSync('coverage/.tmp', { recursive: true });

describe('coverage bootstrap', () => {
  it('ensures the Vitest coverage temp directory exists', () => {
    expect(true).toBe(true);
  });
});
