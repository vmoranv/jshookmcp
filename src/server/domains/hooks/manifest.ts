import type { ToolRegistration } from '../../registry/types.js';
import { toolLookup } from '../../registry/types.js';
import { aiHookTools, hookPresetTools } from './definitions.js';

const t = toolLookup([...aiHookTools, ...hookPresetTools]);

export const hooksRegistrations: readonly ToolRegistration[] = [
  { tool: t('ai_hook_generate'), domain: 'hooks', bind: (d) => (a) => d.aiHookHandlers.handleAIHookGenerate(a) },
  { tool: t('ai_hook_inject'), domain: 'hooks', bind: (d) => (a) => d.aiHookHandlers.handleAIHookInject(a) },
  { tool: t('ai_hook_get_data'), domain: 'hooks', bind: (d) => (a) => d.aiHookHandlers.handleAIHookGetData(a) },
  { tool: t('ai_hook_list'), domain: 'hooks', bind: (d) => (a) => d.aiHookHandlers.handleAIHookList(a) },
  { tool: t('ai_hook_clear'), domain: 'hooks', bind: (d) => (a) => d.aiHookHandlers.handleAIHookClear(a) },
  { tool: t('ai_hook_toggle'), domain: 'hooks', bind: (d) => (a) => d.aiHookHandlers.handleAIHookToggle(a) },
  { tool: t('ai_hook_export'), domain: 'hooks', bind: (d) => (a) => d.aiHookHandlers.handleAIHookExport(a) },
  { tool: t('hook_preset'), domain: 'hooks', bind: (d) => (a) => d.hookPresetHandlers.handleHookPreset(a) },
];
