import { describe, expect, it } from 'vitest';

import * as generators from '@modules/hook/HookGeneratorBuilders.core.generators';
import * as compose from '@modules/hook/HookGeneratorBuilders.core.generators.compose';
import * as network from '@modules/hook/HookGeneratorBuilders.core.generators.network';
import * as runtime from '@modules/hook/HookGeneratorBuilders.core.generators.runtime';
import * as storage from '@modules/hook/HookGeneratorBuilders.core.generators.storage';

describe('HookGeneratorBuilders.core.generators.ts', () => {
  it('aggregates runtime, network, storage and compose generator helpers', () => {
    expect(generators.generateFunctionHook).toBe(runtime.generateFunctionHook);
    expect(generators.generateEvalHook).toBe(runtime.generateEvalHook);
    expect(generators.generateObjectMethodHook).toBe(runtime.generateObjectMethodHook);
    expect(generators.generateAntiDebugBypass).toBe(runtime.generateAntiDebugBypass);
    expect(generators.generateHookTemplate).toBe(runtime.generateHookTemplate);

    expect(generators.generateXHRHook).toBe(network.generateXHRHook);
    expect(generators.generateFetchHook).toBe(network.generateFetchHook);
    expect(generators.generateWebSocketHook).toBe(network.generateWebSocketHook);

    expect(generators.generateCookieHook).toBe(storage.generateCookieHook);
    expect(generators.generateLocalStorageHook).toBe(storage.generateLocalStorageHook);
    expect(generators.getInjectionInstructions).toBe(storage.getInjectionInstructions);

    expect(generators.generateHookChain).toBe(compose.generateHookChain);
  });
});
