import { describe, expect, it } from 'vitest';

import * as core from '@modules/hook/HookGeneratorBuilders.core';
import * as generators from '@modules/hook/HookGeneratorBuilders.core.generators';

const asMap = (value: object) => value as Record<string, unknown>;

describe('HookGeneratorBuilders.core.ts', () => {
  it('re-exports the aggregated generator surface', () => {
    const exportKeys = [
      'generateAntiDebugBypass',
      'generateCookieHook',
      'generateEvalHook',
      'generateFetchHook',
      'generateFunctionHook',
      'generateHookChain',
      'generateHookTemplate',
      'generateLocalStorageHook',
      'generateObjectMethodHook',
      'generateWebSocketHook',
      'generateXHRHook',
      'getInjectionInstructions',
    ] as const;

    for (const key of exportKeys) {
      expect(asMap(core)[key]).toBe(asMap(generators)[key]);
    }
  });
});
