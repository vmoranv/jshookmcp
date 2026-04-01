import { describe, expect, it } from 'vitest';
import * as Registry from '@server/domains/shared/registry';

describe('shared/registry', () => {
  it('should export registry items', () => {
    expect(Registry.toolLookup).toBeDefined();
    expect(Registry.bindByDepKey).toBeDefined();
    expect(Registry.getDep).toBeDefined();
    expect(Registry.ensureBrowserCore).toBeDefined();
  });
});
