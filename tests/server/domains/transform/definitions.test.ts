import { describe, expect, it } from 'vitest';
import { transformTools } from '@server/domains/transform/definitions';

describe('transform definitions', () => {
  const getTool = (name: string) => transformTools.find((tool) => tool.name === name);

  it('marks crypto_test_harness as a read-only deterministic helper', async () => {
    const tool = getTool('crypto_test_harness');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    });
  });

  it('marks crypto_compare as a read-only deterministic helper', async () => {
    const tool = getTool('crypto_compare');
    expect(tool?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
    });
  });
});
