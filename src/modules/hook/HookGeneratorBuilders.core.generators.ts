export {
  generateAntiDebugBypass,
  generateEvalHook,
  generateFunctionHook,
  generateHookTemplate,
  generateObjectMethodHook,
} from './HookGeneratorBuilders.core.generators.runtime.js';

export {
  generateFetchHook,
  generateWebSocketHook,
  generateXHRHook,
} from './HookGeneratorBuilders.core.generators.network.js';

export {
  generateCookieHook,
  generateLocalStorageHook,
  getInjectionInstructions,
} from './HookGeneratorBuilders.core.generators.storage.js';

export { generateHookChain } from './HookGeneratorBuilders.core.generators.compose.js';
