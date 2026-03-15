import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as builders from '@modules/hook/HookGeneratorBuilders';
import * as core from '@modules/hook/HookGeneratorBuilders.core';
import * as compose from '@modules/hook/HookGeneratorBuilders.core.generators.compose';
import * as generators from '@modules/hook/HookGeneratorBuilders.core.generators';
import * as network from '@modules/hook/HookGeneratorBuilders.core.generators.network';
import * as runtime from '@modules/hook/HookGeneratorBuilders.core.generators.runtime';
import * as storage from '@modules/hook/HookGeneratorBuilders.core.generators.storage';

const asMap = (value: object) => value as Record<string, unknown>;

describe('HookGeneratorBuilders re-exports', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('re-exports the full core surface from HookGeneratorBuilders', () => {
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

  it('re-exports the aggregated generator surface from HookGeneratorBuilders.core', () => {
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

  it('aggregates runtime, network, storage and compose helpers in the generators entrypoint', () => {
    expect(generators.generateFunctionHook).toBe(runtime.generateFunctionHook);
    expect(generators.generateEvalHook).toBe(runtime.generateEvalHook);
    expect(generators.generateObjectMethodHook).toBe(runtime.generateObjectMethodHook);
    expect(generators.generateAntiDebugBypass).toBe(runtime.generateAntiDebugBypass);
    expect(generators.generateHookTemplate).toBe(runtime.generateHookTemplate);

    expect(generators.generateXHRHook).toBe(network.generateXHRHook);
    expect(generators.generateFetchHook).toBe(network.generateFetchHook);
    expect(generators.generateWebSocketHook).toBe(network.generateWebSocketHook);

    expect(generators.generateLocalStorageHook).toBe(storage.generateLocalStorageHook);
    expect(generators.generateCookieHook).toBe(storage.generateCookieHook);
    expect(generators.getInjectionInstructions).toBe(storage.getInjectionInstructions);

    expect(generators.generateHookChain).toBe(compose.generateHookChain);
  });
});
