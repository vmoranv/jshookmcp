export {
  generateAntiDebugBypass,
  generateEvalHook,
  generateFunctionHook,
  generateHookTemplate,
  generateObjectMethodHook,
} from '@modules/hook/HookGeneratorBuilders.core.generators.runtime';

export {
  generateFetchHook,
  generateWebSocketHook,
  generateXHRHook,
} from '@modules/hook/HookGeneratorBuilders.core.generators.network';

export {
  generateCookieHook,
  generateLocalStorageHook,
  getInjectionInstructions,
} from '@modules/hook/HookGeneratorBuilders.core.generators.storage';

export { generateHookChain } from '@modules/hook/HookGeneratorBuilders.core.generators.compose';
