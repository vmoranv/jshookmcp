/**
 * Hook management handler: manage_hooks
 */

import { argEnum, argString, argStringRequired } from '@server/domains/shared/parse-args';
import { asJsonResponse } from '@server/domains/shared/response';
import type { HookManager } from '@modules/hook/HookManager';
import type { ToolArgs, ToolResponse } from '@server/types';

const HOOK_TYPES = new Set([
  'function',
  'xhr',
  'fetch',
  'websocket',
  'localstorage',
  'cookie',
] as const);
const HOOK_ACTIONS = new Set(['log', 'block', 'modify'] as const);

export async function handleManageHooks(
  args: ToolArgs,
  hookManager: HookManager,
): Promise<ToolResponse> {
  const action = argStringRequired(args, 'action');

  switch (action) {
    case 'create': {
      const result = await hookManager.createHook({
        target: argStringRequired(args, 'target'),
        type: argEnum(args, 'type', HOOK_TYPES) ?? 'function',
        action: argEnum(args, 'hookAction', HOOK_ACTIONS, 'log'),
        customCode: argString(args, 'customCode'),
      });
      return asJsonResponse(result);
    }
    case 'list':
      return asJsonResponse({ hooks: hookManager.getAllHooks() });
    case 'records':
      return asJsonResponse({
        records: hookManager.getHookRecords(argStringRequired(args, 'hookId')),
      });
    case 'clear':
      hookManager.clearHookRecords(argString(args, 'hookId'));
      return asJsonResponse({ success: true, message: 'Hook records cleared' });
    default:
      return asJsonResponse({
        success: false,
        message: `Unknown hook action: ${action}. Valid actions: create, list, records, clear`,
      });
  }
}
