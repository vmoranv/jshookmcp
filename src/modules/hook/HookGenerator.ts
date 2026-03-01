import type { HookOptions } from '../../types/index.js';
import {
  generateFunctionHook,
  generateXHRHook,
  generateFetchHook,
  generateWebSocketHook,
  generateLocalStorageHook,
  generateCookieHook,
  getInjectionInstructions,
  generateEvalHook,
  generateObjectMethodHook,
  generateAntiDebugBypass,
  generateHookTemplate,
  generateHookChain,
} from './HookGeneratorBuilders.js';

export {
  generateFunctionHook,
  generateXHRHook,
  generateFetchHook,
  generateWebSocketHook,
  generateLocalStorageHook,
  generateCookieHook,
  getInjectionInstructions,
  generateEvalHook,
  generateObjectMethodHook,
  generateAntiDebugBypass,
  generateHookTemplate,
  generateHookChain,
};

export function generateHookScript(
  target: string,
  type: HookOptions['type'],
  action: string,
  customCode?: string,
  condition?: HookOptions['condition'],
  performance = false
): string {
  switch (type) {
    case 'function':
      return generateFunctionHook(target, action, customCode, condition, performance);
    case 'xhr':
      return generateXHRHook(action, customCode, condition, performance);
    case 'fetch':
      return generateFetchHook(action, customCode, condition, performance);
    case 'websocket':
      return generateWebSocketHook(action, customCode, condition, performance);
    case 'localstorage':
      return generateLocalStorageHook(action, customCode, condition, performance);
    case 'cookie':
      return generateCookieHook(action, customCode, condition, performance);
    case 'eval':
      return generateEvalHook(action, customCode, condition, performance);
    case 'object-method':
      return generateObjectMethodHook(target, action, customCode, condition, performance);
    default:
      throw new Error(`Unsupported hook type: ${type}`);
  }
}
