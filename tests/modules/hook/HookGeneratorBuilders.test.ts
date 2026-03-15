import { describe, expect, it } from 'vitest';

import * as builders from '@modules/hook/HookGeneratorBuilders';
import * as core from '@modules/hook/HookGeneratorBuilders.core';

const asMap = (value: object) => value as Record<string, unknown>;

describe('HookGeneratorBuilders.ts', () => {
  it('re-exports the core builder surface', () => {
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
      expect(asMap(builders)[key]).toBe(asMap(core)[key]);
    }
  });
});
